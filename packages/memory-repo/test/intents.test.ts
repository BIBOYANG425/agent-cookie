import { readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { LearningContribution } from '@agent-cookie/rules';
import type { AppendIntentInput } from '../src/index.js';
import { AT, USER, contribution, fixture, meta, repoGit } from './helpers.js';

const temps: string[] = [];
async function setup() {
  const f = await fixture();
  temps.push(f.temp);
  return f;
}
afterEach(async () => { await Promise.all(temps.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

const extracted = (evidence = '用户明确偏好越野鞋'): LearningContribution => ({
  ...contribution('learning-1'), field: 'pref.style', value: 'trail',
  intentId: 'need-1', conversationId: 'conversation-1', evidence,
});
const input = (): AppendIntentInput => ({
  intent: { id: 'need-1', userId: USER, kind: 'shopping', expiresAt: '2026-10-18T12:00:00.000Z' },
  extracted: [extracted()], chosenQuote: { id: 'quote-1', agentId: 'store-a', price: 12000, currency: 'USD' },
});

describe('C18 sanitized intent history', () => {
  it('commits one escaped record with literal personal author and drops raw input properties', async () => {
    const f = await setup();
    const repo = await f.open();
    const original = input();
    const raw = 'RAW_CONVERSATION_DO_NOT_STORE';
    const unsafe = {
      ...original, text: raw, query: raw, transcript: raw, body: raw,
      intent: { ...original.intent, text: raw, public: { query: raw, budget: 'raw budget prose' }, createdAt: '1999-01-01' },
      extracted: [{ ...extracted('偏好: 越野; [%0A]\n\u2028\u2029'), text: raw, body: raw, conversation: raw }],
      chosenQuote: { ...original.chosenQuote!, text: raw, query: raw, title: raw, body: raw },
    };
    const write = meta('personal');
    const committed = await repo.appendIntent(unsafe, write);
    expect(await readdir(join(f.path, 'intents'))).toEqual(['2026-10-17-need-1.md']);
    const markdown = await readFile(join(f.path, 'intents', '2026-10-17-need-1.md'), 'utf8');
    expect(markdown.trimEnd().split('\n')).toHaveLength(1);
    expect(markdown).toContain('- intent: need-1 [');
    expect(markdown).toContain('conversationId: conversation-1');
    expect(markdown).toContain('pref.style');
    expect(markdown).not.toContain(raw);
    expect(markdown).not.toContain('raw budget prose');
    expect(markdown).not.toContain('1999-01-01');
    const commit = await repoGit(f.path).raw(['show', '-s', '--format=%an%n%aI%n%B', committed.sha]);
    expect(commit.startsWith('personal\n')).toBe(true);
    expect(commit).toContain(`Agent-Cookie-Sig: ${write.sig}`);
    const found = await repo.searchIntents('TRAIL 越野');
    expect(found).toHaveLength(1);
    expect(Object.keys(found[0]!).sort()).toEqual(['date', 'intentId', 'summary']);
    expect(found[0]).toMatchObject({ date: '2026-10-17', intentId: 'need-1' });
    expect(found[0]!.summary).not.toContain(raw);
    expect(found[0]!.summary).not.toContain('conversation-1');
    expect(found[0]!.summary).not.toMatch(/[\r\n\u2028\u2029]/u);
  });

  it('accepts a text-driven intent without inventing kind or persisting its text', async () => {
    const f = await setup();
    const repo = await f.open();
    const { kind: _kind, ...intent } = input().intent;
    await repo.appendIntent({ ...input(), intent: { ...intent, text: 'PRIVATE_REQUEST_RAW_TEXT' } } as AppendIntentInput, meta('personal'));
    const markdown = await readFile(join(f.path, 'intents', '2026-10-17-need-1.md'), 'utf8');
    expect(markdown).not.toContain('kind:');
    expect(markdown).not.toContain('PRIVATE_REQUEST_RAW_TEXT');
    const found = await repo.searchIntents('trail');
    expect(found).toHaveLength(1);
    expect(found[0]!.summary).toContain('pref.style=trail');
    expect(found[0]!.summary).not.toContain('shopping');
  });

  it('rejects overlong evidence/value, non-personal authors and mismatched identities without a commit', async () => {
    const f = await setup();
    const repo = await f.open();
    const git = repoGit(f.path);
    const before = await git.revparse(['HEAD']);
    await expect(repo.appendIntent({ ...input(), extracted: [extracted('鞋'.repeat(201))] }, meta('personal')))
      .rejects.toMatchObject({ code: 'MISSING_FIELD' });
    await expect(repo.appendIntent({ ...input(), extracted: [{ ...extracted(), value: 'x'.repeat(201) }] }, meta('personal')))
      .rejects.toMatchObject({ code: 'MISSING_FIELD' });
    await expect(repo.appendIntent(input(), meta('store-a'))).rejects.toMatchObject({ code: 'SCOPE_DENIED' });
    await expect(repo.appendIntent({ ...input(), intent: { ...input().intent, userId: 'another-user' } }, meta('personal')))
      .rejects.toMatchObject({ code: 'SCOPE_DENIED' });
    await expect(repo.appendIntent({ ...input(), extracted: [{ ...extracted(), userId: 'another-user' }] }, meta('personal')))
      .rejects.toMatchObject({ code: 'SCOPE_DENIED' });
    expect(await git.revparse(['HEAD'])).toBe(before);
    expect((await git.status()).isClean()).toBe(true);
    await repo.appendIntent({ ...input(), extracted: [extracted('👟'.repeat(200))] }, meta('personal'));
    expect((await repo.searchIntents('👟'))[0]!.summary).toContain('👟'.repeat(200));
  });

  it('serializes multiple handles, preserves records on reopen, and returns summaries rather than stored metadata', async () => {
    const f = await setup();
    const [one, two] = await Promise.all([f.open(), f.open()]);
    await Promise.all([
      one.appendIntent(input(), meta('personal')),
      two.appendIntent({ ...input(), extracted: [{ ...extracted('来自第二次需求'), conversationId: 'conversation-2' }] }, meta('personal')),
    ]);
    const reopened = await f.open();
    const found = await reopened.searchIntents('trail');
    expect(found).toHaveLength(2);
    expect(JSON.stringify(found)).not.toContain('conversationId');
    expect(JSON.stringify(found)).not.toContain('expiresAt');
    expect(await reopened.searchIntents('not-present')).toEqual([]);
    expect(await reopened.searchIntents('   ')).toEqual([]);
    expect(await repoGit(f.path).raw(['rev-list', '--count', 'HEAD'])).toBe('3\n');
  });

  it('uses canonical safe dated filenames, validates pref names, and removes intent history on reset', async () => {
    const f = await setup();
    const repo = await f.open();
    const a = { ...input(), intent: { ...input().intent, id: '../A' }, extracted: [] };
    const b = { ...input(), intent: { ...input().intent, id: '../a' }, extracted: [] };
    await repo.appendIntent(a, meta('personal'));
    await repo.appendIntent(b, meta('personal'));
    expect((await readdir(join(f.path, 'intents'))).sort()).toEqual(['2026-10-17-..%2F%41.md', '2026-10-17-..%2Fa.md'].sort());
    await expect(repo.appendIntent({ ...input(), extracted: [{ ...extracted(), field: 'pref.BAD' as LearningContribution['field'] }] }, meta('personal')))
      .rejects.toMatchObject({ code: 'MISSING_FIELD' });
    await repo.resetToSeed();
    expect(await repo.searchIntents('shopping')).toEqual([]);
    expect((await repoGit(f.path).status()).isClean()).toBe(true);
    expect(await readFile(join(f.seedDir, 'MEMORY.md'), 'utf8')).toBe('# Sample memory\n');
  });
});
