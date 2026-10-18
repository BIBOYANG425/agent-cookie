import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../fixtures/learning/console.json';
import { createLiveAdapter, createSampleAdapter } from '../src/adapters';
import { ConsoleController } from '../src/controller';
import { LearningPanel, LearningToggle } from '../src/LearningPanel';
import { countEvidenceSources, normalizeLearning, type LearnedEntry, type LearningSeed } from '../src/learning';

const at = '2026-10-17T12:00:00.000Z';
const entry: LearnedEntry = { field: 'pref.color', value: '黑色', status: 'candidate', sources: ['personal-agent'],
  evidence: [{ contributionId: 'contribution/original', agentId: 'personal-agent', basis: 'stated', createdAt: at }] };
const card = { card: [], candidates: [], superseded: [] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const core = (path: string) => path.endsWith('/me') ? json({ role: 'owner' }) : path.endsWith('/personal/card') ? json(card)
  : path.endsWith('/personal/grants') ? json({ grants: [] }) : path.endsWith('/owner/activity') ? json({ events: [] }) : undefined;
const render = (entries: LearnedEntry[]) => renderToStaticMarkup(createElement(LearningPanel, {
  state: normalizeLearning({ paused: false, learned: entries }), sample: false, disabled: false, revoke: () => {},
}));

describe('learning boundary', () => {
  it('renders a manual stated contribution without fabricating conversation, snippet or status', () => {
    const state = normalizeLearning({ paused: false, learned: [entry] });
    expect(state.entries).toEqual([entry]);
    const html = render([entry]);
    for (const value of ['pref.color', '黑色', 'personal-agent', '用户陈述（stated）', 'contribution/original',
      '未提供对话或意图 ID', '候选 · 尚未上卡', '记录时间']) expect(html).toContain(value);
    expect(html).not.toContain('已进入身份卡');
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain('<blockquote');
    expect(html).not.toContain('<dt>对话</dt>');
    expect(html).not.toContain('<dt>意图</dt>');
  });

  it('uses source aliases only for display and never promotes a returned candidate', () => {
    const evidence = entry.evidence[0];
    const rows = [
      { ...evidence, conversationId: 'conversation-1', intentId: 'intent-1' },
      { ...evidence, contributionId: 'second', intentId: 'intent-1' },
      { ...evidence, contributionId: 'third', conversationId: 'conversation-2' },
    ];
    expect(countEvidenceSources(rows)).toBe(2);
    expect(countEvidenceSources([evidence, { ...evidence, contributionId: 'second' }])).toBe(0);
    const state = normalizeLearning({ paused: false, learned: [{ ...entry, evidence: rows }] });
    expect(state.entries[0].status).toBe('candidate');
    expect(render(state.entries)).toContain('3 条贡献 · 2 个来源');
    expect(() => normalizeLearning({ paused: false, learned: [{ ...entry, evidence: [evidence, evidence] }] })).toThrow('契约');
    expect(() => normalizeLearning({ paused: false, learned: [{ ...entry, evidence: [{ ...evidence, contributionId: undefined }] }] })).toThrow('契约');
  });

  it('counts evidence IDs rather than writers, without changing the returned card status', () => {
    const evidence = entry.evidence[0];
    const noIds = [evidence, { ...evidence, contributionId: 'other-writer', agentId: 'another-agent' }];
    expect(countEvidenceSources(noIds)).toBe(0);
    const stated = render([{ ...entry, status: 'card', evidence: noIds }]);
    expect(stated).toContain('已进入身份卡');
    expect(stated).toContain('2 条贡献 · 0 个来源');
    expect(stated).toContain('未提供对话或意图 ID，不计入独立证据来源');
    expect(stated).not.toContain('按来源 agent 去重');

    const sameChat = [
      { ...evidence, conversationId: 'chat-1' },
      { ...evidence, contributionId: 'repeat', agentId: 'another-agent', conversationId: 'chat-1' },
    ];
    expect(countEvidenceSources(sameChat)).toBe(1);
    expect(countEvidenceSources([sameChat[0], { ...sameChat[0], contributionId: 'independent', conversationId: 'chat-2' }])).toBe(2);
    expect(countEvidenceSources([...noIds, ...sameChat])).toBe(1);
  });

  it.each([404, 501])('keeps core views available when optional learned endpoint returns %s', async (status) => {
    const adapter = createLiveAdapter(async (path) => core(path) ?? new Response('not implemented', { status }));
    const snapshot = await adapter.load();
    expect(snapshot.card).toEqual(card);
    expect(snapshot.learning).toMatchObject({ availability: 'unavailable', paused: null, entries: [] });
    expect(snapshot.sample).toBeUndefined();
  });

  it('isolates malformed learning payloads and never replaces live state with Sample records', async () => {
    const adapter = createLiveAdapter(async (path) => core(path) ?? json({ learned: [entry] }));
    const snapshot = await adapter.load();
    expect(snapshot.learning).toMatchObject({ availability: 'error', paused: null, entries: [] });
    expect(snapshot.card).toEqual(card);
    expect(snapshot.learning?.sample).toBeUndefined();
  });

  it('requires the requested pause acknowledgement and keeps owner credentials outside browser requests', async () => {
    const calls: RequestInit[] = [];
    const adapter = createLiveAdapter(async (path, options) => {
      calls.push(options);
      return core(path) ?? json({ paused: false, learned: [entry] });
    });
    await adapter.load();
    await expect(adapter.setLearning(true)).rejects.toThrow('未确认');
    for (const options of calls) expect(new Headers(options.headers).has('Authorization')).toBe(false);
  });

  it('leaves the confirmed toggle and records untouched on a failed pause or revoke', async () => {
    const sample = createSampleAdapter(() => Date.parse(at), [], { paused: false, learned: [entry] });
    const controller = new ConsoleController({ ...sample,
      setLearning: async () => { throw new Error('503 UPSTREAM_ERROR'); },
      revokeContribution: async () => { throw new Error('403 SCOPE_DENIED'); } });
    await controller.refresh();
    const before = controller.getState().data;
    await controller.setLearning(true);
    expect(controller.getState().data).toBe(before);
    expect(controller.getState().data?.learning?.paused).toBe(false);
    expect(controller.getState().notice).toBe('');
    expect(controller.getState().error).toContain('暂停学习未确认成功');
    await controller.revokeContribution(entry.evidence[0].contributionId);
    expect(controller.getState().data?.learning?.entries).toEqual([entry]);
    expect(controller.getState().notice).toBe('');
  });
});

describe('Sample learning replay and rendering', () => {
  it('starts empty, replays authored stages, and removes stale card values when one source is revoked', async () => {
    const network = vi.spyOn(globalThis, 'fetch');
    try {
      const sample = createSampleAdapter(() => Date.parse(at), [], fixture as LearningSeed);
      expect((await sample.load()).learning?.entries).toEqual([]);
      await sample.selectLearningStage!('candidate');
      expect((await sample.load()).learning?.entries.every((row) => row.status === 'candidate')).toBe(true);
      expect((await sample.load()).card.card).toEqual([]);
      await sample.selectLearningStage!('learned');
      expect((await sample.load()).card.card.map((row) => row.field)).toEqual(['pref.material', 'pref.color']);
      await sample.revokeContribution('sample-learned-material-1');
      const after = await sample.load();
      const material = after.learning?.entries.find((row) => row.field === 'pref.material');
      expect(material?.status).toBe('candidate');
      expect(material?.evidence.map((row) => row.contributionId)).toEqual(['sample-learned-material-0']);
      expect(after.card.card.map((row) => row.field)).toEqual(['pref.color']);
      await sample.revokeContribution('sample-learned-material-0');
      expect((await sample.load()).learning?.entries.map((row) => row.field)).toEqual(['pref.color']);
      await sample.setLearning(true);
      expect((await sample.load()).learning?.paused).toBe(true);
      await sample.reset();
      expect((await sample.load()).learning).toMatchObject({ paused: false, entries: [], sample: true, sampleStage: 'empty' });
      expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });

  it('renders exact empty copy, escapes snippets, and exposes known pause state accessibly', () => {
    expect(render([])).toContain('还没学到什么，和你的 agent 聊几句就会出现在这里');
    const html = render([{ ...entry, status: 'card', evidence: [{ ...entry.evidence[0], snippet: '<script>private</script>' }] }]);
    expect(html).toContain('已进入身份卡');
    expect(html).toContain('&lt;script&gt;private&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(renderToStaticMarkup(createElement(LearningToggle, { state: normalizeLearning({ paused: true, learned: [] }),
      disabled: false, change: () => {} }))).toContain('aria-checked="true"');
    expect(renderToStaticMarkup(createElement(LearningToggle, { state: { availability: 'unavailable', paused: null, entries: [] },
      disabled: false, change: () => {} }))).toContain('disabled=""');
  });
});
