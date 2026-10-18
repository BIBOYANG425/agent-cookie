import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

const upstream = 'http://127.0.0.1:4310';
const prefix = '/workspace-api';
type ReadName = 'getMe' | 'getMyCard' | 'getGrants' | 'getReceipts' | 'getActivity' | 'demoReset' | 'getLearning' | 'getLearned';
type RevokeName = 'revokeGrant' | 'revokeContribution';
export type SdkClient = Partial<Record<ReadName, () => Promise<unknown>>
  & Record<RevokeName, (id: string) => Promise<unknown>>
  & { setLearning: (input: { enabled: boolean }) => Promise<unknown> }>;
// TODO(sdk): no installed SDK method covers these yet; they use the contract HTTP endpoints directly (owner key).
type DirectRoute = { name: 'getPolicy' } | { name: 'getFunnel'; query: string } | { name: 'getExperiments' } | { name: 'installPolicy' }
  | { name: 'shadowPolicy' };
type SdkRoute = { name: ReadName } | { name: RevokeName; id: string } | { name: 'setLearning' } | DirectRoute;
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
  /** Only the policy routes' 422 floor violations (section and field names, never values) ever set `detail`. */
  constructor(readonly status: number, readonly code: string, readonly detail?: string) { super(code); }
}

/** GET /owner/funnel accepts only `limit` (1–1000) and `since` (an ISO time), each at most once; anything else is 404. */
function funnelQuery(path: string): string | undefined {
  const [pathname, search = '', ...rest] = path.split('?');
  if (pathname !== '/owner/funnel' || rest.length > 0) return undefined;
  const params = new URLSearchParams(search);
  for (const key of new Set(params.keys())) if (!['limit', 'since'].includes(key) || params.getAll(key).length !== 1) return undefined;
  const out = new URLSearchParams();
  const limit = params.get('limit');
  if (limit !== null) {
    if (!/^[1-9][0-9]{0,3}$/u.test(limit) || Number(limit) > 1000) return undefined;
    out.set('limit', limit);
  }
  const since = params.get('since');
  if (since !== null) {
    if (since.length > 40 || !/^[0-9TZ:.+-]+$/u.test(since) || !Number.isFinite(Date.parse(since))) return undefined;
    out.set('since', since);
  }
  const query = out.toString();
  return query ? `?${query}` : '';
}

function route(method: string | undefined, path: string): SdkRoute | undefined {
  if (method === 'GET') {
    const names: Record<string, ReadName> = { '/me': 'getMe', '/personal/card': 'getMyCard',
      '/personal/grants': 'getGrants', '/personal/receipts': 'getReceipts', '/owner/activity': 'getActivity',
      '/personal/learned': 'getLearned', '/personal/learning': 'getLearning' };
    if (names[path]) return { name: names[path] };
    if (path === '/personal/policy') return { name: 'getPolicy' };
    // GET /owner/experiments takes no query at all: the exact path only, anything else is 404.
    if (path === '/owner/experiments') return { name: 'getExperiments' };
    const query = funnelQuery(path);
    if (query !== undefined) return { name: 'getFunnel', query };
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
  if (method === 'PUT' && path === '/personal/policy') return { name: 'installPolicy' };
  if (method === 'POST' && path === '/personal/policy/shadow') return { name: 'shadowPolicy' };
  return undefined;
}

async function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new BridgeError(400, 'MISSING_FIELD');
  const parts: Buffer[] = [];
  let bytes = 0;
  for await (const part of request) {
    const buffer = Buffer.from(part);
    bytes += buffer.length;
    if (bytes > maxBytes) throw new BridgeError(413, 'MISSING_FIELD');
    parts.push(buffer);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { throw new BridgeError(400, 'MISSING_FIELD'); }
}

/** Shape only (an object; shadow wraps it as exactly { policy }). The workspace alone checks the document against the floor. */
async function readPolicyBody(request: IncomingMessage, shadow: boolean): Promise<Record<string, unknown>> {
  const body = await readJsonBody(request, 16384);
  if (!object(body)) throw new BridgeError(400, 'MISSING_FIELD');
  if (shadow && (!object(body.policy) || Object.keys(body).some((key) => key !== 'policy'))) throw new BridgeError(400, 'MISSING_FIELD');
  return shadow ? { policy: body.policy } : body;
}

async function readLearningChange(request: IncomingMessage): Promise<{ paused: boolean }> {
  // A 0129f08: learning state is separate from the grouped learned records.
  const body = await readJsonBody(request, 1024);
  if (!object(body) || typeof body.paused !== 'boolean' || Object.keys(body).some((key) => key !== 'paused')) {
    throw new BridgeError(400, 'MISSING_FIELD');
  }
  return { paused: body.paused };
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
      const direct = async (endpoint: string, method: string, payload?: unknown, violations = false): Promise<unknown> => {
        // TODO(sdk): remove only when the corresponding method exists in B's installed package.
        // A bd9d6e3 core HTTP contract; learning routes use A 0129f08. No fallback after an SDK method throws.
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
          // Policy writes only: the 422 message is policyViolations(...).join("; ") (contract policy-document.ts).
          const message = violations && result.status === 422 && code === 'MISSING_FIELD' && object(body) && object(body.error)
            && typeof body.error.message === 'string' ? body.error.message.replace(/[\x00-\x1f\x7f]/gu, ' ').slice(0, 8000) : undefined;
          throw new BridgeError(result.status, typeof code === 'string' && /^[A-Z_]{1,40}$/u.test(code) ? code : 'UPSTREAM_ERROR', message);
        }
        return body;
      };
      const me = client?.getMe ? await client.getMe() : await direct('/me', 'GET');
      if (!object(me) || me.role !== 'owner') throw new BridgeError(403, 'CONSOLE_OWNER_REQUIRED');
      // A 0129f08 wire uses { paused }; B e24957c SDK LearningControl instead takes { enabled }.
      // getLearning is state and getLearned is the grouped record list.
      // TODO(sdk): remove the direct path only when B's installed SDK provides the corresponding method.
      let body: unknown;
      if (selected.name === 'getMe') body = me;
      else if (selected.name === 'getPolicy') body = await direct('/personal/policy', 'GET');
      else if (selected.name === 'getFunnel') body = await direct(`/owner/funnel${selected.query}`, 'GET');
      else if (selected.name === 'getExperiments') body = await direct('/owner/experiments', 'GET');
      else if (selected.name === 'installPolicy') body = await direct('/personal/policy', 'PUT', await readPolicyBody(request, false), true);
      else if (selected.name === 'shadowPolicy') body = await direct('/personal/policy/shadow', 'POST', await readPolicyBody(request, true), true);
      else if (selected.name === 'setLearning') {
        const payload = await readLearningChange(request);
        body = client?.setLearning ? await client.setLearning({ enabled: !payload.paused }) : await direct(path, request.method!, payload);
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
      const detail = error instanceof BridgeError && error.detail ? error.detail : undefined;
      send(response, status, { error: { code, ...(detail ? { message: detail } : {}) } });
    } finally { response.off('close', closed); }
  };
}
