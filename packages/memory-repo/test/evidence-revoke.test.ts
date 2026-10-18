import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { rules, type LearningContribution } from '@agent-cookie/rules';
import { AT, contribution, fixture, meta, repoGit } from './helpers.js';

const temps: string[] = [];
afterEach(async () => { await Promise.all(temps.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function setup() { const f = await fixture(); temps.push(f.temp); return f; }

it('revokes a conversation across writer files in one commit while retaining open metadata and CARD', async () => {
  const f = await setup();
  for (const [agentId, extra] of [
    ['desktop', '; evidenceFormat: nested; evidenceConversationId: shared-chat; evidenceIntentId: desktop-intent'],
    ['photon', '; evidenceFormat: nested; evidenceConversationId: shared-chat; evidenceIntentId: photon-intent'],
    ['preview', '; conversationId: shared-chat; intentId: preview-intent'],
    ['format-only', '; source: conversation/shared-chat'],
  ]) await writeFile(join(f.seedDir, 'contributions', `${agentId}.md`),
    `- tone: brief [id: ${agentId}; basis: stated; at: ${AT}${extra}; vendor.note: keep%3B %5Bx%5D]\n`);
  const repo = await f.open(); const git = repoGit(f.path);
  const card = await readFile(join(f.path, 'CARD.md'));
  const previous = await git.revparse(['HEAD']);
  const ref = await repo.revokeContribution({ evidence: { conversationId: 'shared-chat' } }, AT, meta('workspace'));
  expect(ref.sha).not.toBe('');
  expect((await git.raw(['show', '-s', '--format=%P', ref.sha])).trim()).toBe(previous);
  expect((await git.raw(['show', '--pretty=format:', '--name-only', ref.sha])).trim().split('\n')).toEqual([
    'contributions/desktop.md', 'contributions/photon.md', 'contributions/preview.md',
  ]);
  expect((await git.raw(['rev-list', '--count', `${previous}..HEAD`])).trim()).toBe('1');
  expect(await readFile(join(f.path, 'CARD.md'))).toEqual(card);
  const reopened = await f.open();
  const rows = await reopened.listContributions();
  expect(rows.filter(row => row.revokedAt === AT).map(row => row.id)).toEqual(['desktop', 'photon', 'preview']);
  expect(rows.find(row => row.id === 'format-only')?.revokedAt).toBeUndefined();
  for (const row of rows) expect(rules.renderContribution(row)).toContain('vendor.note: keep%3B %5Bx%5D');
});

it('uses AND for two source IDs, retains the string ID overload, and makes no unmatched commit', async () => {
  const f = await setup(); const repo = await f.open(); const git = repoGit(f.path);
  for (const n of [1, 2]) await repo.appendContribution({ ...contribution(`source-${n}`),
    evidence: { intentId: 'shared-intent', conversationId: `chat-${n}` } }, meta());
  await repo.revokeContribution({ evidence: { intentId: 'shared-intent', conversationId: 'chat-1' } }, AT, meta('workspace'));
  expect((await repo.listContributions()).map(row => row.revokedAt)).toEqual([AT, undefined]);
  const head = await git.revparse(['HEAD']);
  expect(await repo.revokeContribution({ evidence: { intentId: 'missing' } }, AT, meta('workspace'))).toEqual({ sha: '' });
  expect(await git.revparse(['HEAD'])).toBe(head);
  await repo.revokeContribution('source-2', AT, meta('workspace'));
  expect((await repo.listContributions()).map(row => row.revokedAt)).toEqual([AT, AT]);
});

it('rejects empty or ambiguous selectors and conflicting preview aliases before changing history', async () => {
  const f = await setup(); const repo = await f.open(); const git = repoGit(f.path);
  const head = await git.revparse(['HEAD']);
  for (const target of [null, {}, { evidence: {} }, { evidence: { snippet: 'not an ID' } },
    { evidence: { intentId: ' ' } }, { evidence: { intentId: '\0' } },
    { evidence: { conversationId: 7 } }, { evidence: { intentId: 'source' }, agentId: 'photon' }]) {
    await expect(repo.revokeContribution(target as never, AT, meta('workspace'))).rejects.toMatchObject({ code: 'MISSING_FIELD' });
  }
  const ambiguous: LearningContribution = { ...contribution(), intentId: 'preview', evidence: { intentId: 'canonical' } };
  await expect(repo.appendContribution(ambiguous as never, meta())).rejects.toMatchObject({ code: 'MISSING_FIELD' });
  expect(await git.revparse(['HEAD'])).toBe(head);
});
