import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

const read = async (name) => JSON.parse(await readFile(new URL(name, import.meta.url), 'utf8'));
const [users, agents, contributions, keys, address] = await Promise.all(
  ['users.json', 'agents.json', 'contributions.json', 'dev-keys.json', 'address.json'].map(read),
);
assert.equal(users.length, 1);
assert.deepEqual(Object.keys(users[0]).sort(), ['name', 'secret', 'userId']);
assert.ok(users[0].name.includes('Sample'));
assert.ok(users[0].secret.startsWith('sample-'));
assert.equal(agents.length, 4);
const byId = new Map(agents.map((a) => [a.agentId, a]));
assert.equal(byId.size, 4);
assert.equal(agents.filter((a) => a.category === 'personal').length, 2);
for (const a of agents) assert.ok(['personal', 'shoe', 'assistant'].includes(a.category));
for (const a of agents) assert.ok(a.name.startsWith('Sample · '));
assert.equal(agents.find((a) => a.category === 'shoe').chatEndpoint, 'http://127.0.0.1:8000/api/chat');
// One Sample company assistant (bring-your-own-agent plan). It has no chat endpoint, and no consent link is seeded:
// a link only ever exists because the assistant asked and the owner approved.
const assistants = agents.filter((a) => a.category === 'assistant');
assert.equal(assistants.length, 1);
assert.equal(assistants[0].agentId, 'sample-assistant');
assert.equal(assistants[0].name, 'Sample · Assistant');
assert.equal(assistants[0].chatEndpoint, undefined);
await assert.rejects(access(new URL('links.json', import.meta.url)), { code: 'ENOENT' });
assert.equal(contributions.length, 3);
assert.deepEqual(contributions.map((c) => [c.field, c.value]).sort(), [['lang', 'zh'], ['shoe_size', '42'], ['tone', '简短']]);
assert.equal(new Set(contributions.map((c) => c.id)).size, 3);
for (const c of contributions) {
  assert.equal(c.userId, users[0].userId);
  assert.equal(c.basis, 'stated');
  assert.equal(byId.get(c.agentId)?.category, 'personal');
  assert.ok(Number.isFinite(Date.parse(c.createdAt)));
}
assert.equal(Object.keys(keys).length, 5);
assert.equal(new Set(Object.values(keys).map((k) => k.agentId)).size, 5);
const roleOf = (category) => category === 'personal' ? 'personal' : category === 'assistant' ? 'assistant' : 'merchant';
for (const [key, binding] of Object.entries(keys)) {
  assert.ok(key.endsWith('_sample'));
  assert.deepEqual(Object.keys(binding).sort(), ['agentId', 'role']);
  if (binding.role === 'owner') assert.equal(binding.agentId, 'owner');
  else assert.equal(binding.role, roleOf(byId.get(binding.agentId)?.category));
  assert.ok(binding.role === 'owner' || byId.has(binding.agentId));
}
assert.equal(address.field, 'shipping_address');
assert.ok(address.value.includes('Sample'));
assert.deepEqual(keys.ck_assistant_sample, { agentId: 'sample-assistant', role: 'assistant' });
console.log('Sample seed verified: 1 user, 4 agents (1 assistant), 3 contributions, 5 demo key bindings, 1 address, no links.');
