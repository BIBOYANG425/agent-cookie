import { describe, expect, it } from 'vitest';
import { assertLearnedEvidence, projectLearnedResponse } from './learning-properties.js';
import { learningHttpConfig } from './learning-config.js';

// Opt in against a dedicated workspace after B has run the demonstration conversation.
// Read-only: no direct SDK/storage/core imports, no synthetic extraction posted to a live endpoint.
async function readLearning(path: '/personal/learned' | '/personal/learning'): Promise<unknown> {
  const { base, key } = learningHttpConfig(process.env);
  const response = await fetch(new URL(path, base), {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, redirect: 'error',
    credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(5000),
  });
  expect(response.status, 'Missing learning backend is not a passing Sample run').toBe(200);
  return response.json();
}

describe.skipIf(process.env.AGENT_COOKIE_LEARNING_TEST !== '1')('C20 · 学习 HTTP 观察', () => {
  it('实际 learned 响应有短证据、来源和合法晋升；不依赖店名', async () => {
    const snapshot = projectLearnedResponse(await readLearning('/personal/learned'));
    expect(snapshot.entries.length, 'Run the actual demonstration conversation before collecting C20 evidence').toBeGreaterThan(0);
    expect(snapshot.entries.every(entry => typeof entry.evidence === 'string' && !!entry.evidence.trim() && entry.sources.length > 0),
      'C20 requires real evidence snippets and source IDs; queued or manually seeded data is not dialogue evidence').toBe(true);
    assertLearnedEvidence(snapshot.entries, new Date().toISOString());
  }, 10_000);
});

// Separate readiness signal. Empty learned is valid here and never establishes C20 or model extraction.
describe.skipIf(process.env.AGENT_COOKIE_LEARNING_CONTRACT_TEST !== '1')('学习 HTTP 契约读取 · 非 C20', () => {
  it('正式 learning/learned GET 载荷可读，允许尚未学到任何结论', async () => {
    const state = await readLearning('/personal/learning');
    expect(state !== null && typeof state === 'object' && !Array.isArray(state)
      && typeof (state as { paused?: unknown }).paused === 'boolean', 'Expected LearningState { paused }').toBe(true);
    projectLearnedResponse(await readLearning('/personal/learned'));
  }, 15_000);
});
