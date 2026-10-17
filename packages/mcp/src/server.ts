import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import type { FindInput } from '@agent-cookie/sdk';

/** B-local injection seam, not the frozen WorkspaceClient method contract. */
export interface PersonalWorkspaceBinding {
  getAuthenticatedRole(): Promise<string>;
  getMyCard(): Promise<unknown>;
  find?(input: FindInput, key: string): Promise<unknown>;
  accept?(quoteId: string, key: string): Promise<unknown>;
  getReceipts?(): Promise<unknown>;
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
  if (binding.find) server.registerTool('find_agents', {
    description: 'Find trail-shoe offers through the workspace. This shares the task intent with external merchants in live mode. Use saved shoe size; preserve Sample labels and unknown delivery dates.',
    inputSchema: { kind: z.literal('trail_shoes'), budget: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(), deadline: z.string().max(100).optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  }, async ({kind,budget,deadline}) => {
    try { return { content:[{type:'text' as const,text:JSON.stringify(await binding.find!({kind,public:{...(budget?{budget}:{}),...(deadline?{deadline}:{})}},`mcp:find:${randomUUID()}`))}] }; }
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
