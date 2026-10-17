import { describe, expect, it } from 'vitest';
import type { Contribution } from '@agent-cookie/contract';
import { isLearningField, mergeCard, parseContributions, renderContribution, rules, type LearningContribution } from '../src/index.js';

const now = '2026-10-17T12:00:00.000Z';
const options = { now, personalAgentIds: ['personal'] };
const nested = (id: string, conversationId: string): LearningContribution => ({
  id, userId: 'u', agentId: 'personal', field: 'pref.fit', value: 'relaxed', basis: 'inferred', createdAt: now,
  evidence: { conversationId, intentId: `intent-${id}`, snippet: 'I prefer relaxed; [%0A]\n剪裁\u2028' },
});

describe('A 0129f08 nested learning contract', () => {
  it('round-trips nested evidence through the default RulesApi, not just the learning-only parser', () => {
    const c = nested('one', 'conversation-one');
    const line = rules.renderContribution(c as Contribution);
    expect(line).not.toMatch(/[\r\n]/u);
    expect(rules.parseContributions(line, { userId: 'u', agentId: 'personal' })).toEqual([c]);
    expect(parseContributions(renderContribution(c), { userId: 'u', agentId: 'personal' })).toEqual([c]);
  });

  it('promotes nested independent conversations once per field and retracts after revocation', () => {
    const first = nested('one', 'conversation-one');
    const second = nested('two', 'conversation-two');
    expect(mergeCard([first], options).card).toEqual([]);
    expect(mergeCard([first, second], options).card).toEqual([{ field: 'pref.fit', value: 'relaxed', confidence: 'medium',
      sources: ['personal'], updatedAt: now, lastSupportedAt: now, changedRecently: false }]);
    expect(mergeCard([first, { ...second, revokedAt: now }], options).card).toEqual([]);
  });

  it('counts source-bearing observed records by conversation, not by the agent that submitted them', () => {
    const first = { ...nested('one', 'conversation-one'), basis: 'observed' as const };
    const second = { ...nested('two', 'conversation-two'), basis: 'observed' as const };
    expect(mergeCard([first, second], options).card).toEqual([{ field: 'pref.fit', value: 'relaxed', confidence: 'medium',
      sources: ['personal'], updatedAt: now, lastSupportedAt: now, changedRecently: false }]);
    const sameConversation = { ...second, agentId: 'other', evidence: { conversationId: 'conversation-one' } };
    expect(mergeCard([first, sameConversation], options).card).toEqual([]);
    expect(mergeCard([first, sameConversation], options).candidates).toEqual([
      { field: 'pref.fit', value: 'relaxed', sources: ['other', 'personal'], reason: 'single_source' },
    ]);
  });

  it('deduplicates nested partial aliases and rejects non-whitelisted pref names', () => {
    const one = nested('one', 'shared-conversation');
    const copy = { ...nested('two', 'elsewhere'), evidence: { intentId: 'intent-one', snippet: 'same source' } };
    expect(mergeCard([one, copy], options).card).toEqual([]);
    for (const field of ['pref.health', 'pref.outdoor_activity', 'pref.fit.extra', 'pref.unknown']) {
      expect(isLearningField(field)).toBe(false);
      expect(() => renderContribution({ ...one, field } as LearningContribution)).toThrow();
    }
  });

  it('refuses oversized nested evidence without truncating it and keeps metadata-free legacy rules', () => {
    const long = { ...nested('one', 'one'), evidence: { conversationId: 'one', snippet: '鞋'.repeat(201) } };
    expect(() => renderContribution(long)).toThrow();
    expect(mergeCard([long, nested('two', 'two')], options).card).toEqual([]);
    expect(mergeCard([
      { id: 'a', userId: 'u', agentId: 'a', field: 'tone', value: 'brief', basis: 'inferred', createdAt: now },
      { id: 'b', userId: 'u', agentId: 'b', field: 'tone', value: 'brief', basis: 'inferred', createdAt: now },
    ], options).card).toEqual([]);
  });
});
