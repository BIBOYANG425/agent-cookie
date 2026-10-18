// Sample · a store's agent off-protocol (MerchantClient), against a DEMO workspace: introduced by callback, it greets
// from the handshake, reads auto fields, quotes, gets the address only at checkout and never the payment method.
// Logs carry ids, counts and field NAMES only. Outside this repository: import from '@agent-cookie/sdk' instead.
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { MerchantClient, WorkspaceClient, isWorkspaceError, registerAgent } from '../../packages/sdk/dist/index.js';

const url = process.env.AGENT_COOKIE_URL ?? 'http://127.0.0.1:4310';
const log = (line) => console.log(`[Sample store] ${line}`);
const names = (fields) => Object.keys(fields).join(', ') || '(none)';
const kind = `sample_trail_${randomUUID().slice(0, 8)}`; // what this store sells; an intent names it to reach the store

// The workspace POSTs `introduce` and `accepted` here. Answer 200 at once and do the work afterwards. (Loopback demo:
// a production store also checks the request's TAP signature.)
const waiting = new Map();
const arrival = (type, ms = 10 * 60_000) => new Promise((resolve, reject) => {
  waiting.set(type, resolve);
  setTimeout(() => reject(new Error(`no ${type} callback within ${ms} ms`)), ms).unref();
});
const server = createServer(async (request, response) => {
  let raw = '';
  for await (const chunk of request) raw += chunk;
  response.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
  try { const body = JSON.parse(raw); waiting.get(body.type)?.(body); } catch { /* not a callback */ }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const callbackUrl = `http://127.0.0.1:${server.address().port}/agent-cookie`;

try {
  // Once, at setup. The key is shown once: keep it in your secret store, never in a log or a commit.
  const { agentId, key } = await registerAgent(url, { name: 'Sample · Trail Store (examples/merchant-sdk)', category: 'shoe',
    capabilities: [kind], callbackUrl });
  log(`registered merchant ${agentId} (category shoe, sells ${kind}), callbacks at ${callbackUrl}`);
  const store = new MerchantClient({ baseUrl: url, key, sample: true });

  // DEMO SHORTCUT: somebody has to want shoes. With AGENT_COOKIE_PERSONAL_KEY (demo: ck_personal_sample) this script
  // also plays the person's own agent. The SDK's find() sends only the person's words, and a registered store is
  // matched by the intent's `kind` hint, so this one raw request carries it.
  const personalKey = process.env.AGENT_COOKIE_PERSONAL_KEY;
  const introduced = arrival('introduce');
  if (personalKey) {
    log(`[demo shortcut] the person's agent asks for ${kind}`);
    const r = await fetch(`${url}/personal/intents`, { method: 'POST', body: JSON.stringify({ text: 'Sample · trail running shoes', kind }),
      headers: { authorization: `Bearer ${personalKey}`, 'content-type': 'application/json', 'idempotency-key': `intent-${kind}` } });
    if (r.status !== 201) throw new Error(`the demo intent was refused (${r.status})`);
  } else {
    log(`waiting for an intent with kind "${kind}" from the person's agent`);
  }

  // On `introduce`: the pairwise session and the intent. Greet in their language, know their size, ask nothing.
  const { sessionId, intent } = await introduced;
  log(`introduced: session ${sessionId}, intent ${intent.id}`);
  const hello = await store.handshake(sessionId);
  log(`handshake: lang/tone/length to talk in; ${hello.available.length} readable field name(s): ${hello.available.join(', ')}`);
  const auto = await store.fields(sessionId, ['shoe_size', 'budget', 'deadline']); // auto fields: no purpose, no question
  log(`auto fields received: ${names(auto.fields)} (absent = unknown, never a guess)`);
  try {
    await store.fields(sessionId, ['shipping_address'], 'checkout');
    log('UNEXPECTED: the address before the person accepted');
  } catch (error) {
    if (!isWorkspaceError(error, 'PURPOSE_MISMATCH')) throw error;
    log('shipping_address before the person accepted: 403 PURPOSE_MISMATCH, as designed');
  }
  const quote = await store.quote({ intentId: intent.id, text: 'Sample · Trail shoe in your size', price: 9900 }, `quote-${intent.id}`);
  log(`quoted ${quote.id}`);

  // The person (or their assistant) accepts. Then, on `accepted`, the address is released for checkout, with a receipt.
  const accepted = arrival('accepted');
  if (personalKey) {
    const result = await new WorkspaceClient({ baseUrl: url, key: personalKey }).accept(quote.id, `accept-${quote.id}`);
    log(`[demo shortcut] the person accepted the quote: ${result.status}`);
  } else {
    log('waiting for the person to accept the quote');
  }
  await accepted;
  const ship = await store.fields(sessionId, ['shipping_address'], 'checkout');
  log(`checkout: received ${names(ship.fields)} (value not printed; the person has a receipt for it)`);

  // payment_method never reaches a store, whatever it asks: the workspace authorizes payment itself.
  try {
    await store.fields(sessionId, ['payment_method'], 'payment');
    log('UNEXPECTED: payment_method was released');
  } catch (error) {
    if (!isWorkspaceError(error, 'SCOPE_DENIED')) throw error;
    log('payment_method: 403 SCOPE_DENIED, refused as designed');
  }

  await store.setNote(sessionId, 'fit', 'Sample: prefers a wide toe box'); // the store's own note, at most 2 KB
  const s = await store.stats();
  log(`stats: sessions ${s.sessions}, quotes ${s.quotes}, accepted ${s.accepted}, win rate ${s.winRate}`);
} catch (error) {
  if (isWorkspaceError(error)) log(`the workspace refused: ${error.status} ${error.code}`);
  else log(`failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
} finally {
  server.close();
}
