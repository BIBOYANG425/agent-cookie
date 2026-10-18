// The http door against a REAL demo workspace (apps/workspace in demo mode, fixture UCP), served on a loopback port:
// the bearer key picks the tool set by GET /me, owner/merchant/unknown keys are refused, sessions stay with their key.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect as tcpConnect } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { WorkspaceClient } from '@agent-cookie/sdk';
import { MCP_HTTP_PORT as CONTRACT_MCP_HTTP_PORT } from '../../contract/src/endpoints.js';
import { createApp } from '../../../apps/workspace/src/app.js';
import { loadConfig } from '../../../apps/workspace/src/config.js';
import { createDeps, type Deps } from '../../../apps/workspace/src/deps.js';
import { MCP_HTTP_PORT, readHttpConfig } from '../src/config.js';
import { startHttp, type HttpDoor } from '../src/http.js';

const KEYS = { personal: 'ck_personal_desktop_sample', assistant: 'ck_assistant_sample', owner: 'ck_owner_sample', merchant: 'ck_merchant_acme_sample' };
const PERSONAL_TOOLS = ['get_my_card', 'find_agents', 'accept_quote', 'list_receipts'];
const ASSISTANT_TOOLS = ['request_link', 'get_link', 'get_context', 'remember', 'find', 'accept_quote', 'get_stats'];
const INIT = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'raw', version: '0' } } };

let deps: Deps; let temp: string; let workspace: Server; let workspaceUrl: string; let door: HttpDoor;
const logs: string[] = [];
const clients: Client[] = [];

/** apps/workspace's Hono app on node:http, streaming bodies (the SDK's quote stream is SSE). No extra dependency. */
function serveApp(app: { fetch(request: Request): Response | Promise<Response> }): Server {
  return createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req as AsyncIterable<Buffer>) chunks.push(chunk);
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) for (const v of [value].flat()) if (v !== undefined) headers.append(name, v);
      const abort = new AbortController();
      res.on('close', () => abort.abort());
      const { port } = req.socket.address() as AddressInfo;
      const response = await app.fetch(new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers, signal: abort.signal,
        ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body: Buffer.concat(chunks) }) }));
      res.writeHead(response.status, [...response.headers].flat());
      if (response.body) for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) res.write(chunk);
      res.end();
    } catch { if (!res.headersSent) res.writeHead(500); res.end(); }
  });
}

beforeAll(async () => {
  const fixtures = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
  temp = mkdtempSync(join(tmpdir(), 'agent-cookie-mcp-http-'));
  deps = await createDeps(loadConfig({ SQLITE_PATH: ':memory:', FIXTURES_DIR: fixtures, MEMORY_REPO_PATH: join(temp, 'memory'),
    AGENT_COOKIE_DEMO: '1', AGENT_COOKIE_UCP: 'fixture', CALLBACK_TIMEOUT_MS: '50', CALLBACK_RETRIES: '1' }));
  workspace = serveApp(createApp(deps));
  workspace.listen(0, '127.0.0.1');
  await once(workspace, 'listening');
  workspaceUrl = `http://127.0.0.1:${(workspace.address() as AddressInfo).port}`;
  door = await startHttp(readHttpConfig({ AGENT_COOKIE_URL: workspaceUrl, AGENT_COOKIE_SAMPLE: '1', MCP_HTTP_PORT: '0' }), { log: line => logs.push(line) });
}, 60_000);

afterAll(async () => {
  await Promise.all(clients.splice(0).map(c => c.close().catch(() => {})));
  await door?.close();
  workspace?.closeAllConnections();
  await new Promise<void>(resolve => workspace ? workspace.close(() => resolve()) : resolve());
  await deps?.delivery.settle();
  await deps?.close();
  rmSync(temp, { recursive: true, force: true });
  for (const key of Object.values(KEYS)) expect(logs.join('\n')).not.toContain(key);
});

async function mcp(key: string) {
  const client = new Client({ name: 'http-test', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(door.url), { requestInit: { headers: { Authorization: `Bearer ${key}` } } });
  await client.connect(transport);
  clients.push(client);
  return { client, transport };
}
const parse = (result: Awaited<ReturnType<Client['callTool']>>) => {
  expect(result.isError).not.toBe(true);
  return JSON.parse((result.content as Array<{ text: string }>)[0].text);
};
const raw = (headers: Record<string, string>, body: unknown = INIT) => fetch(door.url, { method: 'POST', body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers } });

describe('http door configuration', () => {
  it('uses the contract port, needs no AGENT_COOKIE_KEY, and validates the URL and port', () => {
    expect(MCP_HTTP_PORT).toBe(CONTRACT_MCP_HTTP_PORT);
    expect(readHttpConfig({})).toEqual({ baseUrl: 'http://127.0.0.1:4310', port: 4311 });
    expect(readHttpConfig({ MCP_HTTP_PORT: '0' }).port).toBe(0);
    expect(() => readHttpConfig({ AGENT_COOKIE_URL: 'http://remote.example' })).toThrow();
    for (const port of ['65536', '-1', 'x', '']) expect(() => readHttpConfig({ MCP_HTTP_PORT: port })).toThrow('MCP_HTTP_PORT');
  });
  it('binds 127.0.0.1 only', async () => {
    expect(door.url).toBe(`http://127.0.0.1:${door.port}/mcp`);
    const external = Object.values(networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal);
    if (!external) return;
    await expect(new Promise((resolve, reject) => {
      const socket = tcpConnect(door.port, external.address);
      socket.once('connect', () => { socket.destroy(); resolve('connected'); });
      socket.once('error', reject);
    })).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  });
});

describe('bearer → tool set', { timeout: 30_000 }, () => {
  it('a personal key gets the personal tools and reads the Sample card', async () => {
    const { client } = await mcp(KEYS.personal);
    expect((await client.listTools()).tools.map(t => t.name)).toEqual(PERSONAL_TOOLS);
    const card = parse(await client.callTool({ name: 'get_my_card', arguments: {} }));
    expect(card).toMatchObject({ sample: true, card: expect.arrayContaining([expect.objectContaining({ field: 'lang', value: 'zh' })]) });
  });

  it('an assistant key gets the assistant tools: link → owner approves → context → find → accept → stats', async () => {
    const { client } = await mcp(KEYS.assistant);
    const tools = (await client.listTools()).tools;
    expect(tools.map(t => t.name)).toEqual(ASSISTANT_TOOLS);
    expect(tools.find(t => t.name === 'accept_quote')!.annotations).toMatchObject({ destructiveHint: true, openWorldHint: true });
    for (const t of tools.filter(t => ['get_context', 'find', 'remember', 'accept_quote'].includes(t.name))) expect(t.description).toContain('Never ask');

    const before = await client.callTool({ name: 'get_context', arguments: {} });
    expect(before.isError).toBe(true);
    expect(JSON.stringify(before)).toContain('SCOPE_DENIED');

    const link = parse(await client.callTool({ name: 'request_link', arguments: {} }));
    expect(link).toMatchObject({ status: 'pending' });
    expect(link.url).toMatch(/^https?:\/\//);
    const owner = new WorkspaceClient({ baseUrl: workspaceUrl, key: KEYS.owner, sample: true });
    await owner.approveLink(link.id);
    expect(parse(await client.callTool({ name: 'get_link', arguments: { linkId: link.id } }))).toMatchObject({ id: link.id, status: 'approved', sessionId: expect.any(String) });

    const contextResult = await client.callTool({ name: 'get_context', arguments: {} });
    const context = parse(contextResult);
    expect(Object.keys(context.fields).length).toBeGreaterThan(0);
    expect(JSON.stringify(contextResult)).not.toContain('shipping_address');
    expect(JSON.stringify(contextResult)).not.toContain('payment_method');

    expect(context.writable).toContain('pref.color');
    const remembered = parse(await client.callTool({ name: 'remember', arguments: { field: 'pref.color', value: 'black', basis: 'stated',
      evidence: { conversationId: 'mcp-http-test', snippet: '我一直喜欢黑色' } } }));
    expect(remembered).toMatchObject({ stored: 'stated', contribution: { field: 'pref.color', value: 'black' } });
    const refused = await client.callTool({ name: 'remember', arguments: { field: 'shipping_address', value: 'Sample street', basis: 'observed' } });
    expect(refused.isError).toBe(true);

    const found = parse(await client.callTool({ name: 'find', arguments: { text: 'Sample · trail shoes', public: { budget: '120' } } }));
    expect(found.quotes.length).toBeGreaterThan(0);
    const accepted = parse(await client.callTool({ name: 'accept_quote', arguments: { quoteId: found.quotes[0].id } }));
    expect(['ordered', 'handoff', 'blocked', 'failed']).toContain(accepted.status);
    const stats = parse(await client.callTool({ name: 'get_stats', arguments: {} }));
    expect(stats.intents).toBeGreaterThanOrEqual(1);
    expect(stats.accepted).toBeGreaterThanOrEqual(1);
  });

  it('no key, a bad key, an owner key and a merchant key are 401 with a fixed body that never echoes the key', async () => {
    const cases: Array<[Record<string, string>, string]> = [
      [{}, ''], [{ Authorization: 'Bearer ck_not_a_real_key' }, 'ck_not_a_real_key'], [{ Authorization: 'Basic abc' }, 'abc'],
      [{ Authorization: `Bearer ${KEYS.owner}` }, KEYS.owner], [{ Authorization: `Bearer ${KEYS.merchant}` }, KEYS.merchant],
    ];
    const bodies = new Set<string>();
    for (const [headers, secret] of cases) {
      const response = await raw(headers);
      expect(response.status).toBe(401);
      const text = await response.text();
      if (secret) expect(text).not.toContain(secret);
      expect(JSON.parse(text)).toMatchObject({ jsonrpc: '2.0', error: { code: -32001 }, id: null });
      bodies.add(text);
    }
    expect(bodies.size).toBe(1);
    await expect(mcp(KEYS.owner)).rejects.toThrow();
  });

  it('a session belongs to the key that opened it', async () => {
    const { client, transport } = await mcp(KEYS.personal);
    const sessionId = transport.sessionId!;
    expect(sessionId).toBeTruthy();
    const list = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
    const headers = { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-06-18' };
    for (const key of [KEYS.assistant, 'ck_not_a_real_key']) {
      const response = await raw({ ...headers, Authorization: `Bearer ${key}` }, list);
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain(key);
    }
    expect((await raw(headers, list)).status).toBe(401);
    // The owner of the session is unaffected.
    expect((await client.listTools()).tools.map(t => t.name)).toEqual(PERSONAL_TOOLS);
    // A non-initialize request without a session is refused.
    expect((await raw({ Authorization: `Bearer ${KEYS.personal}` }, list)).status).toBe(400);
  });
});
