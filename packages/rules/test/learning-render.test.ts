import { describe, expect, it } from 'vitest';
import { learningRules, parseContributions, parseLearningContributions, renderContribution, type LearningContribution } from '../src/index.js';

const owner = { userId: 'u', agentId: 'personal' };
const row: LearningContribution = { ...owner, id: 'c', field: 'pref.fit', value: ' relaxed ', basis: 'inferred',
  createdAt: '2026-10-17T12:00:00.000Z', intentId: 'i; [a]%\r\n', conversationId: 'conv\\0', evidence: ' 用户说：[宽松]; 100%\r\n ' };

describe('learning Markdown provenance · TODO(contract)', () => {
  it('round trips dynamic fields, source identifiers and bounded Unicode evidence without owner spoofing', () => {
    const line = renderContribution(row);
    expect(line).not.toMatch(/[\r\n]/u);
    expect(parseLearningContributions(line, owner)).toEqual([row]);
    expect(parseLearningContributions(line, { userId: 'real', agentId: 'writer' })).toEqual([{ ...row, userId: 'real', agentId: 'writer' }]);
    expect(parseContributions(line, owner, { learning: true })).toEqual([row]);
    expect(parseContributions(line, owner)).toEqual([]);
  });

  it('keeps new metadata for canonical fields through the existing parser', () => {
    const canonical = { ...row, field: 'tone' as const, evidence: '' };
    expect(parseContributions(renderContribution(canonical), owner)).toEqual([canonical]);
  });

  it('accepts exactly 200 code points, rejects oversized evidence and drops malformed pref/source rows', () => {
    const bounded = { ...row, evidence: '🙂'.repeat(200) };
    expect(parseLearningContributions(renderContribution(bounded), owner)).toEqual([bounded]);
    expect(() => renderContribution({ ...row, evidence: '🙂'.repeat(201) })).toThrow();
    const line = renderContribution(row);
    const bad = [line.replace('pref.fit:', 'pref...fit:'), line.replace('pref.fit:', 'vip:'),
      line.replace('conversationId: conv\\0', 'conversationId: '),
      line.replace(/evidence: .*\]$/u, `evidence: ${'x'.repeat(201)}]`)];
    expect(() => parseLearningContributions(bad.join('\n'), owner)).not.toThrow();
    expect(parseLearningContributions(bad.join('\n'), owner)).toEqual([]);
  });

  it('retains promotion after serialization and parses source metadata through learningRules', () => {
    const records = [{ ...row, intentId: 'intent-a', conversationId: 'a' }, { ...row, id: 'd', intentId: 'intent-b', conversationId: 'b' }];
    const restored = learningRules.parseContributions(records.map(learningRules.renderContribution).join('\n'), owner);
    const card = learningRules.mergeCard(restored, { now: row.createdAt, personalAgentIds: ['personal'] });
    expect(card.card[0]).toMatchObject({ field: 'pref.fit', confidence: 'medium', value: row.value });
    expect(learningRules.renderCard(card, { userId: owner.userId, generatedAt: row.createdAt })).toContain('- pref.fit:');
    const copies = records.map(item => ({ ...item, intentId: 'same-intent' }));
    const copied = learningRules.parseContributions(copies.map(learningRules.renderContribution).join('\n'), owner);
    expect(learningRules.mergeCard(copied, { now: row.createdAt, personalAgentIds: ['personal'] }).card).toEqual([]);
  });
});
