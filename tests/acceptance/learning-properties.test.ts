import { describe, expect, it } from 'vitest';
import {
  assertLearnedEvidence, assertLearningPaused, assertLearnedRevoked, assertPreferenceRanking, projectLearnedResponse,
  type LearnedObservation,
} from './learning-properties.js';

// Response observations only: no workspace/rules/SDK/storage imports.
const now = '2026-10-17T12:00:00.000Z';
const item = (id: string, sourceId: string, status: 'candidate' | 'on_card' = 'candidate'): LearnedObservation => ({
  id, agentId: 'sample-personal', field: 'pref.style', value: '简约', basis: 'inferred', status, createdAt: now,
  evidence: '我喜欢简约风格', sources: [{ kind: 'conversation', id: sourceId }],
});
const response = (status: 'candidate' | 'card' = 'candidate') => ({ paused: false, learned: [{
  field: 'pref.material', value: '棉', status, sources: ['sample-personal'], evidence: [
    { contributionId: 'a', agentId: 'sample-personal', basis: 'inferred', createdAt: now,
      intentId: 'intent-a', conversationId: 'chat-a', snippet: '棉质舒服' },
  ],
}] });

describe('学习 HTTP 响应的性质 · 不依赖店名、型号、价格常量', () => {
  it('投影正式 grouped learned 响应，作者不是独立 conversation/intent 标识', () => {
    const projected = projectLearnedResponse(response());
    expect(projected).toEqual({ paused: false, entries: [{ id: 'a', agentId: 'sample-personal',
      field: 'pref.material', value: '棉', status: 'candidate', basis: 'inferred', createdAt: now,
      evidence: '棉质舒服', sources: [{ kind: 'conversation', id: 'chat-a' }, { kind: 'intent', id: 'intent-a' }],
    }] });
    expect(() => assertLearnedEvidence(projected.entries, now)).not.toThrow();
    const promoted = response('card');
    promoted.learned[0]!.sources.push('another-writer');
    expect(() => assertLearnedEvidence(projectLearnedResponse(promoted).entries, now)).toThrow(/independent/);
  });
  it('空正式响应仅表示契约可读；拒绝旧桩、未知字段和没有 evidence 的非空分组', () => {
    expect(projectLearnedResponse({ paused: false, learned: [] })).toEqual({ paused: false, entries: [] });
    expect(() => projectLearnedResponse({ enabled: true, entries: [] })).toThrow(/paused|learned/);
    const badField = response(); badField.learned[0]!.field = 'pref.water_resistance';
    expect(() => projectLearnedResponse(badField)).toThrow(/field/);
    const empty = response(); empty.learned[0]!.evidence = [];
    expect(() => projectLearnedResponse(empty)).toThrow(/evidence/);
    const malformed = response() as any; malformed.learned[0].evidence[0].rawText = 'raw conversation';
    expect(() => projectLearnedResponse(malformed)).toThrow(/transcript/);
  });
  it('单源只能候选；同对话重复不能充当独立来源；双源可上卡', () => {
    expect(() => assertLearnedEvidence([item('a', 'chat-a')], now)).not.toThrow();
    expect(() => assertLearnedEvidence([item('a', 'chat-a', 'on_card')], now)).toThrow(/independent/);
    expect(() => assertLearnedEvidence([item('a', 'same', 'on_card'), item('b', 'same', 'on_card')], now)).toThrow(/independent/);
    expect(() => assertLearnedEvidence([item('a', 'chat-a', 'on_card'), item('b', 'chat-b', 'on_card')], now)).not.toThrow();
  });
  it('同一证据的两种来源标识与其部分副本不能充当双源', () => {
    const alias = { ...item('a', 'chat-a', 'on_card'), sources: [
      { kind: 'conversation' as const, id: 'chat-a' }, { kind: 'intent' as const, id: 'intent-a' },
    ] };
    const copy = { ...item('b', 'chat-a', 'on_card'), sources: [{ kind: 'intent' as const, id: 'intent-a' }] };
    expect(() => assertLearnedEvidence([alias], now)).toThrow(/independent/);
    expect(() => assertLearnedEvidence([alias, copy], now)).toThrow(/independent/);
    const partial = item('c', 'chat-a', 'on_card');
    for (const bridge of [{ ...alias, revokedAt: now }, { ...alias, createdAt: '2025-01-01T00:00:00.000Z' }]) {
      expect(() => assertLearnedEvidence([bridge, copy, partial], now)).toThrow(/independent/);
      expect(() => assertLearnedEvidence([partial, copy, bridge], now)).toThrow(/independent/);
    }
    expect(() => assertLearnedEvidence([alias, copy, item('independent', 'chat-b', 'on_card')], now)).not.toThrow();
  });
  it('单条 observed 仍候选；明确 stated 可立即上卡；未给来源的推断不晋升', () => {
    expect(() => assertLearnedEvidence([{ ...item('a', 'chat-a', 'on_card'), basis: 'observed' }], now)).toThrow(/independent/);
    expect(() => assertLearnedEvidence([{ ...item('a', 'chat-a', 'on_card'), basis: 'stated' }], now)).not.toThrow();
    expect(() => assertLearnedEvidence([{ ...item('a', 'chat-a', 'on_card'), sources: [] }], now)).toThrow(/independent/);
  });
  it('证据限 200 Unicode 字符；过期来源不能支持晋升；不返回对话原文', () => {
    expect(() => assertLearnedEvidence([{ ...item('a', 'chat-a'), evidence: '🥾'.repeat(200) }], now)).not.toThrow();
    expect(() => assertLearnedEvidence([{ ...item('a', 'chat-a'), evidence: '🥾'.repeat(201) }], now)).toThrow(/200/);
    expect(() => assertLearnedEvidence([item('a', 'chat-a', 'on_card'), {
      ...item('b', 'chat-b', 'on_card'), createdAt: '2025-10-16T12:00:00.000Z',
    }], now)).toThrow(/independent|expired/);
    expect(() => assertLearnedEvidence([{ ...item('a', 'chat-a'), transcript: 'raw conversation' }], now)).toThrow(/transcript/);
  });
  it('缺失或非法 basis、未来时间均不能作为已验证学习响应', () => {
    for (const basis of [undefined, 'unrecognized']) {
      const invalid = { ...item('a', 'chat-a', 'on_card'), basis } as unknown as LearnedObservation;
      expect(() => assertLearnedEvidence([invalid], now)).toThrow(/basis/);
    }
    expect(() => assertLearnedEvidence([{ ...item('a', 'chat-a', 'on_card'), basis: 'observed',
      createdAt: '2030-01-01T00:00:00.000Z' }], now)).toThrow(/future/);
  });
  it('暂停期间不增加或修改学习条目，撤销后该贡献不再活跃', () => {
    const before = [item('a', 'chat-a')];
    expect(() => assertLearningPaused(before, before)).not.toThrow();
    expect(() => assertLearningPaused(before, [])).not.toThrow();
    expect(() => assertLearningPaused(before, [...before, item('b', 'chat-b')])).toThrow(/paused/);
    expect(() => assertLearningPaused(before, [{ ...before[0]!, value: 'changed' }])).toThrow(/paused/);
    expect(() => assertLearnedRevoked([], 'a')).not.toThrow();
    expect(() => assertLearnedRevoked(before, 'a')).toThrow(/revoked/);
  });
  it('比较同一合格候选集的排序；偏好命中的报价不被未命中的反超', () => {
    expect(() => assertPreferenceRanking(['quote-a', 'quote-b'], ['quote-b', 'quote-a'], ['quote-b'])).not.toThrow();
    expect(() => assertPreferenceRanking(['quote-a', 'quote-b'], ['quote-a', 'quote-b'], ['quote-b'])).toThrow(/ranking/);
    expect(() => assertPreferenceRanking(['quote-a'], ['fabricated'], ['fabricated'])).toThrow(/candidate/);
    expect(() => assertPreferenceRanking(['quote-a'], ['quote-a'], [])).toThrow(/matched/);
  });
});
