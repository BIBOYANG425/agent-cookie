// Sample · an assistant company (a Muse, Dots or Manus) on Agent Cookie, end to end, against a DEMO workspace.
// Logs carry ids, counts and field NAMES only. Values appear once: inside the prompt block the assistant's own model
// reads. Outside this repository: `npm install @agent-cookie/sdk` and import from '@agent-cookie/sdk' instead.
import { randomUUID } from 'node:crypto';
import {
  AssistantClient, LinkNotApprovedError, WorkspaceClient, assistantPrompt, isWorkspaceError, registerAgent,
} from '../../packages/sdk/dist/index.js';

const url = process.env.AGENT_COOKIE_URL ?? 'http://127.0.0.1:4310';
const log = (line) => console.log(`[Sample] ${line}`);
const names = (list) => (list.length ? list.join(', ') : '(none)');

/** Optional: one Claude call writes the first message from the prompt block (raw fetch: this example adds no dependency). */
async function greeting(block) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01', 'anthropic-beta': 'server-side-fallback-2026-07-01' },
    body: JSON.stringify({
      model: 'claude-opus-5-5', max_tokens: 4096, fallbacks: 'default', output_config: { effort: 'low' },
      system: `You are Muse, a personal assistant. Answer with one short greeting line, in the person's language.\n\n${block}`,
      messages: [{ role: 'user', content: 'Hi, I need new trail running shoes.' }],
    }),
  });
  if (!response.ok) return `(Claude API answered ${response.status}; the prompt block above is the output)`;
  const message = await response.json();
  if (message.stop_reason === 'refusal') return '(the model declined; the prompt block above is the output)';
  return message.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}

try {
  // 1. Once, at setup. The key is shown once: keep it in your secret store, never in a log, a prompt or a commit.
  const { agentId, key } = await registerAgent(url, { name: 'Sample · Muse (examples/assistant-sdk)', category: 'assistant' });
  log(`registered assistant ${agentId}`);
  const muse = new AssistantClient({ baseUrl: url, key, sample: true });

  // 2. Ask the person once. They approve in their console, CLI or gateway; nothing approves automatically.
  const link = await muse.requestLink();
  log(`consent link ${link.id} (${link.status}, expires ${link.expiresAt})`);
  log(`Continue with Agent Cookie: ${link.url}`);
  if (process.env.AGENT_COOKIE_OWNER_KEY) {
    // DEMO SHORTCUT: this script plays the owner. A real assistant never holds the owner key.
    log('[demo shortcut] approving the link with AGENT_COOKIE_OWNER_KEY, as the owner would in the console');
    await new WorkspaceClient({ baseUrl: url, key: process.env.AGENT_COOKIE_OWNER_KEY }).approveLink(link.id);
  } else {
    log(`waiting for the owner: agent-cookie links approve ${link.id}  (or the console's 连接请求 panel)`);
  }
  const approved = await muse.waitForLink(link.id, { intervalMs: 1000 });
  log(`approved: pairwise session ${approved.sessionId}`);

  // 3. Every conversation: what the person already told their agents, as a block for the system prompt.
  const ctx = await muse.context();
  log(`context: ${Object.keys(ctx.fields).length} known (${names(Object.keys(ctx.fields))}); `
    + `${ctx.unknown.length} unknown; ${ctx.writable.length} writable; never an address or a payment method`);
  const block = assistantPrompt(ctx);
  console.log("\n---- prompt block · Sample · the only place values are printed: what the assistant's model reads ----");
  console.log(block.trimEnd());
  console.log('---- end of prompt block ----\n');
  if (process.env.ANTHROPIC_API_KEY) log(`first message (Claude, from the block): ${await greeting(block)}`);

  // 4. The person said something worth keeping. Their own words are the evidence (at most 200 characters).
  const kept = await muse.remember({ field: 'pref.brand', value: 'Brooks', basis: 'stated',
    evidence: { conversationId: `sample-chat-${randomUUID().slice(0, 8)}`, snippet: 'Sample: I only run in Brooks' } });
  log(`remembered ${kept.contribution.field}: stored as ${kept.stored} (contribution ${kept.contribution.id})`);

  // 5. Act for them. The workspace introduces stores and hands the address to the store at checkout, not to us.
  const found = await muse.find({ text: 'Sample · trail running shoes under $120', public: { budget: '120' } }, `find-${randomUUID()}`);
  log(`intent ${found.intentId}: ${found.quotes.length} quote(s)${found.sample ? ' · fixture replay, not real inventory' : ''}`);
  if (found.quotes.length > 0) {
    const chosen = found.quotes[0]; // in a real chat: the quote the person picked
    const result = await muse.accept(chosen.id, `accept-${chosen.id}`);
    log(`accepted quote ${chosen.id}: ${result.status}${result.continueUrl ? ' (the person finishes on the store page)' : ''}`);
  }

  // 6. Counts only. questionsSkipped = field names served by policy, summed over this assistant's intents' receipts.
  const s = await muse.stats();
  log(`stats: intents ${s.intents}, quoted ${s.quoted}, accepted ${s.accepted}, completed ${s.completed}, `
    + `questions skipped ${s.questionsSkipped}`);
} catch (error) {
  if (error instanceof LinkNotApprovedError) log(`the link was not approved: ${error.reason}`);
  else if (isWorkspaceError(error)) log(`the workspace refused: ${error.status} ${error.code}`);
  else log(`failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exitCode = 1;
}
