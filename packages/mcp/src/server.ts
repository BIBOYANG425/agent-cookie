import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import type { FindInput } from '@agent-cookie/sdk';
import { filterTurn } from '@agent-cookie/learn';

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
    description: 'Search for products through the workspace. Put the user\'s exact original sentence in request. Extract query (search keywords), budget (USD amount or range), size, color and deadline only when supported by that sentence; omit fields you cannot extract. Do not assume a product category or copy saved card values into the request. In live mode the task is shared with external merchants. Preserve Sample labels and unknown delivery dates, and tell the user any quote sizeNote verbatim; never claim an unverified fit.',
    inputSchema: { request: boundedText(1000).describe('The user\'s original words, unchanged.'),
      query: boundedText(200).optional(), budget: boundedText(256).optional(), size: boundedText(256).optional(),
      color: boundedText(256).optional(), deadline: boundedText(256).optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  }, async ({request,query,budget,size,color,deadline}) => {
    const conditions = Object.fromEntries(Object.entries({budget,size,color,deadline}).filter(([,value]) => value !== undefined)) as Record<string,string>;
    const input: FindInput = { text: request, ...(query !== undefined ? {query} : {}),
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

export async function startStdio(binding: PersonalWorkspaceBinding): Promise<McpServer> {
  const server = await createPersonalServer(binding);
  await server.connect(new StdioServerTransport());
  return server;
}
