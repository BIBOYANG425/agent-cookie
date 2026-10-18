import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Contribution } from '@agent-cookie/contract';
import type { LearningContribution } from '@agent-cookie/rules';
import { AT, USER, contribution, fixture, meta, repoGit } from './helpers.js';

const temps: string[] = [];
async function setup() { const f = await fixture(); temps.push(f.temp); return f; }
afterEach(async () => { await Promise.all(temps.splice(0).map(path => rm(path, { recursive: true, force: true }))); });

describe('shared learning contract default memory-repo integration', () => {
  it('persists nested pref evidence through default openMemoryRepo and preserves it on revoke and reopen', async () => {
    const f = await setup(); const repo = await f.open();
    const rows = [1, 2].map((n): Contribution => ({ ...contribution(`a-${n}`), field: 'pref.fit', basis: 'observed',
      evidence: { conversationId: `conversation-${n}`, snippet: 'I prefer a relaxed fit; [%]\n剪裁' } }));
    for (const c of rows) await repo.appendContribution(c, meta());
    expect(await repo.listContributions()).toEqual(rows);
    expect((await repo.regenerateCard({ now: AT, personalAgentIds: ['sample-personal'] }, meta('workspace'))).card.card)
      .toEqual([{ field: 'pref.fit', value: '43', confidence: 'medium', sources: ['sample-personal'],
        evidenceSources: ['conversation:conversation-1', 'conversation:conversation-2'],
        updatedAt: AT, lastSupportedAt: AT, changedRecently: false }]);
    await repo.revokeContribution('a-1', AT, meta());
    const reopened = await f.open();
    expect(await reopened.listContributions()).toEqual([{ ...rows[0], revokedAt: AT }, rows[1]]);
    expect((await reopened.regenerateCard({ now: AT, personalAgentIds: ['sample-personal'] }, meta('workspace'))).card.card).toEqual([]);
  });

  it('accepts A flat intent records with the actual personal writer, while omitting all raw request text', async () => {
    const f = await setup(); const repo = await f.open();
    const raw = 'RAW_PRIVATE_REQUEST_DO_NOT_STORE';
    const record = { id: 'flat-1', userId: USER, agentId: 'sample-personal', createdAt: AT,
      text: raw, query: raw, kind: 'shopping', public: { budget: '120', color: 'blue', raw, transcript: raw, query: raw },
      chosenQuote: { id: 'quote-1', title: raw, seller: 'sample.example', price: 11900, currency: 'USD' as const } };
    const commit = await repo.appendIntent(record, meta(record.agentId));
    const text = await readFile(join(f.path, 'intents', '2026-10-17-flat-1.md'), 'utf8');
    expect(text).not.toContain(raw);
    expect(text).not.toContain('public');
    expect(text).not.toContain('sample.example');
    expect(text.trimEnd().split('\n')).toHaveLength(1);
    expect((await repoGit(f.path).raw(['show', '-s', '--format=%an', commit.sha])).trim()).toBe('sample-personal');
    const reopened = await f.open();
    expect(await reopened.searchIntents('shopping 11900')).toEqual([{ intentId: 'flat-1', date: '2026-10-17',
      summary: 'shopping; quote-1: 11900 USD' }]);
    expect(await reopened.searchIntents(raw)).toEqual([]);
  });

  it('rejects a flat intent with the wrong author or owner before adding a commit', async () => {
    const f = await setup(); const repo = await f.open();
    const input = { id: 'flat-1', userId: USER, agentId: 'sample-personal', createdAt: AT, public: {} };
    const head = await repoGit(f.path).revparse(['HEAD']);
    await expect(repo.appendIntent(input, meta('different-agent'))).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
    await expect(repo.appendIntent(input, meta('personal'))).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
    await expect(repo.appendIntent({ ...input, userId: 'different-user' }, meta(input.agentId))).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
    expect(await repoGit(f.path).revparse(['HEAD'])).toBe(head);
  });

  it('keeps nested evidence in preview history summaries and rejects a foreign intent or oversized snippet', async () => {
    const f = await setup(); const repo = await f.open();
    const snippet = 'Short evidence; [%0A]\n剪裁\u2028';
    const c: LearningContribution = { ...contribution('nested'), field: 'pref.fit', value: 'relaxed',
      evidence: { intentId: 'need-1', conversationId: 'chat-1', snippet } };
    const input = { intent: { id: 'need-1', userId: USER, expiresAt: AT }, extracted: [c] };
    await repo.appendIntent(input, meta('personal'));
    const reopened = await f.open();
    expect(await reopened.searchIntents('relaxed 剪裁')).toEqual([{ intentId: 'need-1', date: '2026-10-17',
      summary: 'pref.fit=relaxed (Short evidence; [%0A] 剪裁 )' }]);
    const markdown = await readFile(join(f.path, 'intents', '2026-10-17-need-1.md'), 'utf8');
    expect(markdown.trimEnd().split('\n')).toHaveLength(1);
    expect(markdown).toContain('evidence.conversationId: chat-1');
    const head = await repoGit(f.path).revparse(['HEAD']);
    for (const evidence of [{ intentId: 'different-intent', snippet }, { intentId: 'need-1', snippet: '鞋'.repeat(201) }]) {
      await expect(repo.appendIntent({ ...input, extracted: [{ ...c, evidence }] }, meta('personal')))
        .rejects.toMatchObject({ code: 'MISSING_FIELD' });
    }
    expect(await repoGit(f.path).revparse(['HEAD'])).toBe(head);
  });

  it('rejects evidence that cannot survive UTF-8 storage without changing the repository', async () => {
    const f = await setup(); const repo = await f.open();
    const head = await repoGit(f.path).revparse(['HEAD']);
    const metadata = [
      { evidence: '\ud800' }, { evidence: { snippet: '\ud800' } },
      { intentId: '\u0000' }, { evidence: { conversationId: '\u0000' } },
    ];
    for (const value of metadata) {
      // Deliberately invalid runtime evidence must still be rejected by the boundary.
      await expect(repo.appendContribution({ ...contribution(), ...value } as never, meta())).rejects.toMatchObject({ code: 'MISSING_FIELD' });
    }
    expect(await repoGit(f.path).revparse(['HEAD'])).toBe(head);
  });
});
