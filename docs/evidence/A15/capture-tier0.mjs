// A15 observer only: delegate every request unchanged; capture only the explicit local ACME chat route.
import { appendFile } from 'node:fs/promises';
const originalFetch = globalThis.fetch;
globalThis.fetch = async function(input, init) {
  const response = await Reflect.apply(originalFetch, this, [input, init]);
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.origin === 'http://127.0.0.1:8000' && url.pathname === '/api/chat') {
    const headers = new Headers(init?.headers);
    const record = { observedAt: new Date().toISOString(), request: { url: url.href, method: init?.method,
      headerNames: [...headers.keys()], body: typeof init?.body === 'string' ? JSON.parse(init.body) : '[unavailable]' },
      response: { status: response.status, contentType: response.headers.get('content-type') } };
    if (response.headers.get('content-type')?.includes('application/json')) record.response.body = await response.clone().json();
    await appendFile(new URL('./tier0-wire.jsonl', import.meta.url), JSON.stringify(record) + '\n', { mode: 0o600 });
  }
  return response;
};
