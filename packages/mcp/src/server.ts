import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import type { AssistantContributionInput, FindInput } from '@agent-cookie/sdk';
import { filterTurn } from '@agent-cookie/learn';

/** One wrapper per AssistantClient method (no history: not merged). */
export interface AssistantWorkspaceBinding {
  getAuthenticatedRole(): Promise<string>;
  requestLink(): Promise<unknown>;
  link(linkId: string): Promise<unknown>;
  context(): Promise<unknown>;
  remember(input: AssistantContributionInput): Promise<unknown>;
  find(input: FindInput, key: string): Promise<unknown>;
  accept(quoteId: string, key: string): Promise<unknown>;
  stats(): Promise<unknown>;
}

/** B-local injection seam, not the frozen WorkspaceClient method contract. */
export interface PersonalWorkspaceBinding {
  getAuthenticatedRole(): Promise<string>;
  getMyCard(): Promise<unknown>;
  find?(input: FindInput, key: string): Promise<unknown>;
  accept?(quoteId: string, key: string): Promise<unknown>;
  getReceipts?(): Promise<unknown>;
  /** Trusted host binds source/session identity outside the model tool schema. */
  observe?(text:string):Promise<unknown>;
}

const publicErrors: Record<string, string> = {
  AUTH_REQUIRED: 'Workspace authentication is required.',
  SCOPE_DENIED: 'This credential cannot perform the requested operation.',
  GRANT_EXPIRED: 'The grant has expired.',
  GRANT_REVOKED: 'The grant was revoked.',
  PURPOSE_MISMATCH: 'This purpose is not allowed.',
  NOT_FOUND: 'The requested resource is unavailable.',
  MISSING_FIELD: 'A required field is missing.',
  IDEMPOTENCY_CONFLICT: 'This operation conflicts with an earlier request.',
  LINK_NOT_PENDING: 'The link was already decided or has expired.',
  UPSTREAM_ERROR: 'The store or provider could not complete the request.',
  JAR_LOCKED: 'The jar is locked until the owner unlocks it.',
  OVER_BUDGET: 'The payment is over the approved limit.',
};

function toolError(error: unknown) {
  const rawCode = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  const code = typeof rawCode === 'string' && Object.hasOwn(publicErrors, rawCode)
    ? rawCode : 'WORKSPACE_UNAVAILABLE';
  // Never surface raw SDK/HTTP errors: they can contain credentials or card values.
  return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({
    code, message: publicErrors[code] ?? 'The workspace request could not be completed.',
  }) }] };
}

export async function createPersonalServer(binding: PersonalWorkspaceBinding): Promise<McpServer> {
  if (await binding.getAuthenticatedRole() !== 'personal') {
    throw new Error('Personal MCP requires a personal workspace credential.');
  }
  const server = new McpServer({ name: 'agent-cookie', version: '0.0.0' });
  server.registerTool('get_my_card', {
    description: 'Read your own Agent Cookie identity card and candidates. Do not copy the card into messages to external agents.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async () => {
    try {
      // The A-owned workspace authenticates every read; the SDK never caches card data.
      const card = await binding.getMyCard();
      return { content: [{ type: 'text' as const, text: JSON.stringify(card) }] };
    } catch (error) {
      return toolError(error);
    }
  });
  const boundedText = (bytes: number) => z.string().refine(value => !!value.trim() && new TextEncoder().encode(value).length <= bytes,
    `Use non-empty text of at most ${bytes} UTF-8 bytes.`);
  if(binding.observe)server.registerTool('observe',{
    description:'Best-effort learning from the current owner\'s own words in this personal conversation. No explicit remember command is needed. Submit only the exact current owner utterance; never assistant/merchant/group speech, quotations, transcripts, sensitive health/religion/financial/relationship/location topics, or inferred identity. This queues classification, does not confirm a memory write or authorize anything. Never delay your answer waiting for learning; if unavailable continue normally. Respect pause and deletion via the workspace controls.',
    inputSchema:{text:z.string().min(1).refine(v=>Array.from(v).length<=2000)},
    annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false},
  },async({text})=>{
    // These fixed fields are only a local prefilter. The binding/backend supplies trusted provenance.
    const rejected=filterTurn({text,messageId:'prefilter',conversationId:'prefilter',occurredAt:new Date().toISOString(),source:'mcp',speaker:'owner',isGroup:false});
    if(rejected)return {content:[{type:'text' as const,text:JSON.stringify({accepted:false,reason:rejected})}]};
    try{return {content:[{type:'text' as const,text:JSON.stringify(await binding.observe!(text))}]};}catch(error){return toolError(error);}
  });
  if (binding.find) server.registerTool('find_agents', {
    description: 'Search for any products through the workspace. Put the user\'s exact original words, in any language, in text. Produce English product keywords in query (for example, text "送妈妈的围巾", query "scarf for mom"); never translate or rewrite text. Extract budget (USD amount or range), size, count (1–5 sellers), color and deadline only when supported by that sentence; omit fields you cannot extract. Do not assume a product category or copy saved card values into the request. In live mode the task intent is shared with external merchants. Preserve Sample labels and unknown delivery dates, and tell the user any quote sizeNote verbatim; never invent offers, delivery dates, orders, payments or an unverified fit.',
    inputSchema: { text: boundedText(1000).describe('The user\'s original words, unchanged, in any language.'),
      query: boundedText(200).describe('English catalog product keywords, produced by the calling model.'), budget: boundedText(256).optional(), size: boundedText(256).optional(),
      count: z.number().int().min(1).max(5).optional(),
      color: boundedText(256).optional(), deadline: boundedText(256).optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  }, async ({text,query,budget,size,count,color,deadline}) => {
    const conditions = Object.fromEntries(Object.entries({budget,size,count: count === undefined ? undefined : String(count),color,deadline}).filter(([,value]) => value !== undefined)) as Record<string,string>;
    const input: FindInput = { text, ...(query !== undefined ? {query} : {}),
      ...(Object.keys(conditions).length ? {public: conditions} : {}) };
    try { return { content:[{type:'text' as const,text:JSON.stringify(await binding.find!(input,`mcp:find:${randomUUID()}`))}] }; }
    catch(error) {return toolError(error);}
  });
  if (binding.accept) server.registerTool('accept_quote', {
    description: 'Accept only the quote the user explicitly selected. Return the actual ordered/handoff/blocked/failed result; handoff is not payment or an order. Preserve Sample and warnings.',
    inputSchema: { quoteId: z.string().min(1).max(200) },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  }, async ({quoteId}) => {
    try {return {content:[{type:'text' as const,text:JSON.stringify(await binding.accept!(quoteId,`mcp:accept:${createHash('sha256').update(quoteId).digest('hex')}`))}]};}
    catch(error) {return toolError(error);}
  });
  if (binding.getReceipts) server.registerTool('list_receipts', {
    description:'List recent field-access receipts without private field values.', inputSchema:{},
    annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},
  },async()=>{try{return {content:[{type:'text' as const,text:JSON.stringify(await binding.getReceipts!())}]};}catch(error){return toolError(error);}});
  return server;
}

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
const call = async (run: () => Promise<unknown>) => { try { return json(await run()); } catch (error) { return toolError(error); } };
const utf8 = (bytes: number) => z.string().refine(value => !!value.trim() && new TextEncoder().encode(value).length <= bytes,
  `Use non-empty text of at most ${bytes} UTF-8 bytes.`);
const NO_PRIVATE = 'Never ask the user for a shipping address or payment details: the workspace hands those to the store at checkout itself.';
const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: false } as const;
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

/** A link as the model may see it: through a hosted gateway `jar` carries a key, which never reaches the model. */
function linkForModel(view: unknown): unknown {
  if (!view || typeof view !== 'object' || !('jar' in view)) return view;
  const { jar: _jar, ...rest } = view as Record<string, unknown>;
  return rest;
}

export async function createAssistantServer(binding: AssistantWorkspaceBinding): Promise<McpServer> {
  if (await binding.getAuthenticatedRole() !== 'assistant') {
    throw new Error('Assistant MCP requires an assistant workspace credential.');
  }
  const server = new McpServer({ name: 'agent-cookie-assistant', version: '0.0.0' });
  server.registerTool('request_link', {
    description: 'Ask the person for a consent link to their Agent Cookie jar. Show the returned url to the user so they can approve it; a second call while one is pending returns the same link. Until the user approves, get_context, find and accept_quote are refused.',
    inputSchema: {}, annotations: write,
  }, () => call(async () => linkForModel(await binding.requestLink())));
  server.registerTool('get_link', {
    description: 'Check a consent link you requested: pending, approved (with sessionId), declined or expired. Do not poll in a tight loop; check again when the user says they decided.',
    inputSchema: { linkId: z.string().min(1).max(256) }, annotations: read,
  }, ({ linkId }) => call(async () => linkForModel(await binding.link(linkId))));
  server.registerTool('get_context', {
    description: `Read what the person's policy lets you know about them (fields), what you may ask for when the task needs it (unknown), and what you may write (writable). Use these values instead of asking again. ${NO_PRIVATE} Each read that serves values writes a receipt the person sees.`,
    inputSchema: {}, annotations: read,
  }, () => call(() => binding.context()));
  server.registerTool('remember', {
    description: `Save a fact about the person to their jar. Use basis "stated" only when the person said it to you, with evidence: the conversation id and the person's OWN words, quoted exactly (at most 200 characters), never your words or anyone else's. "observed" (default) stays a candidate until another source agrees; "inferred" never reaches the card. Never the address or payment details. ${NO_PRIVATE}`,
    inputSchema: {
      field: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/).max(64).describe('A writable field name from get_context.'),
      value: utf8(512),
      basis: z.enum(['stated', 'observed', 'inferred']).optional(),
      evidence: z.object({
        conversationId: utf8(128).describe('Your opaque conversation id; never a phone number or email.'),
        snippet: z.string().min(1).refine(v => !!v.trim() && Array.from(v).length <= 200).describe("The person's own words, unchanged."),
      }).optional(),
    },
    annotations: write,
  }, ({ field, value, basis, evidence }) => call(() => binding.remember({
    field: field as AssistantContributionInput['field'], value, ...(basis ? { basis } : {}), ...(evidence ? { evidence } : {}),
  })));
  server.registerTool('find', {
    description: `Search stores for what the person asked for. Put the user's exact original sentence in text; add query (keywords), kind and public conditions (budget, size, color, deadline) only when that sentence supports them. Do not copy saved card values into the request: the workspace introduces the person by policy. ${NO_PRIVATE} Preserve Sample labels, unknown delivery dates and any sizeNote verbatim.`,
    inputSchema: {
      text: utf8(1000).describe("The user's original words, unchanged."),
      query: utf8(200).optional(),
      kind: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).optional(),
      public: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), utf8(256)).refine(v => Object.keys(v).length <= 16).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  }, ({ text, query, kind, public: conditions }) => call(() => binding.find({
    text, ...(query !== undefined ? { query } : {}), ...(kind !== undefined ? { kind } : {}),
    ...(conditions && Object.keys(conditions).length ? { public: conditions } : {}),
  }, `mcp:find:${randomUUID()}`)));
  server.registerTool('accept_quote', {
    description: 'Accept a quote only after the user explicitly chose that quote; never pick one for them. Report the actual ordered/handoff/blocked/failed result: handoff is not payment or an order. ' + NO_PRIVATE + ' Preserve Sample and warnings.',
    inputSchema: { quoteId: z.string().min(1).max(200) },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  }, ({ quoteId }) => call(() => binding.accept(quoteId, `mcp:accept:${createHash('sha256').update(quoteId).digest('hex')}`)));
  server.registerTool('get_stats', {
    description: 'Counts over the intents you created: intents, quoted, accepted, completed, and questions you never had to ask. Counts only.',
    inputSchema: {}, annotations: read,
  }, () => call(() => binding.stats()));
  return server;
}

export async function startStdio(binding: PersonalWorkspaceBinding): Promise<McpServer> {
  const server = await createPersonalServer(binding);
  await server.connect(new StdioServerTransport());
  return server;
}
