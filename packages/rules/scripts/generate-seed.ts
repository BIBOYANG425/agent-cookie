import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { POLICY_TABLE, isField, type Agent, type Contribution, type SeedAddress, type SeedUser } from '@agent-cookie/contract';
import { rules } from '../src/index.js';

// POLICY_TABLE contains nested maps and string lists. Emit YAML block collections;
// JSON string quoting is also valid YAML and keeps special scalar values literal.
export function renderPolicyYaml(table: Readonly<Record<string, unknown>> = POLICY_TABLE): string {
  const mapping = (value: Readonly<Record<string, unknown>>, indent: number): string[] => Object.entries(value).flatMap(([key, item]) => {
    const label = /^[A-Za-z_][A-Za-z0-9_.-]*$/u.test(key) ? key : JSON.stringify(key);
    const prefix = `${' '.repeat(indent)}${label}:`;
    if (Array.isArray(item)) {
      if (!item.every((entry) => typeof entry === 'string')) throw new TypeError('Policy lists must contain strings');
      return item.length === 0 ? [`${prefix} []`] : [prefix, ...item.map((entry) => `${' '.repeat(indent + 2)}- ${JSON.stringify(entry)}`)];
    }
    if (item !== null && typeof item === 'object') {
      const entries = Object.keys(item);
      return entries.length === 0 ? [`${prefix} {}`] : [prefix, ...mapping(item as Record<string, unknown>, indent + 2)];
    }
    throw new TypeError('Policy values must be maps or string lists');
  });
  return '# Generated from @agent-cookie/contract POLICY_TABLE. Sample seed.\n' + mapping(table, 0).join('\n') + '\n';
}

export async function generateSeed(options: { fixturesDir?: string; seedDir?: string } = {}): Promise<void> {
  // Sample data only. The date is injected into the rules, never taken from the clock.
  const fixtures = options.fixturesDir ?? fileURLToPath(new URL('../../../fixtures/', import.meta.url));
  const seed = options.seedDir ?? join(fixtures, 'memory');
  const json = async <T>(name: string): Promise<T> => JSON.parse(await readFile(join(fixtures, name), 'utf8'));
  const [users, agents, explicitContributions, address] = await Promise.all([
    json<SeedUser[]>('users.json'), json<Agent[]>('agents.json'), json<Contribution[]>('contributions.json'),
    json<SeedAddress | null>('address.json').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; }),
  ]);
  const contributions = explicitContributions.filter((c) => isField(c.field));
  if (users.length !== 1 || contributions.some((c) => c.userId !== users[0]!.userId)) {
    throw new Error('Seed generation requires exactly one Sample user');
  }
  const latest = () => contributions.reduce((last, c) => Math.max(last, Date.parse(c.createdAt) || 0), 0);
  const personal = agents.find((agent) => agent.category === 'personal');
  // Mirror apps/workspace/src/seed.ts:loadFixtures (main 32490f1), without importing workspace runtime.
  // Keep contributions.json's three explicit records; derive the same fourth Sample record for Git's initial commit.
  if (address?.field === 'shipping_address' && typeof address.value === 'string' && address.value && personal
    && !contributions.some((c) => c.field === 'shipping_address')) {
    contributions.push({ id: 'seed-shipping-address-01', userId: users[0]!.userId, agentId: personal.agentId,
      field: 'shipping_address', value: address.value, basis: 'stated',
      createdAt: new Date((latest() || Date.parse('2026-10-17T00:00:00.000Z')) + 1000).toISOString() });
  }
  const generatedAt = new Date(Math.max(Date.parse('2026-10-17T16:00:02.000Z'), latest())).toISOString();
  const card = rules.mergeCard(contributions, {
    now: generatedAt, personalAgentIds: agents.filter((a) => a.category === 'personal').map((a) => a.agentId),
  });
  for (const name of ['contributions', 'notes', 'archive']) await mkdir(join(seed, name), { recursive: true });
  await writeFile(join(seed, 'MEMORY.md'), 'Sample memory: synthetic demonstration account; CARD is generated from contributions.\n\n'
    + '## Index\n- [[CARD]]\n- [[contributions/sample-personal-photon]]\n- [[receipts]]\n- [[POLICY.yaml]]\n- [[archive/README]]\n');
  await writeFile(join(seed, 'CARD.md'), rules.renderCard(card, { userId: users[0]!.userId, generatedAt }));
  await writeFile(join(seed, 'POLICY.yaml'), renderPolicyYaml());
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
  await writeFile(join(seed, 'notes/.gitkeep'), '');
  await writeFile(join(seed, 'archive/README.md'), '# Sample archive\n\nReserved for archived memory records. No archived records in this seed.\n');
  await rm(join(seed, 'archive/.gitkeep'), { force: true });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await generateSeed();
  console.log('Generated Sample memory seed from the current contract policy.');
}
