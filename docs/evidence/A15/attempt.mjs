import { readFile, writeFile } from 'node:fs/promises';
import { WorkspaceClient } from '@agent-cookie/sdk';
const keys = Object.entries(JSON.parse(await readFile(new URL('./fixtures/dev-keys.json', import.meta.url), 'utf8')));
const keyFor = (role) => { const found = keys.find(([, meta]) => meta.role === role); if (!found) throw new Error('Required public Sample role missing'); return found[0]; };
const personal = new WorkspaceClient({ baseUrl: 'http://127.0.0.1:4318', key: keyFor('personal'), sample: true });
const owner = new WorkspaceClient({ baseUrl: 'http://127.0.0.1:4318', key: keyFor('owner'), sample: true });
const observedAt = new Date().toISOString();
const card = await personal.getMyCard();
const input = { kind: 'trail_shoes', public: { budget: '120' } };
const intent = await personal.createIntent(input, 'a15-original-retail-attempt-20261017');
let activity;
for (let i=0; i<30; i++) {
  activity = await owner.getActivity();
  if (activity.activity.some(e => e.event === 'tier0.deliver' && e.object === 'sample-acme')) break;
  await new Promise(resolve => setTimeout(resolve, 500));
}
const receipts = await owner.getReceipts();
const result = { observedAt, workspace: 'http://127.0.0.1:4318', mode: 'Sample; recorded UCP fixtures',
  sdkMethods: ['getMyCard','createIntent','getActivity','getReceipts'], request: { method: 'POST', path: '/personal/intents', body: input },
  cardCheck: { source: card.source, sample: card.sample, shoe_size: card.card.find(f => f.field === 'shoe_size') },
  intent, tier0Receipts: receipts.receipts.filter(r => r.agentId === 'sample-acme' && r.purpose === 'tier0'),
  activity: activity.activity.filter(e => ['tier0.deliver','intent.create'].includes(e.event) || e.event === 'memory.write') };
await writeFile(new URL('./workspace-attempt.json', import.meta.url), JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({ intentCreated: !!intent.intentId, tier0Receipts: result.tier0Receipts.length, deliveryEvents: result.activity.filter(e=>e.event==='tier0.deliver').map(e=>({result:e.result,reason:e.reason})), shoe_size: result.cardCheck.shoe_size?.value }));
