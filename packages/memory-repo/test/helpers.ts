import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { rules } from '@agent-cookie/rules';
import type { Contribution, Note, WriteMeta } from '@agent-cookie/contract';
import { openMemoryRepo } from '../src/index.js';

export const AT = '2026-10-17T12:00:00.000Z';
export const USER = 'sample-user';
export const meta = (author = 'sample-personal'): WriteMeta => ({
  author, sig: 'test-payload-signature', at: AT,
});
export const contribution = (id = 'c1', agentId = 'sample-personal'): Contribution => ({
  id, agentId, userId: USER, field: 'shoe_size', value: '43', basis: 'stated', createdAt: AT,
});
export const note = (key = 'relationship', value = '回头客\n喜欢越野鞋; [%0A]'): Note => ({
  agentId: 'store-a', userId: USER, key, value, updatedAt: AT,
  expiresAt: '2027-10-17T12:00:00.000Z',
});

export async function fixture() {
  const temp = await mkdtemp(join(tmpdir(), 'agent-cookie-memory-test-'));
  const seedDir = join(temp, 'seed');
  const path = join(temp, 'repo');
  await mkdir(seedDir);
  await Promise.all(['contributions', 'notes', 'archive'].map((name) => mkdir(join(seedDir, name))));
  await Promise.all([
    writeFile(join(seedDir, 'MEMORY.md'), '# Sample memory\n'),
    writeFile(join(seedDir, 'POLICY.yaml'), 'sample: true\n'),
    writeFile(join(seedDir, 'CARD.md'), rules.renderCard(
      { card: [], candidates: [], superseded: [] }, { userId: USER, generatedAt: AT },
    )),
    writeFile(join(seedDir, 'receipts.md'), ''),
  ]);
  const opts = { path, seedDir, userId: USER, rules };
  return { temp, path, seedDir, opts, open: () => openMemoryRepo(opts), git: simpleGit({ baseDir: temp }) };
}

export function repoGit(path: string) {
  return simpleGit({ baseDir: path, config: ['core.fsmonitor=false'] });
}
