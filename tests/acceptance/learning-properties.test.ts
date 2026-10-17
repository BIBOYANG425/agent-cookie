import { describe, expect, it } from 'vitest';
import {
  assertLearnedEvidence, assertLearningPaused, assertLearnedRevoked, assertPreferenceRanking,
  type LearnedObservation,
} from './learning-properties.js';

// Response observations only: no workspace/rules/SDK/storage imports.
const now = '2026-10-17T12:00:00.000Z';
const item = (id: string, sourceId: string, status: 'candidate' | 'on_card' = 'candidate'): LearnedObservation => ({
  id, field: 'pref.water_resistance', value: '防水', basis: 'inferred', status, createdAt: now,
  evidence: '上次脚湿透了', sources: [{ kind: 'conversation', id: sourceId }],
});

describe('学习 HTTP 响应的性质 · 不依赖店名、型号、价格常量', () => {
  it('单源只能候选；同对话重复不能充当独立来源；双源可上卡', () => {
    expect(() => assertLearnedEvidence([item('a', 'chat-a')], now)).not.toThrow();
    expect(() => assertLearnedEvidence([item('a', 'chat-a', 'on_card')], now)).toThrow(/independent/);
    expect(() => assertLearnedEvidence([item('a', 'same', 'on_card'), item('b', 'same', 'on_card')], now)).toThrow(/independent/);
    expect(() => assertLearnedEvidence([item('a', 'chat-a', 'on_card'), item('b', 'chat-b', 'on_card')], now)).not.toThrow();
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
