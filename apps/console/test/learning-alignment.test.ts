import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { createLiveAdapter } from '../src/adapters';
import { normalizeLearning } from '../src/learning';
import { LearningPanel, LearningToggle } from '../src/LearningPanel';

const at = '2026-10-17T12:00:00.000Z';
const card = { card: [], candidates: [], superseded: [] };
const payload = { paused: false, learned: [{ field: 'pref.material', value: 'cotton', status: 'card',
  sources: ['personal-one', 'personal-two'], evidence: [
    { contributionId: 'contribution/one', agentId: 'personal-one', basis: 'inferred', createdAt: at,
      conversationId: 'conversation-one', intentId: 'intent-alias', snippet: '一直喜欢棉质' },
    { contributionId: 'contribution-two', agentId: 'personal-one', basis: 'observed', createdAt: at,
      intentId: 'intent-alias', snippet: '棉质更舒服' },
    { contributionId: 'contribution-three', agentId: 'personal-two', basis: 'observed', createdAt: at,
      conversationId: 'conversation-two', snippet: '还是选棉质' },
  ] }] };
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

it('accepts A 0129f08 grouped evidence and counts dual IDs as aliases of one source', () => {
  const state = normalizeLearning(payload);
  expect(state).toMatchObject({ paused: false, entries: payload.learned });
  const html = renderToStaticMarkup(createElement(LearningPanel, { state, sample: false, disabled: false, revoke: () => {} }));
  expect(html).toContain('已进入身份卡');
  expect(html).toContain('3 条贡献 · 2 个来源');
  expect(html).not.toContain('3 个来源');
  for (const id of ['contribution/one', 'contribution-two', 'contribution-three']) {
    expect(html).toContain(`记录 ${id}`);
  }
  for (const text of ['conversation-one', 'intent-alias', 'conversation-two', '一直喜欢棉质', 'personal-two']) expect(html).toContain(text);
});

it('sends paused to PUT and revokes an evidence contribution ID, never a group or agent ID', async () => {
  const calls: Array<{ path: string; init: RequestInit }> = [];
  const adapter = createLiveAdapter(async (path, init) => {
    calls.push({ path, init });
    if (path.endsWith('/personal/learning')) return json({ paused: true });
    if (path.includes('/contributions/')) return json({ ok: true, card });
    if (path.endsWith('/me')) return json({ role: 'owner' });
    if (path.endsWith('/personal/card')) return json(card);
    if (path.endsWith('/personal/grants')) return json({ grants: [] });
    if (path.endsWith('/owner/activity')) return json({ events: [] });
    return json(payload);
  });
  const snapshot = await adapter.load();
  expect(snapshot.learning?.availability).toBe('ready');
  await adapter.revokeContribution('contribution/one');
  await adapter.setLearning(true);
  expect(calls.at(-2)?.path).toBe('/workspace-api/personal/contributions/contribution%2Fone/revoke');
  expect(calls.at(-1)).toMatchObject({ path: '/workspace-api/personal/learning', init: { method: 'PUT', body: '{"paused":true}' } });
  const html = renderToStaticMarkup(createElement(LearningToggle, { state: normalizeLearning({ ...payload, paused: true }),
    disabled: false, change: () => {} }));
  expect(html).toContain('aria-checked="true"');
});

it('rejects unsupported preference keys and the obsolete enabled/confirmed proposal', () => {
  expect(() => normalizeLearning({ ...payload, learned: [{ ...payload.learned[0], field: 'pref.water_resistance' }] })).toThrow();
  expect(() => normalizeLearning({ enabled: true, generation: 0, learned: [] })).toThrow();
  expect(() => normalizeLearning({ ...payload, learned: [{ ...payload.learned[0], status: 'confirmed' }] })).toThrow();
});
