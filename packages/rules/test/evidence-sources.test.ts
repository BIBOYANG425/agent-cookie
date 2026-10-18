import { describe, expect, it } from 'vitest';
import { mergeCard, renderCard, type LearningContribution } from '../src/index.js';

const now = '2026-10-17T12:00:00.000Z';
const day = 86400000;
const ago = (days: number) => new Date(Date.parse(now) - days * day).toISOString();
const options = { now, personalAgentIds: ['personal'] };
const row = (id: string, extra: Partial<LearningContribution> = {}): LearningContribution => ({
  id, userId: 'u', agentId: 'personal', field: 'pref.fit', value: 'relaxed', basis: 'inferred', createdAt: now, ...extra,
});

describe('B49 writer and independent evidence sources', () => {
  it('keeps ordinary merchant observations writer-based despite evidence metadata', () => {
    const records = [row('one', { field: 'shoe_size', value: '42', agentId: 'shop', basis: 'observed', evidence: { conversationId: 'one' } }),
      row('two', { field: 'shoe_size', value: '42', agentId: 'shop', basis: 'observed', evidence: { conversationId: 'two' } })];
    expect(mergeCard(records, options)).toMatchObject({ card: [], candidates: [{ field: 'shoe_size', sources: ['shop'], evidenceSources: ['conversation:one', 'conversation:two'] }] });
    const independentWriter = { ...records[1]!, agentId: 'second', evidence: { conversationId: 'one' } };
    expect(mergeCard([records[0]!, independentWriter], options).card).toMatchObject([
      { field: 'shoe_size', confidence: 'high', sources: ['second', 'shop'], evidenceSources: ['conversation:one'] },
    ]);
  });

  it('never promotes ordinary inferred fields even with independent conversation evidence', () => {
    const result = mergeCard([row('one', { field: 'tone', evidence: { conversationId: 'one' } }),
      row('two', { field: 'tone', agentId: 'other', evidence: { conversationId: 'two' } })], options);
    expect(result).toMatchObject({ card: [], candidates: [{ field: 'tone', reason: 'inferred', sources: ['other', 'personal'], evidenceSources: ['conversation:one', 'conversation:two'] }] });
  });

  it('keeps pref observations without source IDs as candidates even when two writers agree', () => {
    const result = mergeCard([row('one', { agentId: 'one', basis: 'observed' }), row('two', { agentId: 'two', basis: 'observed' })], options);
    expect(result).toMatchObject({ card: [], candidates: [{ field: 'pref.fit', sources: ['one', 'two'], evidenceSources: [], reason: 'single_source' }] });
  });

  it('distinguishes independent preference conversations from repeated reports by different writers', () => {
    const first = row('one', { evidence: { conversationId: 'one' } });
    const repeated = row('copy', { agentId: 'other', evidence: { conversationId: 'one' } });
    const independent = row('two', { evidence: { conversationId: 'two' } });
    const single = mergeCard([first, repeated], options);
    expect(single.card).toEqual([]);
    expect(single.candidates[0]).toMatchObject({ sources: ['other', 'personal'], evidenceSources: ['conversation:one'] });
    expect(mergeCard([first, independent], options).card[0]).toMatchObject({ confidence: 'medium', sources: ['personal'], evidenceSources: ['conversation:one', 'conversation:two'] });
  });

  it('returns one canonical conversation source for intent aliases, even through revoked bridges', () => {
    const records = [row('bridge', { evidence: { conversationId: 'conversation', intentId: 'intent' }, revokedAt: now }),
      row('copy', { evidence: { intentId: 'intent' } }), row('same', { agentId: 'other', evidence: { conversationId: 'conversation' } })];
    const result = mergeCard(records, options);
    expect(result.card).toEqual([]);
    expect(result.candidates[0]).toMatchObject({ evidenceSources: ['conversation:conversation'] });
    expect(result).toEqual(mergeCard([...records].reverse(), options));
  });

  it('keeps same-text conversation and intent IDs distinct unless an explicit record aliases them', () => {
    const records = [row('conversation', { evidence: { conversationId: 'same' } }), row('intent', { evidence: { intentId: 'same' } })];
    expect(mergeCard(records, options).card[0]).toMatchObject({ evidenceSources: ['conversation:same', 'intent:same'], confidence: 'medium' });
  });

  it('keeps the personal stated exception medium without inventing an evidence identifier', () => {
    expect(mergeCard([row('statement', { basis: 'stated' })], options).card[0]).toMatchObject({ confidence: 'medium', sources: ['personal'], evidenceSources: [], changedRecently: false });
  });

  it('drops revoked and expired preference sources from both promotion and the reported source count', () => {
    const first = row('one', { evidence: { conversationId: 'one' } });
    for (const second of [row('two', { evidence: { conversationId: 'two' }, revokedAt: now }),
      row('two', { evidence: { conversationId: 'two' }, createdAt: ago(366) })]) {
      const result = mergeCard([first, second], options);
      expect(result.card).toEqual([]);
      expect(result.candidates[0]).toMatchObject({ evidenceSources: ['conversation:one'] });
    }
    const boundary = row('two', { evidence: { conversationId: 'two' }, createdAt: ago(365) });
    expect(mergeCard([first, boundary], options).card[0]).toMatchObject({ confidence: 'medium', evidenceSources: ['conversation:one', 'conversation:two'] });
  });

  it('reports only evidence after a different personal statement when determining promotion support', () => {
    const result = mergeCard([row('statement', { basis: 'stated', value: 'fitted', createdAt: ago(3) }),
      row('old', { evidence: { conversationId: 'old' }, createdAt: ago(4) }),
      row('one', { evidence: { conversationId: 'one' }, createdAt: ago(2) }),
      row('two', { evidence: { conversationId: 'two' }, createdAt: ago(1) })], options);
    expect(result.card[0]).toMatchObject({ value: 'relaxed', evidenceSources: ['conversation:one', 'conversation:two'] });
  });

  it('returns no invented evidence IDs for legacy cards and retains 180/365-day decay', () => {
    for (const age of [180, 181, 365]) {
      const result = mergeCard([row('one', { field: 'shoe_size', value: '42', basis: 'observed', agentId: 'one', createdAt: ago(age) }),
        row('two', { field: 'shoe_size', value: '42', basis: 'observed', agentId: 'two', createdAt: ago(age) })], options);
      expect(result.card[0]).toMatchObject({ confidence: age === 180 ? 'high' : 'medium', evidenceSources: [] });
    }
  });

  it('renders evidence identities separately from writers in CARD.md card and candidate lines', () => {
    const result = mergeCard([row('one', { evidence: { conversationId: 'one' } }), row('two', { evidence: { conversationId: 'two' } }),
      row('candidate', { field: 'pref.color', value: 'blue', evidence: { intentId: 'candidate' } })], options);
    const text = renderCard(result, { userId: 'u', generatedAt: now });
    expect(text).toContain('sources: personal; evidenceSources: conversation:one, conversation:two');
    expect(text).toContain('sources: personal; evidenceSources: intent:candidate');
  });
});
