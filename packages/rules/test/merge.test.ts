import { describe, expect, it } from 'vitest';
import type { Contribution, Field, RulesApi } from '@agent-cookie/contract';
import { mergeCard } from '../src/merge.js';

const now = '2026-10-17T12:00:00.000Z';
const day = 86_400_000;
const ago = (days: number) => new Date(Date.parse(now) - days * day).toISOString();
const options = { now, personalAgentIds: ['personal'] };
function contribution(
  id: string, agentId: string, value: string, daysAgo: number,
  extra: Partial<Contribution> = {},
): Contribution {
  return { id, userId: 'user', agentId, field: 'shoe_size', value, basis: 'observed', createdAt: ago(daysAgo), ...extra };
}
function permutations<T>(items: readonly T[]): T[][] {
  return items.length ? items.flatMap((item, index) => permutations(items.filter((_, at) => at !== index)).map(rest => [item, ...rest])) : [[]];
}

describe('mergeCard qualification and evidence', () => {
  it('requires distinct non-inferred sources, excludes revoked evidence, and never promotes guesses', () => {
    const records = [
      contribution('a1', 'shop-a', '42', 4),
      contribution('a2', 'shop-a', '42', 3),
      contribution('b1', 'shop-b', '42', 2, { basis: 'stated' }),
      contribution('guess', 'shop-c', '42', 0, { basis: 'inferred' }),
      contribution('revoked', 'shop-d', '43', 0, { revokedAt: now }),
      contribution('tone1', 'shop-a', 'brief', 2, { field: 'tone' }),
      contribution('tone2', 'shop-a', 'brief', 1, { field: 'tone' }),
      contribution('tone-guess', 'shop-b', 'brief', 0, { field: 'tone', basis: 'inferred' }),
      contribution('guess1', 'shop-a', '100', 1, { field: 'budget', basis: 'inferred' }),
      contribution('guess2', 'shop-b', '100', 0, { field: 'budget', basis: 'inferred' }),
    ];
    expect(mergeCard(records, options)).toEqual({
      card: [{ field: 'shoe_size', value: '42', confidence: 'high', sources: ['shop-a', 'shop-b'], updatedAt: ago(2), lastSupportedAt: ago(2), changedRecently: false }],
      candidates: [
        { field: 'tone', value: 'brief', sources: ['shop-a'], reason: 'single_source' },
        { field: 'budget', value: '100', sources: ['shop-a', 'shop-b'], reason: 'inferred' },
      ],
      superseded: [],
    });
  });

  it('allows only personal stated as an initial single source, without claiming a change', () => {
    expect(mergeCard([
      contribution('p', 'personal', '42', 0, { basis: 'stated' }),
      contribution('po', 'personal', 'zh', 0, { field: 'lang' }),
      contribution('m', 'shop', 'brief', 0, { field: 'tone', basis: 'stated' }),
    ], options)).toEqual({
      card: [{ field: 'shoe_size', value: '42', confidence: 'medium', sources: ['personal'], updatedAt: now, lastSupportedAt: now, changedRecently: false }],
      candidates: [
        { field: 'lang', value: 'zh', sources: ['personal'], reason: 'single_source' },
        { field: 'tone', value: 'brief', sources: ['shop'], reason: 'single_source' },
      ], superseded: [],
    });
  });

  it('revocation removes a source from quorum and restores the remaining valid evidence', () => {
    const records = [contribution('a', 'a', '42', 2), contribution('b', 'b', '42', 1, { revokedAt: now })];
    expect(mergeCard(records, options)).toEqual({ card: [], candidates: [{ field: 'shoe_size', value: '42', sources: ['a'], reason: 'single_source' }], superseded: [] });
  });
});

describe('mergeCard replacement and a non-cyclic personal barrier', () => {
  it('lets a fresh merchant single source replace active merchant consensus, then confirms it', () => {
    const old = [contribution('old-a', 'a', '42', 90), contribution('old-b', 'b', '42', 89)];
    const fresh = contribution('new-c', 'c', '43', 1);
    const result = mergeCard([...old, fresh], options);
    expect(result.card).toEqual([{ field: 'shoe_size', value: '43', confidence: 'medium', sources: ['c'], updatedAt: ago(1), lastSupportedAt: ago(1), changedRecently: true }]);
    expect(result.superseded).toEqual([{ field: 'shoe_size', value: '42', sources: ['a', 'b'], lastSupportedAt: ago(89), supersededBy: '43' }]);
    expect(result.candidates).toEqual([]);
    expect(mergeCard([...old, fresh, contribution('new-d', 'd', '43', 0)], options).card).toEqual([
      { field: 'shoe_size', value: '43', confidence: 'high', sources: ['c', 'd'], updatedAt: now, lastSupportedAt: now, changedRecently: false },
    ]);
  });

  it('personal stated immediately replaces old consensus and blocks later lone merchants', () => {
    const result = mergeCard([
      contribution('a', 'a', '42', 8), contribution('b', 'b', '42', 7),
      contribution('p', 'personal', '43', 3, { basis: 'stated' }),
      contribution('c', 'c', '44', 0),
    ], options);
    expect(result.card[0]).toMatchObject({ value: '43', confidence: 'medium', changedRecently: true });
    expect(result.candidates).toEqual([{ field: 'shoe_size', value: '44', sources: ['c'], reason: 'single_source' }]);
    expect(result.superseded.map(value => [value.value, value.supersededBy])).toEqual([['42', '43']]);
  });

  it('is permutation-invariant for the former personal→single→consensus→personal comparison cycle', () => {
    // Pairwise winner reduction cycles: personal blocks 44, 44 is newer than 43,
    // and two-source 43 is newer than personal 42. Eligibility must be decided first.
    const records = [
      contribution('p', 'personal', '42', 4, { basis: 'stated' }),
      contribution('a', 'a', '43', 3), contribution('b', 'b', '43', 2),
      contribution('c', 'c', '44', 1),
    ];
    const expected = {
      card: [{ field: 'shoe_size', value: '43', confidence: 'high', sources: ['a', 'b'], updatedAt: ago(2), lastSupportedAt: ago(2), changedRecently: false }],
      candidates: [{ field: 'shoe_size', value: '44', sources: ['c'], reason: 'single_source' }],
      superseded: [{ field: 'shoe_size', value: '42', sources: ['personal'], lastSupportedAt: ago(4), supersededBy: '43' }],
    };
    for (const order of permutations(records)) expect(mergeCard(order, options)).toEqual(expected);
  });

  it('does not combine old personal or merchant evidence with one new merchant to bypass the barrier', () => {
    const base = [
      contribution('old-p', 'personal', '41', 8, { basis: 'stated' }),
      contribution('old-a', 'a', '41', 7),
      contribution('new-p', 'personal', '42', 3, { basis: 'stated' }),
      contribution('new-b', 'b', '41', 1),
    ];
    for (const order of permutations(base)) expect(mergeCard(order, options).card[0]?.value).toBe('42');
    expect(mergeCard([...base, contribution('new-c', 'c', '41', 0)], options).card[0]?.value).toBe('41');
  });

  it('uses the latest personal statement, and a stable value tie-break for equal timestamps', () => {
    const records = [
      contribution('old-p', 'personal', '41', 2, { basis: 'stated' }),
      contribution('a-p', 'personal', '42', 0, { basis: 'stated' }),
      contribution('z-p', 'personal', '43', 0, { basis: 'stated' }),
    ];
    for (const order of permutations(records)) expect(mergeCard(order, options).card[0]?.value).toBe('43');
    const consensus = [contribution('a', 'a', '42', 0), contribution('b', 'b', '42', 0), contribution('c', 'c', '43', 0), contribution('d', 'd', '43', 0)];
    for (const order of permutations(consensus)) expect(mergeCard(order, options).card[0]?.value).toBe('43');
  });
});

describe('mergeCard explicit time and immutable inputs', () => {
  it.each([
    { age: 180, confidence: 'high', onCard: true },
    { age: 180 + 1 / day, confidence: 'medium', onCard: true },
    { age: 365, confidence: 'medium', onCard: true },
    { age: 365 + 1 / day, confidence: 'medium', onCard: false },
  ])('uses strict decay boundaries at $age days', ({ age, confidence, onCard }) => {
    const result = mergeCard([contribution('a', 'a', '42', age), contribution('b', 'b', '42', age)], options);
    expect(result.card).toHaveLength(onCard ? 1 : 0);
    if (onCard) expect(result.card[0]).toMatchObject({ confidence, lastSupportedAt: ago(age), changedRecently: false });
    else expect(result.superseded).toEqual([{ field: 'shoe_size', value: '42', sources: ['a', 'b'], lastSupportedAt: ago(age), supersededBy: '' }]);
    expect(result.candidates).toEqual([]);
  });

  it('does not use expired consensus to qualify a fresh lone merchant, or an expired personal as a shield', () => {
    const expiredConsensus = [contribution('a', 'a', '42', 366), contribution('b', 'b', '42', 366)];
    const result = mergeCard([...expiredConsensus, contribution('c', 'c', '43', 0)], options);
    expect(result.card).toEqual([]);
    expect(result.candidates).toEqual([{ field: 'shoe_size', value: '43', sources: ['c'], reason: 'single_source' }]);
    expect(result.superseded[0]?.supersededBy).toBe('');
    expect(mergeCard([
      contribution('p', 'personal', '41', 366, { basis: 'stated' }),
      contribution('a', 'a', '42', 3), contribution('b', 'b', '42', 2), contribution('c', 'c', '43', 0),
    ], options).card[0]?.value).toBe('43');
  });

  it('ignores recent inferred/revoked timestamps when measuring last support', () => {
    const result = mergeCard([
      contribution('a', 'a', '42', 181), contribution('b', 'b', '42', 181),
      contribution('i', 'c', '42', 0, { basis: 'inferred' }),
      contribution('r', 'd', '42', 0, { revokedAt: now }),
    ], options);
    expect(result.card[0]).toMatchObject({ confidence: 'medium', lastSupportedAt: ago(181), updatedAt: ago(181), sources: ['a', 'b'], changedRecently: false });
  });

  it('accepts readonly inputs, keeps them unchanged, and emits FIELDS order with stable sources', () => {
    const fields: Field[] = ['payment_method', 'shipping_address', 'deadline', 'budget', 'shoe_size', 'length', 'tone', 'lang'];
    const records = Object.freeze(fields.flatMap(field => [
      Object.freeze(contribution(`${field}-z`, 'z', field, 1, { field })),
      Object.freeze(contribution(`${field}-a`, 'a', field, 0, { field })),
    ]));
    const readonlyOptions = Object.freeze({ now, personalAgentIds: Object.freeze(['personal']) });
    const before = JSON.stringify({ records, readonlyOptions });
    const apiCompatible: RulesApi['mergeCard'] = mergeCard;
    const result = mergeCard(records, readonlyOptions);
    expect(result.card.map(item => item.field)).toEqual(['lang', 'tone', 'length', 'shoe_size', 'budget', 'deadline', 'shipping_address', 'payment_method']);
    expect(result.card.every(item => item.sources.join(',') === 'a,z')).toBe(true);
    expect(apiCompatible([...records].reverse(), options)).toEqual(result);
    expect(JSON.stringify({ records, readonlyOptions })).toBe(before);
    result.card[0]!.sources.push('outside');
    expect(mergeCard(records, readonlyOptions).card[0]!.sources).toEqual(['a', 'z']);
  });
});
