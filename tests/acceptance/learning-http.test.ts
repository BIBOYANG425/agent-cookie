import { describe, expect, it } from 'vitest';
import { assertLearnedEvidence, type LearnedObservation } from './learning-properties.js';

// TODO(contract): replace only this response projection when A publishes LearnedResponse.
// Opt in against a dedicated workspace after B has run the demonstration conversation.
// Read-only: no direct SDK/storage/core imports, no synthetic extraction posted to a live endpoint.
describe.skipIf(process.env.AGENT_COOKIE_LEARNING_TEST !== '1')('C20 · 学习 HTTP 观察', () => {
  it('实际 learned 响应有短证据、来源和合法晋升；不依赖店名', async () => {
    const raw = process.env.AGENT_COOKIE_URL;
    const key = process.env.AGENT_COOKIE_KEY;
    expect(raw, 'Set an explicit isolated AGENT_COOKIE_URL').toBeTruthy();
    expect(key, 'Set an owner AGENT_COOKIE_KEY without placing it in evidence').toBeTruthy();
    const base = new URL(raw!);
    expect(base.protocol).toBe('http:');
    expect(['127.0.0.1', 'localhost', '[::1]']).toContain(base.hostname);
    expect([base.username, base.password, base.search, base.hash]).toEqual(['', '', '', '']);
    expect(base.pathname).toBe('/');
    const response = await fetch(new URL('/personal/learned', base), {
      headers: { Authorization: `Bearer ${key}` }, redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    expect(response.status, 'Missing learning backend is not a passing Sample run').toBe(200);
    const body = await response.json() as { enabled: boolean; entries: LearnedObservation[] };
    expect(typeof body.enabled).toBe('boolean');
    expect(Array.isArray(body.entries)).toBe(true);
    expect(body.entries.length, 'Run the actual demonstration conversation before collecting C20 evidence').toBeGreaterThan(0);
    assertLearnedEvidence(body.entries, new Date().toISOString());
  });
});
