import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../fixtures/learning/console.json';
import { createLiveAdapter, createSampleAdapter } from '../src/adapters';
import { ConsoleController } from '../src/controller';
import { LearningPanel, LearningToggle } from '../src/LearningPanel';
import { normalizeLearning, type LearnedEntry, type LearningSeed } from '../src/learning';

const at = '2026-10-17T12:00:00.000Z';
const entry: LearnedEntry = { id: 'contribution/original', field: 'pref.water_resistance', value: '防水', status: 'candidate',
  createdAt: at, evidence: '上次脚湿透了', sources: [{ kind: 'conversation', id: 'conversation-1', evidence: '上次脚湿透了', at }] };
const card = { card: [], candidates: [], superseded: [] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const core = (path: string) => path.endsWith('/me') ? json({ role: 'owner' }) : path.endsWith('/personal/card') ? json(card)
  : path.endsWith('/personal/grants') ? json({ grants: [] }) : path.endsWith('/owner/activity') ? json({ events: [] }) : undefined;

describe('learning boundary', () => {
  it('maps B’s proposal without inventing card promotion, creation time, provenance or a revocable contribution ID', () => {
    const state = normalizeLearning({ enabled: true, generation: 2, learned: [
      { id: 'learning-record-1', key: 'pref.material', value: 'cotton', evidence: '一直更喜欢棉质', basis: 'stated', status: 'confirmed', updatedAt: at },
      { id: 'learning-record-2', key: 'pref.fit', value: 'loose', evidence: '这件宽松一点舒服', basis: 'inferred', status: 'candidate', updatedAt: at },
    ] });
    expect(state.enabled).toBe(true);
    expect(state.entries[0]).toEqual({ id: 'learning-record-1', field: 'pref.material', value: 'cotton', evidence: '一直更喜欢棉质',
      basis: 'stated', status: 'confirmed', updatedAt: at, sources: [] });
    expect(state.entries[0].createdAt).toBeUndefined();
    expect(state.entries[0].contributionId).toBeUndefined();
    expect(state.entries[1].status).toBe('candidate');
    const html = renderToStaticMarkup(createElement(LearningPanel, { state, sample: false, disabled: false, revoke: () => {} }));
    expect(html).toContain('已确认 · 上卡状态待对齐');
    expect(html).not.toContain('已进入身份卡');
    expect(html).toContain('来源与证据 · 尚未提供');
    expect(html).toContain('更新时间');
    expect(html).not.toContain('记录时间');
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain('学习记录 ID 尚未确认可用于贡献撤销');
  });

  it('deduplicates repeated evidence from one source without inventing status or counting it twice', () => {
    const state = normalizeLearning({ enabled: true, entries: [{ ...entry, sources: [entry.sources[0], entry.sources[0],
      { kind: 'intent', id: 'intent-2', evidence: '帮我找双鞋' }] },
    { ...entry, id: 'other', field: 'length', value: 'brief', sources: [] }] });
    expect(state.entries[0].sources).toHaveLength(2);
    expect(state.entries[0].status).toBe('candidate'); // Two returned source IDs alone do not authorize a promotion.
    expect(state.entries.map((row) => row.field)).toEqual(['pref.water_resistance', 'length']);
    expect(() => normalizeLearning({ enabled: true, entries: [{ ...entry, status: undefined }] })).toThrow('临时格式');
    expect(() => normalizeLearning({ enabled: true, entries: [{ ...entry, id: undefined }] })).toThrow('临时格式');
  });

  it.each([404, 501])('keeps core views available when optional learned endpoint returns %s', async (status) => {
    const adapter = createLiveAdapter(async (path) => core(path) ?? new Response('not implemented', { status }));
    const snapshot = await adapter.load();
    expect(snapshot.card).toEqual(card);
    expect(snapshot.learning).toMatchObject({ availability: 'unavailable', enabled: null, entries: [] });
    expect(snapshot.sample).toBeUndefined();
  });

  it('isolates malformed learning payloads and never replaces live state with Sample records', async () => {
    const adapter = createLiveAdapter(async (path) => core(path) ?? json({ entries: [entry] }));
    const snapshot = await adapter.load();
    expect(snapshot.learning).toMatchObject({ availability: 'error', enabled: null, entries: [] });
    expect(snapshot.card).toEqual(card);
    expect(snapshot.learning?.sample).toBeUndefined();
  });

  it('uses PUT for pause and the exact returned contribution ID for revoke, with no browser credential', async () => {
    const calls: Array<{ path: string; options: RequestInit }> = [];
    const adapter = createLiveAdapter(async (path, options) => {
      calls.push({ path, options });
      if (path.endsWith('/personal/learning')) return json({ enabled: false });
      if (path.includes('/contributions/')) return json({ ok: true, card });
      return core(path) ?? json({ enabled: true, entries: [entry] });
    });
    const state = await adapter.load();
    await adapter.revokeContribution(state.learning!.entries[0].id);
    await adapter.setLearning(false);
    expect(calls.at(-2)?.path).toBe('/workspace-api/personal/contributions/contribution%2Foriginal/revoke');
    expect(calls.at(-1)).toMatchObject({ path: '/workspace-api/personal/learning', options: { method: 'PUT', body: '{"enabled":false}' } });
    for (const call of calls) expect(new Headers(call.options.headers).has('Authorization')).toBe(false);
    await expect(createLiveAdapter(async () => json({ enabled: true })).setLearning(false)).rejects.toThrow('未确认');
  });

  it('leaves the confirmed toggle and records untouched on a failed pause or revoke', async () => {
    const sample = createSampleAdapter(() => Date.parse(at), [], { enabled: true, entries: [entry] });
    const controller = new ConsoleController({ ...sample,
      setLearning: async () => { throw new Error('503 UPSTREAM_ERROR'); },
      revokeContribution: async () => { throw new Error('403 SCOPE_DENIED'); } });
    await controller.refresh();
    const before = controller.getState().data;
    await controller.setLearning(false);
    expect(controller.getState().data).toBe(before);
    expect(controller.getState().data?.learning?.enabled).toBe(true);
    expect(controller.getState().notice).toBe('');
    expect(controller.getState().error).toContain('暂停学习未确认成功');
    await controller.revokeContribution(entry.id);
    expect(controller.getState().data?.learning?.entries).toEqual([{ ...entry, contributionId: entry.id }]);
    expect(controller.getState().notice).toBe('');
  });
});

describe('Sample learning replay and rendering', () => {
  it('starts empty, replays authored stages, and downgrades a preference when one source is revoked', async () => {
    const network = vi.spyOn(globalThis, 'fetch');
    try {
      const sample = createSampleAdapter(() => Date.parse(at), [], fixture as LearningSeed);
      expect((await sample.load()).learning?.entries).toEqual([]);
      await sample.selectLearningStage!('candidate');
      expect((await sample.load()).learning?.entries.every((row) => row.status === 'candidate')).toBe(true);
      expect((await sample.load()).card.card).toEqual([]);
      await sample.selectLearningStage!('learned');
      expect((await sample.load()).card.card.map((row) => row.field)).toEqual(['pref.outdoor_activity', 'pref.water_resistance']);
      await sample.revokeContribution('sample-learned-hike-1');
      const after = await sample.load();
      expect(after.learning?.entries.find((row) => row.id === 'sample-learned-hike-0')?.status).toBe('candidate');
      expect(after.card.card.map((row) => row.field)).toEqual(['pref.water_resistance']);
      await sample.setLearning(false);
      expect((await sample.load()).learning?.enabled).toBe(false);
      await sample.reset();
      expect((await sample.load()).learning).toMatchObject({ enabled: true, entries: [], sample: true, sampleStage: 'empty' });
      expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });

  it('renders exact empty copy, raw field keys, escaped evidence, sources, statuses and accessible pause state', () => {
    const render = (entries: LearnedEntry[]) => renderToStaticMarkup(createElement(LearningPanel, {
      state: normalizeLearning({ enabled: true, entries }), sample: false, disabled: false, revoke: () => {},
    }));
    expect(render([])).toContain('还没学到什么，和你的 agent 聊几句就会出现在这里');
    const html = render([{ ...entry, evidence: '<script>private</script>', sources: [...entry.sources,
      { kind: 'intent', id: 'intent-2', agentId: 'agent-1', evidence: '帮我找双鞋', at }] },
    { ...entry, id: 'same-conversation-again' },
    { ...entry, id: 'length-record', field: 'length', value: 'brief', status: 'on_card' }]);
    for (const value of ['pref.water_resistance', 'length', '防水', '候选 · 尚未上卡', '已进入身份卡',
      'conversation-1', 'intent-2', '对话', '意图', '记录时间', 'contribution/original', '&lt;script&gt;']) expect(html).toContain(value);
    expect(html).not.toContain('<script>');
    expect(html).toContain('本条 1 个来源 · 同字段同值共 2 个独立来源');
    expect(html).not.toContain('同字段同值共 3 个独立来源');
    expect(renderToStaticMarkup(createElement(LearningToggle, { state: normalizeLearning({ enabled: false, entries: [] }),
      disabled: false, change: () => {} }))).toContain('aria-checked="true"');
    expect(renderToStaticMarkup(createElement(LearningToggle, { state: { availability: 'unavailable', enabled: null, entries: [] },
      disabled: false, change: () => {} }))).toContain('disabled=""');
  });
});
