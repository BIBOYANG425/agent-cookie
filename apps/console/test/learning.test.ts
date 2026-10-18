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
  it('preserves and renders actual model provenance without changing candidate status or source count', () => {
    const models = { gate: 'typesafe/jev-1.14', extractor: 'openai/gpt-oss-120b' };
    const row = { ...entry, evidence: [{ ...entry.evidence[0], conversationId: 'one-chat', models }] };
    const state = normalizeLearning({ paused: false, learned: [row] });
    expect(state.entries).toEqual([row]);
    expect(countEvidenceSources(state.entries[0].evidence)).toBe(1);
    const html = render(state.entries);
    expect(html).toContain('typesafe/jev-1.14 → openai/gpt-oss-120b');
    expect(html).toContain('Candidate · not yet in context');
    expect(html).toContain('1 contributions · 1 sources');
    expect(html).not.toContain('Local rules');
  });

  it.each([
    [undefined, 'Local rules'], [{}, 'Local rules'],
    [{ gate: 'typesafe/jev-1.14' }, 'typesafe/jev-1.14'],
    [{ extractor: 'openai/gpt-oss-120b' }, 'openai/gpt-oss-120b'],
  ])('renders only the available model IDs for %j', (models, expected) => {
    const html = render([{ ...entry, evidence: [{ ...entry.evidence[0], ...(models ? { models } : {}) }] }]);
    expect(html).toContain(`<dt>Models</dt><dd>${expected}</dd>`);
    expect(html).not.toContain(' → ');
  });

  it('ignores malformed optional model metadata while keeping existing evidence validation strict', () => {
    const evidence = entry.evidence[0];
    for (const models of [null, [], 'invented', { gate: '' }, { extractor: 'x'.repeat(101) },
      { gate: '<script>bad</script>' }, { extractor: 'bad model' }, { unknown: 'untrusted' }]) {
      const state = normalizeLearning({ paused: false, learned: [{ ...entry, evidence: [{ ...evidence, models }] }] });
      expect(state.entries).toEqual([entry]);
      expect(render(state.entries)).toContain('<dt>Models</dt><dd>Local rules</dd>');
    }
    const models = { gate: 'typesafe/jev-1.14', extractor: 42, unknown: 'do not display' };
    const state = normalizeLearning({ paused: false, learned: [{ ...entry, evidence: [{ ...evidence, models }] }] });
    expect(state.entries[0].evidence[0].models).toEqual({ gate: 'typesafe/jev-1.14' });
    expect(render(state.entries)).not.toContain('do not display');
    expect(() => normalizeLearning({ paused: false, learned: [{ ...entry,
      evidence: [{ ...evidence, contributionId: undefined, models }] }] })).toThrow('contract');
  });

  it('does not label live Sample-account evidence as a scripted learning stage', () => {
    const state = normalizeLearning({ paused: false, learned: [entry], sample: true });
    const liveHtml = renderToStaticMarkup(createElement(LearningPanel, {
      state, sample: false, disabled: false, revoke: () => {},
    }));
    expect(liveHtml).toContain('Context status comes from the workspace');
    expect(liveHtml).not.toContain('scripted stage');
    expect(liveHtml).not.toContain('scripted learning');
    const sampleHtml = renderToStaticMarkup(createElement(LearningPanel, {
      state, sample: true, disabled: false, revoke: () => {},
    }));
    expect(sampleHtml).toContain('Sample · scripted learning');
    expect(sampleHtml).toContain('Context status follows the scripted stage');
  });

  it('renders a manual stated contribution without fabricating conversation, snippet or status', () => {
    const state = normalizeLearning({ paused: false, learned: [entry] });
    expect(state.entries).toEqual([entry]);
    const html = render([entry]);
    for (const value of ['pref.color', '黑色', 'personal-agent', 'User statement (stated)', 'contribution/original',
      'No conversation or request ID', 'Candidate · not yet in context', 'Recorded']) expect(html).toContain(value);
    expect(html).not.toContain('Added to context');
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain('<blockquote');
    expect(html).not.toContain('<dt>Conversation</dt>');
    expect(html).not.toContain('<dt>Request</dt>');
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
    expect(render(state.entries)).toContain('3 contributions · 2 sources');
    expect(() => normalizeLearning({ paused: false, learned: [{ ...entry, evidence: [evidence, evidence] }] })).toThrow('contract');
    expect(() => normalizeLearning({ paused: false, learned: [{ ...entry, evidence: [{ ...evidence, contributionId: undefined }] }] })).toThrow('contract');
  });

  it('counts evidence IDs rather than writers, without changing the returned card status', () => {
    const evidence = entry.evidence[0];
    const noIds = [evidence, { ...evidence, contributionId: 'other-writer', agentId: 'another-agent' }];
    expect(countEvidenceSources(noIds)).toBe(0);
    const stated = render([{ ...entry, status: 'card', evidence: noIds }]);
    expect(stated).toContain('Added to context');
    expect(stated).toContain('2 contributions · 0 sources');
    expect(stated).toContain('No conversation or request ID. This does not count as an independent source');
    expect(stated).not.toContain('deduplicated by agent');

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
    await expect(adapter.setLearning(true)).rejects.toThrow('did not confirm');
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
    expect(controller.getState().error).toContain('Pause learning was not confirmed');
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
    expect(render([])).toContain('No learned preferences yet. Eligible observations will appear here after processing.');
    const html = render([{ ...entry, status: 'card', evidence: [{ ...entry.evidence[0], snippet: '<script>private</script>' }] }]);
    expect(html).toContain('Added to context');
    expect(html).toContain('&lt;script&gt;private&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(renderToStaticMarkup(createElement(LearningToggle, { state: normalizeLearning({ paused: true, learned: [] }),
      disabled: false, change: () => {} }))).toContain('aria-checked="true"');
    expect(renderToStaticMarkup(createElement(LearningToggle, { state: { availability: 'unavailable', paused: null, entries: [] },
      disabled: false, change: () => {} }))).toContain('disabled=""');
  });
});
