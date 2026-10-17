import { describe, expect, it } from 'vitest';
import { mergeCard, mergeLearningCard, type LearningContribution } from '../src/index.js';

const now = '2026-10-17T12:00:00.000Z';
const day = 86400000;
const ago = (days: number) => new Date(Date.parse(now) - days * day).toISOString();
const options = { now, personalAgentIds: ['personal'] };
const row = (id: string, extra: Partial<LearningContribution> = {}): LearningContribution => ({
  id, userId: 'u', agentId: 'personal', field: 'pref.fit', value: 'relaxed', basis: 'inferred', createdAt: ago(0), ...extra,
});

describe('dynamic learning · TODO(contract)', () => {
  it('promotes a personal stated preference immediately at medium', () => {
    expect(mergeCard([row('a', { basis: 'stated' })], options).card).toEqual([
      { field: 'pref.fit', value: 'relaxed', confidence: 'medium', sources: ['personal'], updatedAt: now, lastSupportedAt: now, changedRecently: false },
    ]);
  });

  it('keeps one inference as candidate and promotes two independent intents from the same writer at medium', () => {
    const a = row('a', { intentId: 'intent-a' });
    expect(mergeCard([a], options).card).toEqual([]);
    expect(mergeCard([a], options).candidates).toEqual([{ field: 'pref.fit', value: 'relaxed', sources: ['personal'], reason: 'inferred' }]);
    const result = mergeCard([a, row('b', { intentId: 'intent-b' })], options);
    expect(result.card[0]).toMatchObject({ field: 'pref.fit', confidence: 'medium', sources: ['personal'] });
    expect(result.candidates).toEqual([]);
  });

  it('does not count repeated records or agents in the same conversation twice', () => {
    const records = [row('a', { conversationId: 'same' }), row('b', { agentId: 'other', conversationId: 'same' })];
    expect(mergeCard(records, options).card).toEqual([]);
    expect(mergeCard([...records, row('c', { conversationId: 'different' })], options).card[0]?.confidence).toBe('medium');
  });

  it('prefers conversationId over several intent IDs copied from the same conversation', () => {
    expect(mergeCard([
      row('a', { conversationId: 'same', intentId: 'one' }),
      row('b', { conversationId: 'same', intentId: 'two' }),
    ], options).card).toEqual([]);
  });

  it('counts a mixed conversation-plus-intent record and its intent-only copy as one source', () => {
    const records = [row('a', { conversationId: 'c', intentId: 'i' }), row('b', { intentId: 'i' })];
    const result = mergeCard(records, options);
    expect(result.card).toEqual([]);
    expect(result.candidates).toEqual([{ field: 'pref.fit', value: 'relaxed', sources: ['personal'], reason: 'inferred' }]);
    expect(result).toEqual(mergeCard([...records].reverse(), options));
    expect(mergeCard([...records, row('independent', { intentId: 'other' })], options).card[0]?.confidence).toBe('medium');
  });

  it('resolves transitive source aliases without conflating the intent and conversation namespaces', () => {
    const records = [row('a', { intentId: 'i1', conversationId: 'c1' }),
      row('b', { intentId: 'i2', conversationId: 'c1' }), row('c', { intentId: 'i2', conversationId: 'c2' }),
      row('d', { conversationId: 'c2' }), row('e', { intentId: 'i1' })];
    for (let offset = 0; offset < records.length; offset++) {
      const permutation = [...records.slice(offset), ...records.slice(0, offset)].reverse();
      expect(mergeCard(permutation, options).card).toEqual([]);
      const independent = [...permutation, row('independent', { conversationId: 'other' })];
      expect(mergeCard(independent, options).card[0]?.confidence).toBe('medium');
      expect(mergeCard(independent, options)).toEqual(mergeCard([...independent].reverse(), options));
    }
    expect(mergeCard([row('intent', { intentId: 'same-text' }), row('conversation', { conversationId: 'same-text' })], options).card[0]?.confidence).toBe('medium');
  });

  it('retains identity aliases when their bridge is revoked or expires so neither event promotes copies', () => {
    const copies = [row('intent-copy', { intentId: 'i', createdAt: ago(1) }),
      row('conversation-copy', { conversationId: 'c', createdAt: ago(1) })];
    const bridge = row('bridge', { intentId: 'i', conversationId: 'c', value: 'other', createdAt: ago(364) });
    for (const history of [bridge, { ...bridge, revokedAt: now }, { ...bridge, createdAt: ago(366) }]) {
      const records = [...copies, history];
      expect(mergeCard(records, options).card).toEqual([]);
      expect(mergeCard(records, options)).toEqual(mergeCard([...records].reverse(), options));
    }
    expect(mergeCard([...copies, bridge], { ...options, now: ago(-2) }).card).toEqual([]);
  });

  it('applies metadata-aware promotion to existing fields but missing provenance never qualifies', () => {
    expect(mergeCard([row('a', { field: 'tone', intentId: 'a' }), row('b', { field: 'tone', intentId: 'b' })], options).card[0]?.field).toBe('tone');
    expect(mergeLearningCard([row('a'), row('b', { agentId: 'other' })], options).card).toEqual([]);
  });

  it('does not combine values, revoked evidence, expired evidence or invalid provenance', () => {
    const single = row('a', { intentId: 'a' });
    for (const second of [
      row('b', { intentId: 'b', value: 'tight' }), row('b', { intentId: 'b', revokedAt: now }),
      row('b', { intentId: 'b', createdAt: ago(366) }), row('b', { intentId: '  ' }),
      row('b', { intentId: 'b', evidence: 'x'.repeat(201) }),
    ]) expect(mergeCard([single, second], options).card).toEqual([]);
  });

  it('keeps inferred confidence medium through 180 days and expires beyond 365 days', () => {
    for (const age of [180, 181, 365, 365 + 1 / day]) {
      const result = mergeCard([row('a', { intentId: 'a', createdAt: ago(age) }), row('b', { intentId: 'b', createdAt: ago(age) })], options);
      expect(result.card).toHaveLength(age > 365 ? 0 : 1);
      if (age <= 365) expect(result.card[0]).toMatchObject({ confidence: 'medium', lastSupportedAt: ago(age) });
    }
  });

  it('preserves observed consensus and decay for dynamic fields', () => {
    for (const age of [180, 181, 366]) {
      const result = mergeCard([row('a', { agentId: 'a', basis: 'observed', createdAt: ago(age) }), row('b', { agentId: 'b', basis: 'observed', createdAt: ago(age) })], options);
      expect(result.card).toHaveLength(age > 365 ? 0 : 1);
      if (age <= 365) expect(result.card[0]?.confidence).toBe(age <= 180 ? 'high' : 'medium');
    }
  });

  it('requires two independent sources after an explicit personal statement to replace it', () => {
    const result = mergeCard([
      row('p', { basis: 'stated', value: 'fitted', createdAt: ago(3) }),
      row('a', { intentId: 'a', createdAt: ago(4) }), row('b', { intentId: 'b' }),
    ], options);
    expect(result.card[0]).toMatchObject({ value: 'fitted', confidence: 'medium' });
    const later = mergeCard([
      row('p', { basis: 'stated', value: 'fitted', createdAt: ago(3) }),
      row('a', { intentId: 'a', createdAt: ago(2) }), row('b', { intentId: 'b', createdAt: ago(1) }),
    ], options);
    expect(later.card[0]).toMatchObject({ value: 'relaxed', confidence: 'medium' });
  });

  it('lets newer independent inference replace older observed consensus and older promoted preference', () => {
    const fresh = [row('a', { intentId: 'a', createdAt: ago(1) }), row('b', { intentId: 'b' })];
    for (const older of [
      [row('old-a', { basis: 'observed', agentId: 'shop-a', value: 'fitted', createdAt: ago(4) }), row('old-b', { basis: 'observed', agentId: 'shop-b', value: 'fitted', createdAt: ago(3) })],
      [row('old-a', { intentId: 'old-a', value: 'fitted', createdAt: ago(4) }), row('old-b', { intentId: 'old-b', value: 'fitted', createdAt: ago(3) })],
    ]) {
      const result = mergeCard([...older, ...fresh], options);
      expect(result.card[0]).toMatchObject({ value: 'relaxed', confidence: 'medium' });
      expect(result.superseded).toEqual([expect.objectContaining({ value: 'fitted', supersededBy: 'relaxed' })]);
    }
  });

  it('refreshes support time when fresh independent sources confirm the same personal stated value', () => {
    const records = [row('p', { basis: 'stated', createdAt: ago(300) }),
      row('a', { agentId: 'writer-a', intentId: 'a', createdAt: ago(1) }),
      row('b', { agentId: 'writer-b', intentId: 'b' })];
    const result = mergeCard(records, options);
    expect(result.card[0]).toMatchObject({ value: 'relaxed', confidence: 'medium', updatedAt: now,
      lastSupportedAt: now, sources: ['personal', 'writer-a', 'writer-b'] });
    expect(result.superseded).toEqual([]);
    expect(result.candidates).toEqual([]);
    expect(result).toEqual(mergeCard([...records].reverse(), options));
  });

  it('does not use future evidence as support, a candidate or a personal statement barrier', () => {
    const fresh = [row('a', { intentId: 'a', createdAt: ago(1) }), row('b', { intentId: 'b' })];
    expect(mergeCard([fresh[0]!, row('future', { intentId: 'future', createdAt: ago(-1) })], options).card).toEqual([]);
    expect(mergeCard([row('future', { basis: 'stated', createdAt: ago(-1) })], options)).toEqual({ card: [], candidates: [], superseded: [] });
    expect(mergeCard([...fresh, row('future', { basis: 'stated', value: 'fitted', createdAt: ago(-1) })], options)).toEqual(mergeCard(fresh, options));
  });

  it('is deterministic, accepts readonly inputs and keeps unrelated pref fields separate', () => {
    const records = Object.freeze([
      Object.freeze(row('a', { intentId: 'a', createdAt: ago(2) })),
      Object.freeze(row('b', { intentId: 'b', createdAt: ago(1) })),
      Object.freeze(row('c', { field: 'pref.color', value: 'blue', basis: 'stated' })),
    ]);
    const before = JSON.stringify(records);
    expect(mergeCard(records, options)).toEqual(mergeCard([...records].reverse(), options));
    expect(mergeCard(records, options).card.map(field => field.field)).toEqual(['pref.color', 'pref.fit']);
    expect(JSON.stringify(records)).toBe(before);
    expect(() => mergeCard(records, { ...options, now: 'invalid' })).toThrow();
  });
});
