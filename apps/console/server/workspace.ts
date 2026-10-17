import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

const upstream = 'http://127.0.0.1:4310';
const prefix = '/workspace-api';
type ReadName = 'getMe' | 'getMyCard' | 'getGrants' | 'getReceipts' | 'getActivity' | 'demoReset' | 'getLearning';
type RevokeName = 'revokeGrant' | 'revokeContribution';
export type SdkClient = Partial<Record<ReadName, () => Promise<unknown>>
  & Record<RevokeName, (id: string) => Promise<unknown>>
  & { setLearning: (input: { enabled: boolean }) => Promise<unknown> }>;
type SdkRoute = { name: ReadName } | { name: RevokeName; id: string } | { name: 'setLearning' };
type ClientFactory = (options: { key: string; fetch: typeof fetch; timeoutMs: number; baseUrl: string; sample?: boolean }) => SdkClient;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Resolve the real B package; never copy its implementation into the console. */
export async function loadSdk(root?: string): Promise<ClientFactory | undefined> {
  let entry: string;
  try {
    if (root) {
      // Unmerged B checkout: package's published import entry at fd1b8d4.
      const file = join(root, 'node_modules/@agent-cookie/sdk/dist/index.js');
      if (!existsSync(file)) return undefined;
      entry = pathToFileURL(file).href;
    } else entry = import.meta.resolve('@agent-cookie/sdk');
  }
  catch (error) {
    if (object(error) && ['MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND'].includes(String(error.code))) return undefined;
    throw error;
  }
  const module = await import(/* @vite-ignore */ entry);
  if (typeof module.WorkspaceClient !== 'function') throw new Error('Invalid workspace SDK package.');
  return (options) => new module.WorkspaceClient(options);
}

class BridgeError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}

function route(method: string | undefined, path: string): SdkRoute | undefined {
  if (method === 'GET') {
    const names: Record<string, ReadName> = { '/me': 'getMe', '/personal/card': 'getMyCard',
      '/personal/grants': 'getGrants', '/personal/receipts': 'getReceipts', '/owner/activity': 'getActivity',
      '/personal/learned': 'getLearning' };
    if (names[path]) return { name: names[path] };
  }
  if (method === 'POST') {
    if (path === '/demo/reset') return { name: 'demoReset' };
    const match = /^\/personal\/(grants|contributions)\/([^/]+)\/revoke$/u.exec(path);
    if (match) {
      let id: string;
      try { id = decodeURIComponent(match[2]); } catch { return undefined; }
      if (!id || id.length > 256 || /[\x00-\x1f\x7f]/u.test(id)) return undefined;
      return { name: match[1] === 'grants' ? 'revokeGrant' : 'revokeContribution', id };
    }
  }
  if (method === 'PUT' && path === '/personal/learning') return { name: 'setLearning' };
  return undefined;
}

async function readLearningChange(request: IncomingMessage): Promise<{ enabled: boolean }> {
  // TODO(contract): provisional write shape until A publishes the learning contract.
  if (!request.headers['content-type']?.startsWith('application/json')) throw new BridgeError(400, 'MISSING_FIELD');
  const parts: Buffer[] = [];
  let bytes = 0;
  for await (const part of request) {
    const buffer = Buffer.from(part);
    bytes += buffer.length;
    if (bytes > 1024) throw new BridgeError(413, 'MISSING_FIELD');
    parts.push(buffer);
  }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw new BridgeError(400, 'MISSING_FIELD'); }
  if (!object(body) || typeof body.enabled !== 'boolean' || Object.keys(body).some((key) => key !== 'enabled')) {
    throw new BridgeError(400, 'MISSING_FIELD');
  }
  return { enabled: body.enabled };
}

// Only these existing workspace paths are reachable. No generic credentialed proxy.
export function createWorkspaceBridge(options: {
  key: () => string | undefined;
  sdk: Promise<ClientFactory | undefined>;
  sample?: boolean;
  fetcher?: typeof fetch;
}) {
  const send = (response: ServerResponse, status: number, body: unknown) => {
    if (response.destroyed) return;
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff' });
    response.end(JSON.stringify(body));
  };
  return async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    if (!request.url?.startsWith(`${prefix}/`)) { next(); return; }
    const abort = new AbortController();
    const closed = () => { if (!response.writableEnded) abort.abort(); };
    response.on('close', closed);
    try {
      const host = request.headers.host;
      // Custom header prevents cross-origin form/fetch access; Host prevents DNS rebinding.
      if (!host || !/^127\.0\.0\.1:5173$/u.test(host)
        || request.headers['x-agent-cookie-console'] !== '1'
        || (request.headers.origin !== undefined && request.headers.origin !== `http://${host}`)
        || request.headers['sec-fetch-site'] === 'cross-site') throw new BridgeError(403, 'SCOPE_DENIED');
      const path = request.url.slice(prefix.length);
      const selected = route(request.method, path);
      if (!selected) throw new BridgeError(404, 'NOT_FOUND');
      const key = options.key()?.trim();
      if (!key || /[^\x21-\x7e]/u.test(key)) throw new BridgeError(503, 'CONSOLE_KEY_MISSING');
      const fetcher: typeof fetch = (input, init) => (options.fetcher ?? fetch)(input, { ...init,
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(8000), ...(init?.signal ? [init.signal] : [])]),
        redirect: 'manual', credentials: 'omit', cache: 'no-store' });
      const factory = await options.sdk;
      const client = factory?.({ key, fetch: fetcher, timeoutMs: 8000, baseUrl: upstream, sample: options.sample });
      const direct = async (endpoint: string, method: string, payload?: unknown): Promise<unknown> => {
        // TODO(sdk): remove only when the corresponding method exists in B's installed package.
        // A bd9d6e3 HTTP contract. No fallback after an SDK method throws.
        const result = await fetcher(`${upstream}${endpoint}`, { method,
          headers: { Authorization: `Bearer ${key}`, Accept: 'application/json',
            ...(['POST', 'PUT'].includes(method) ? { 'Content-Type': 'application/json' } : {}) },
          ...(['POST', 'PUT'].includes(method) ? { body: JSON.stringify(payload ?? {}) } : {}) });
        if (result.status >= 300 && result.status < 400) {
          await result.body?.cancel();
          throw new BridgeError(502, 'UPSTREAM_ERROR');
        }
        let body: unknown;
        try { body = await result.json(); } catch {
          if (result.ok) throw new BridgeError(502, 'UPSTREAM_ERROR');
        }
        if (!result.ok) {
          const code = object(body) && object(body.error) ? body.error.code : undefined;
          throw new BridgeError(result.status, typeof code === 'string' && /^[A-Z_]{1,40}$/u.test(code) ? code : 'UPSTREAM_ERROR');
        }
        return body;
      };
      const me = client?.getMe ? await client.getMe() : await direct('/me', 'GET');
      if (!object(me) || me.role !== 'owner') throw new BridgeError(403, 'CONSOLE_OWNER_REQUIRED');
      // TODO(contract): B 35f6b38 proposes getLearning()/setLearning({enabled}); the user's HTTP paths remain authoritative.
      // TODO(sdk): remove the direct path only when B's installed SDK provides the corresponding method.
      let body: unknown;
      if (selected.name === 'getMe') body = me;
      else if (selected.name === 'setLearning') {
        const payload = await readLearningChange(request);
        body = client?.setLearning ? await client.setLearning(payload) : await direct(path, request.method!, payload);
      } else if (selected.name === 'revokeGrant' || selected.name === 'revokeContribution') {
        body = client?.[selected.name] ? await client[selected.name]!(selected.id) : await direct(path, request.method!);
      } else {
        body = client?.[selected.name] ? await client[selected.name]!() : await direct(path, request.method!);
      }
      // B returns { activity }; the console uses A's { events } wire shape.
      if (selected.name === 'getActivity' && object(body) && Array.isArray(body.activity)) {
        body = { events: body.activity, ...(body.sample === true ? { sample: true } : {}) };
      }
      if (options.sample && object(body)) body = { ...body, sample: true };
      send(response, 200, body);
    } catch (error) {
      const status = object(error) && typeof error.status === 'number' && error.status >= 400 && error.status < 600 ? error.status : 502;
      const code = object(error) && typeof error.code === 'string' && /^[A-Z_]{1,40}$/u.test(error.code) ? error.code : 'UPSTREAM_ERROR';
      // Never send raw exception text, credentials, headers or causes to the browser.
      send(response, status, { error: { code } });
    } finally { response.off('close', closed); }
  };
}
