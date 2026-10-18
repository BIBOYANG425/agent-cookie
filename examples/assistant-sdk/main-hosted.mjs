// Sample · an assistant company (a Muse, Dots or Manus) on HOSTED jars, through the gateway (apps/gateway), end to end.
// Two keys, two places: the GLOBAL key from registering at the gateway works only there (requestLink, link,
// waitForLink); each approved link hands over one person's jar ({ url, key }), used for everything else.
// Logs carry ids, counts and field NAMES only. Values appear once: inside the prompt block the assistant's own model
// reads. Outside this repository: `npm install @agent-cookie/sdk` and import from '@agent-cookie/sdk' instead.
import { randomUUID } from 'node:crypto';
import { AssistantClient, LinkNotApprovedError, assistantPrompt, isWorkspaceError, registerAgent } from '../../packages/sdk/dist/index.js';

const gatewayUrl = process.env.AGENT_COOKIE_URL ?? 'http://127.0.0.1:4320';
// DEMO SHORTCUT, test-mode gateway (AGENT_COOKIE_TEST=1) only: the script also plays the person.
const testSession = process.argv.includes('--test-session');
const log = (line) => console.log(`[Sample] ${line}`);
const names = (list) => (list.length ? list.join(', ') : '(none)');

/**
 * The person's side, faked for a demo: POST /test/session signs a new person in WITHOUT a passkey (the route exists
 * only on a gateway started with AGENT_COOKIE_TEST=1, never in production), then approves the link the way the consent
 * page's button does (session cookie, same-origin Origin). A real assistant never does this: the person taps the link.
 */
async function playThePerson(linkUrl, linkId) {
  const origin = new URL(linkUrl).origin;
  const session = await fetch(`${origin}/test/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  if (session.status === 404) throw new Error('This gateway is not in test mode (AGENT_COOKIE_TEST=1): open the link and approve with a passkey instead.');
  if (!session.ok) throw new Error(`POST /test/session answered ${session.status}`);
  const cookie = (session.headers.get('set-cookie') ?? '').split(';')[0];
  const { userId } = await session.json();
  const approved = await fetch(`${origin}/links/${encodeURIComponent(linkId)}/approve`, { method: 'POST', headers: { cookie, origin } });
  if (!approved.ok) throw new Error(`POST /links/:id/approve answered ${approved.status}`);
  return { userId, cookie, origin };
}

try {
  // 1. Once, at setup, at the gateway. The global key is shown once: keep it in your secret store, never in a log.
  const { agentId, key } = await registerAgent(gatewayUrl, { name: 'Sample · Muse (examples/assistant-sdk, hosted)', category: 'assistant' });
  log(`registered assistant ${agentId} at the gateway ${gatewayUrl}`);
  const gateway = new AssistantClient({ baseUrl: gatewayUrl, key });

  // 2. Ask the person once. They open the link, sign in (or create their jar) with a passkey, and approve.
  const link = await gateway.requestLink();
  log(`consent link ${link.id} (${link.status}, expires ${link.expiresAt})`);
  log(`Continue with Agent Cookie: ${link.url}`);
  let person;
  if (testSession) {
    log('[demo shortcut · AGENT_COOKIE_TEST=1 gateway only] playing the person: POST /test/session (no passkey), then approve');
    person = await playThePerson(link.url, link.id);
    log(`[demo shortcut] person ${person.userId} approved the link`);
  } else {
    log('waiting for the person to open the link and approve with their passkey');
  }
  const approved = await gateway.waitForLink(link.id, { intervalMs: 1000 });
  if (!approved.jar) throw new Error('The approved link carries no jar: its jar key is readable for a limited time after approval.');
  log(`approved: pairwise session ${approved.sessionId}; jar ${approved.jar.url} (its key stays in your secret store)`);

  // 3. That person's jar: their own instance, this assistant's key in it. Everything below goes there.
  const jar = AssistantClient.forJar(approved.jar, { sample: testSession });
  const ctx = await jar.context();
  log(`context: ${Object.keys(ctx.fields).length} known (${names(Object.keys(ctx.fields))}); `
    + `${ctx.unknown.length} unknown; ${ctx.writable.length} writable; never an address or a payment method`);
  const block = assistantPrompt(ctx);
  console.log("\n---- prompt block · Sample · the only place values are printed: what the assistant's model reads ----");
  console.log(block.trimEnd());
  console.log('---- end of prompt block ----\n');

  // 4. The person said something worth keeping. Their own words are the evidence (at most 200 characters).
  const kept = await jar.remember({ field: 'pref.brand', value: 'Brooks', basis: 'stated',
    evidence: { conversationId: `sample-chat-${randomUUID().slice(0, 8)}`, snippet: 'Sample: I only run in Brooks' } });
  log(`remembered ${kept.contribution.field}: stored as ${kept.stored} (contribution ${kept.contribution.id})`);
  const next = await jar.context();
  log(`context now: ${Object.keys(next.fields).length} known (${names(Object.keys(next.fields))})`);

  // 5. Act for them. Their instance introduces stores and would hand the address to the store at checkout, not to us.
  const found = await jar.find({ text: 'Sample · trail running shoes under $120', public: { budget: '120' } }, `find-${randomUUID()}`);
  log(`intent ${found.intentId}: ${found.quotes.length} quote(s)${found.sample ? ' · fixture replay, not real inventory' : ''}`);
  if (found.quotes.length > 0) {
    const chosen = found.quotes[0]; // in a real chat: the quote the person picked
    const result = await jar.accept(chosen.id, `accept-${chosen.id}`);
    log(`accepted quote ${chosen.id}: ${result.status}${result.continueUrl ? ' (the person finishes on the store page)' : ''}`);
  }

  // 6. Counts only. questionsSkipped = field names served by policy, summed over this assistant's intents' receipts.
  const s = await jar.stats();
  log(`stats: intents ${s.intents}, quoted ${s.quoted}, accepted ${s.accepted}, completed ${s.completed}, `
    + `questions skipped ${s.questionsSkipped}`);

  if (person) {
    // The person's cookie page (GET /me.json with their session): who read which field names, for which purpose.
    const me = await (await fetch(`${person.origin}/me.json`, { headers: { cookie: person.cookie } })).json();
    const byPurpose = {};
    for (const r of me.receipts) byPurpose[r.purpose] = (byPurpose[r.purpose] ?? 0) + 1;
    log(`[demo shortcut] the person's cookie page: ${me.receipts.length} receipt(s) `
      + `(${Object.entries(byPurpose).map(([p, n]) => `${p} ${n}`).join(', ')}), ${me.grants.length} grant(s), ${me.links.length} link(s)`);
  }
} catch (error) {
  if (error instanceof LinkNotApprovedError) log(`the link was not approved: ${error.reason}`);
  else if (isWorkspaceError(error)) log(`refused: ${error.status} ${error.code}`);
  else log(`failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
}
