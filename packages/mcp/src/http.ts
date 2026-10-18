// The http door: MCP Streamable HTTP on 127.0.0.1:MCP_HTTP_PORT at /mcp. Each session's bearer key picks the tool
// set by the workspace's own answer to GET /me (personal → personal tools, assistant → assistant tools, anything else
// refused) and every tool is the same one-line SDK wrapper as over stdio. No key is ever logged or echoed.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { WorkspaceClient, isWorkspaceError } from '@agent-cookie/sdk';
import type { HttpDoorConfig, WorkspaceConfig } from './config.js';
import { createAssistantServer, createPersonalServer } from './server.js';
import { bindAssistant, bindWorkspace } from './workspace.js';

export const MCP_PATH = '/mcp';
const HOST = '127.0.0.1';
const MAX_BODY_BYTES = 1 << 20;

export interface HttpDoorOptions {
  /** stderr by default; receives counts and status codes only. */
  log?: (line: string) => void;
  /** Open sessions at most (default 128); a new session past it is 503. */
  maxSessions?: number;
  /** A session with no request for this long is closed (default 30 minutes). */
  idleMs?: number;
}
export interface HttpDoor { port: number; url: string; close(): Promise<void> }

interface Session { keyHash: Buffer; server: McpServer; transport: StreamableHTTPServerTransport; lastSeen: number }

const rpcError = (code: number, message: string) => JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null });
const UNAUTHORIZED = rpcError(-32001, 'Unauthorized: present an Agent Cookie personal or assistant key as a bearer token.');
const NO_SESSION = rpcError(-32001, 'Session not found.');
const fixed: Record<number, string> = {
  400: rpcError(-32600, 'Bad request: a new session starts with an initialize request.'),
  404: rpcError(-32601, 'Not found: the MCP endpoint is /mcp.'),
  405: rpcError(-32601, 'Method not allowed.'),
  413: rpcError(-32600, 'Request body too large.'),
  500: rpcError(-32603, 'Internal error.'),
  503: rpcError(-32000, 'The workspace is unavailable or the server is busy.'),
};

function refuse(res: ServerResponse, status: number, body = fixed[status] ?? fixed[500]) {
  if (res.headersSent) { res.end(); return; }
  res.writeHead(status, { 'Content-Type': 'application/json', ...(status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {}) }).end(body);
}

function bearer(req: IncomingMessage): string | undefined {
  const match = /^Bearer ([\x21-\x7e]{1,512})$/.exec(req.headers.authorization ?? '');
  return match?.[1];
}

async function readJson(req: IncomingMessage): Promise<{ ok: true; body: unknown } | { ok: false; status: number }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return { ok: false, status: 413 };
    chunks.push(chunk);
  }
  try { return { ok: true, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }; }
  catch { return { ok: false, status: 400 }; }
}

/** The tool set for this key, by the workspace's GET /me; undefined when the key is not a personal or assistant key. */
async function serverFor(config: HttpDoorConfig, key: string): Promise<McpServer | 'unavailable' | undefined> {
  const bound: WorkspaceConfig = { ...config, key };
  let role: string;
  try { role = (await new WorkspaceClient({ baseUrl: config.baseUrl, key, ...(config.sample ? { sample: true } : {}) }).getMe()).role; }
  catch (error) { return isWorkspaceError(error) && (error.status === 401 || error.status === 403) ? undefined : 'unavailable'; }
  // The role was just verified; the servers' own startup check need not call /me a second time.
  if (role === 'personal') return createPersonalServer({ ...bindWorkspace(bound), getAuthenticatedRole: async () => role });
  if (role === 'assistant') return createAssistantServer({ ...bindAssistant(bound), getAuthenticatedRole: async () => role });
  return undefined; // owner, merchant and any future role are never exposed over MCP.
}

export async function startHttp(config: HttpDoorConfig, options: HttpDoorOptions = {}): Promise<HttpDoor> {
  const log = options.log ?? ((line: string) => { process.stderr.write(`${line}\n`); });
  const maxSessions = options.maxSessions ?? 128;
  const idleMs = options.idleMs ?? 30 * 60_000;
  const sessions = new Map<string, Session>();
  const drop = (id: string) => {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    void session.server.close().catch(() => {});
    log(`agent-cookie mcp http: session closed (sessions=${sessions.size})`);
  };

  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (new URL(req.url ?? '/', 'http://127.0.0.1').pathname !== MCP_PATH) return refuse(res, 404);
    if (!['GET', 'POST', 'DELETE'].includes(req.method ?? '')) return refuse(res, 405);
    const key = bearer(req);
    if (!key) { log('agent-cookie mcp http: refused 401'); return refuse(res, 401, UNAUTHORIZED); }
    const keyHash = createHash('sha256').update(key).digest();
    const sessionId = req.headers['mcp-session-id'];

    if (sessionId !== undefined) {
      const session = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;
      // A session belongs to the key that opened it; another key gets the same answer as an unknown session.
      if (!session || !timingSafeEqual(session.keyHash, keyHash)) { log('agent-cookie mcp http: refused 404'); return refuse(res, 404, NO_SESSION); }
      session.lastSeen = Date.now();
      if (req.method !== 'POST') return session.transport.handleRequest(req, res);
      const read = await readJson(req);
      if (!read.ok) return refuse(res, read.status);
      return session.transport.handleRequest(req, res, read.body);
    }

    if (req.method !== 'POST') return refuse(res, 400);
    const read = await readJson(req);
    if (!read.ok) return refuse(res, read.status);
    if (!isInitializeRequest(read.body)) return refuse(res, 400);
    if (sessions.size >= maxSessions) { log('agent-cookie mcp http: refused 503'); return refuse(res, 503); }
    const server = await serverFor(config, key);
    if (server === 'unavailable') { log('agent-cookie mcp http: refused 503'); return refuse(res, 503); }
    if (!server) { log('agent-cookie mcp http: refused 401'); return refuse(res, 401, UNAUTHORIZED); }
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: id => {
        sessions.set(id, { keyHash, server, transport, lastSeen: Date.now() });
        log(`agent-cookie mcp http: session opened (sessions=${sessions.size})`);
      },
      onsessionclosed: id => drop(id),
    });
    transport.onclose = () => { if (transport.sessionId) drop(transport.sessionId); };
    await server.connect(transport);
    await transport.handleRequest(req, res, read.body);
    if (!transport.sessionId || !sessions.has(transport.sessionId)) await server.close().catch(() => {});
  }

  const http = createServer((req, res) => {
    handle(req, res).catch(() => { log('agent-cookie mcp http: refused 500'); refuse(res, 500); });
  });
  http.listen(config.port, HOST);
  await Promise.race([once(http, 'listening'), once(http, 'error').then(([error]) => { throw error; })]);
  const sweep = setInterval(() => {
    const cutoff = Date.now() - idleMs;
    for (const [id, session] of sessions) if (session.lastSeen < cutoff) drop(id);
  }, Math.min(idleMs, 60_000));
  sweep.unref();
  const port = (http.address() as AddressInfo).port;
  log(`agent-cookie mcp http: listening on http://${HOST}:${port}${MCP_PATH}`);
  return {
    port,
    url: `http://${HOST}:${port}${MCP_PATH}`,
    async close() {
      clearInterval(sweep);
      for (const id of [...sessions.keys()]) drop(id);
      http.closeAllConnections();
      await new Promise<void>(resolve => http.close(() => resolve()));
    },
  };
}
