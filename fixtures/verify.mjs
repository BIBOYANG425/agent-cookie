import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = async (name) => JSON.parse(await readFile(new URL(name, import.meta.url), 'utf8'));
const [users, agents, contributions, keys, address] = await Promise.all(
  ['users.json', 'agents.json', 'contributions.json', 'dev-keys.json', 'address.json'].map(read),
);
assert.equal(users.length, 1);
assert.deepEqual(Object.keys(users[0]).sort(), ['name', 'secret', 'userId']);
assert.ok(users[0].name.includes('Sample'));
assert.ok(users[0].secret.startsWith('sample-'));
assert.equal(agents.length, 3);
const byId = new Map(agents.map((a) => [a.agentId, a]));
assert.equal(byId.size, 3);
assert.equal(agents.filter((a) => a.category === 'personal').length, 2);
for (const a of agents) assert.ok(['personal', 'shoe'].includes(a.category));
assert.equal(agents.find((a) => a.category === 'shoe').chatEndpoint, 'http://127.0.0.1:8000/api/chat');
assert.equal(contributions.length, 3);
assert.deepEqual(contributions.map((c) => [c.field, c.value]).sort(), [['lang', 'zh'], ['shoe_size', '42'], ['tone', '简短']]);
assert.equal(new Set(contributions.map((c) => c.id)).size, 3);
for (const c of contributions) {
  assert.equal(c.userId, users[0].userId);
  assert.equal(c.basis, 'stated');
  assert.equal(byId.get(c.agentId)?.category, 'personal');
  assert.ok(Number.isFinite(Date.parse(c.createdAt)));
}
assert.equal(Object.keys(keys).length, 4);
assert.equal(new Set(Object.values(keys).map((k) => k.agentId)).size, 4);
for (const [key, binding] of Object.entries(keys)) {
  assert.ok(key.endsWith('_sample'));
  assert.deepEqual(Object.keys(binding).sort(), ['agentId', 'role']);
  if (binding.role === 'owner') assert.equal(binding.agentId, 'owner');
  else assert.equal(binding.role, byId.get(binding.agentId)?.category === 'personal' ? 'personal' : 'merchant');
  assert.ok(binding.role === 'owner' || byId.has(binding.agentId));
}
assert.equal(address.field, 'shipping_address');
assert.ok(address.value.includes('Sample'));
console.log('Sample seed verified: 1 user, 3 agents, 3 contributions, 4 demo key bindings, 1 address.');
