import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { POLICY_TABLE, type Agent, type Contribution, type SeedUser } from '@agent-cookie/contract';
import { rules } from '../src/index.js';

// Sample data only. The date is injected into the rules, never taken from the clock.
const fixtures = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const seed = join(fixtures, 'memory');
const json = async <T>(name: string): Promise<T> => JSON.parse(await readFile(join(fixtures, name), 'utf8'));
const [users, agents, contributions] = await Promise.all([
  json<SeedUser[]>('users.json'), json<Agent[]>('agents.json'), json<Contribution[]>('contributions.json'),
]);
if (users.length !== 1 || contributions.some((c) => c.userId !== users[0]!.userId)) {
  throw new Error('Seed generation requires exactly one Sample user');
}
const generatedAt = '2026-10-17T16:00:02.000Z';
const card = rules.mergeCard(contributions, {
  now: generatedAt, personalAgentIds: agents.filter((a) => a.category === 'personal').map((a) => a.agentId),
});
for (const name of ['contributions', 'notes', 'archive']) await mkdir(join(seed, name), { recursive: true });
await writeFile(join(seed, 'MEMORY.md'), '# Sample memory\n\nSynthetic demonstration account. No real personal information.\n\nCARD.md is generated; do not edit it.\n');
await writeFile(join(seed, 'CARD.md'), rules.renderCard(card, { userId: users[0]!.userId, generatedAt }));
// JSON is a YAML 1.2 subset: preserves the contract table without a second policy implementation.
await writeFile(join(seed, 'POLICY.yaml'), '# Generated from @agent-cookie/contract POLICY_TABLE. Sample seed.\n' + JSON.stringify(POLICY_TABLE, null, 2) + '\n');
const groups = new Map<string, Contribution[]>();
for (const c of contributions) {
  if (!/^[a-z0-9._-]+$/u.test(c.agentId) || c.agentId === '.' || c.agentId === '..') {
    throw new Error('This Sample generator only accepts plain fixture agent IDs');
  }
  groups.set(c.agentId, [...(groups.get(c.agentId) ?? []), c]);
}
for (const [agentId, rows] of groups) {
  await writeFile(join(seed, 'contributions', `${agentId}.md`), rows.map(rules.renderContribution).join('\n') + '\n');
}
await writeFile(join(seed, 'receipts.md'), '# Sample receipts\n\n');
for (const name of ['notes', 'archive']) await writeFile(join(seed, name, '.gitkeep'), '');
console.log(`Generated Sample memory seed: ${contributions.length} contributions, ${card.card.length} card fields.`);
