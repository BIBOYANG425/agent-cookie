import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { messages, localeFromLang, getLocale, getLocaleOverride, setCardLanguage, setLocaleOverride, dateLocale, localizeUiText, subscribeLocale } from '../src/i18n';
import { FieldName } from '../src/fields';
import { FunnelPanel } from '../src/FunnelPanel';
import { ExperimentPanel } from '../src/ExperimentPanel';
import { LearningPanel } from '../src/LearningPanel';
import { PolicyPanel } from '../src/PolicyPanel';
import { samplePolicyView } from '../src/policy';
import { sampleFunnelReport } from '../src/funnel';
import { sampleExperimentReport } from '../src/experiments';
import { ConsoleController } from '../src/controller';
import { createSampleAdapter } from '../src/adapters';
import { LinksPanel } from '../src/LinksPanel';
import { sampleLink, SAMPLE_LINK_ID } from '../src/links';

afterEach(() => { setLocaleOverride(undefined); setCardLanguage('zh'); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('console locales', () => {
  it('has identical keys, nonempty values and matching interpolation placeholders', () => {
    expect(Object.keys(messages.zh).sort()).toEqual(Object.keys(messages.en).sort());
    for (const key of Object.keys(messages.zh) as Array<keyof typeof messages.zh>) {
      expect(messages.zh[key].trim(), key).not.toBe(''); expect(messages.en[key].trim(), key).not.toBe('');
      expect([...(messages.en[key].match(/\{\d+\}/g) ?? [])].sort(), key).toEqual([...(messages.zh[key].match(/\{\d+\}/g) ?? [])].sort());
    }
  });
  it('uses card lang unless a persisted explicit selection overrides it', () => {
    const storage = { setItem: vi.fn(), removeItem: vi.fn() }; vi.stubGlobal('localStorage', storage);
    expect(localeFromLang('zh-TW')).toBe('zh'); expect(localeFromLang('fr')).toBe('en'); expect(localeFromLang()).toBe('en');
    const changed = vi.fn(); const unsubscribe = subscribeLocale(changed);
    setCardLanguage('en-US'); expect(getLocale()).toBe('en'); expect(dateLocale()).toBe('en-US');
    setLocaleOverride('zh'); setCardLanguage('en'); expect(getLocale()).toBe('zh');
    expect(storage.setItem).toHaveBeenCalledWith('agent-cookie-console-locale', 'zh'); expect(getLocaleOverride()).toBe('zh');
    setLocaleOverride(undefined); expect(getLocale()).toBe('en'); expect(storage.removeItem).toHaveBeenCalled();
    expect(changed).toHaveBeenCalled(); unsubscribe();
  });
  it('survives unavailable localStorage', () => {
    vi.stubGlobal('localStorage', {setItem: () => { throw Error('blocked'); }, removeItem: () => { throw Error('blocked'); }});
    expect(() => setLocaleOverride('en')).not.toThrow(); expect(getLocale()).toBe('en');
  });
  it('relocalizes generated success, failure and pending statuses in place', async () => {
    vi.useFakeTimers();
    const controller = new ConsoleController(createSampleAdapter(() => 0));
    controller.start();
    try {
      await controller.reset();
      expect(controller.getState().notice).toContain('仅本页');
      setLocaleOverride('en');
      expect(controller.getState().notice).toContain('Sample · this page only: Reset Sample completed.');
      expect(controller.getState().notice).not.toContain('完成');
      await controller.revokeGrant('missing');
      expect(controller.getState().error).toContain('Sample grant not found');
      setLocaleOverride('zh');
      expect(controller.getState().error).toContain('Sample 授权不存在');
      let finish!: () => void;
      controller.adapter.setLearning = () => new Promise<void>(resolve => { finish = resolve; });
      const operation = controller.setLearning(true);
      expect(controller.getState().pending).toBe('暂停学习');
      setLocaleOverride('en'); expect(controller.getState().pending).toBe('Pause learning');
      finish(); await operation;
      expect(controller.getState().notice).toContain('Pause learning completed.');
    } finally { controller.stop(); }
  });
  it('relabels static maps, headings and Sample warnings without changing raw fields', () => {
    const render = () => renderToStaticMarkup(createElement('div', null,
      createElement(FieldName, {field:'pref.color'}), createElement(FieldName, {field:'future.raw'}),
      createElement(FunnelPanel, {sample:true, state:{availability:'ready', data:sampleFunnelReport(0)}}),
      createElement(ExperimentPanel, {sample:true, state:{availability:'ready', data:sampleExperimentReport(0)}}),
      createElement(PolicyPanel, {sample:true, disabled:false, shadow:()=>{}, install:()=>{}, state:{availability:'ready',data:samplePolicyView()}}),
      createElement(LearningPanel, {sample:false, disabled:false, revoke:()=>{}, state:{availability:'ready', paused:false,entries:[{field:'pref.color',value:'黑色',status:'candidate',sources:[],evidence:[]}]}})));
    expect(render()).toContain('颜色偏好'); setLocaleOverride('en'); const html = render();
    for (const text of ['Color preference','First quote (ms)','Control','Insufficient sample','Sample','not real merchants','Install','Learned','Company assistant','pref.color','future.raw','黑色']) expect(html).toContain(text);
    expect(html).not.toContain('颜色偏好'); expect(html).not.toContain('首个报价');
    expect(localizeUiText(messages.zh.stageCandidate)).toBe(messages.en.stageCandidate);
    expect(localizeUiText('raw user text')).toBe('raw user text');
    setLocaleOverride('zh'); expect(render()).toContain('颜色偏好');
  });
  it('localizes consent labels, actions, dates and warnings while preserving raw assistant names', () => {
    const link = {...sampleLink(0), agentName:'Sample · 云端助理'};
    const render = (handled: string[] = [], sample = true) => renderToStaticMarkup(createElement(LinksPanel, {
      sample, blocked:false, handled, decide:()=>{}, state:{availability:'ready',sample:true,data:{links:[link]}},
    }));
    expect(render()).toContain('1 条待批准，共 1 条。');
    expect(render()).toContain('批准 Sample · 云端助理 的连接请求');
    setLocaleOverride('en'); const html = render();
    for (const text of ['Connection requests','1 pending, 1 total.','Request ID','Requested at','Valid until','Decided at',
      'Pending approval','Approve connection request from Sample · 云端助理','Decline connection request from Sample · 云端助理',
      'creates no session or grant','never shipping addresses or payment methods','30-day grant','10 minutes',
      new Date(0).toLocaleString('en-US', {hour12:false})]) expect(html).toContain(text);
    expect(html).not.toContain('待批准'); expect(html).not.toContain('批准连接请求');
    expect(html).toContain('workspace. After approval');
    expect(render([], false)).toContain('users. This row changes only after the workspace acknowledges the action. After approval');
    expect(render([link.id])).toContain('Handled'); expect(render([link.id])).not.toContain('</button>');
    setLocaleOverride('zh'); expect(render([link.id])).toContain('已处理');
  });
  it.each(['approve','decline'] as const)('relocalizes %s consent success and already-handled notices without a new action', async decision => {
    vi.useFakeTimers();
    const network = vi.spyOn(globalThis, 'fetch');
    const controller = new ConsoleController(createSampleAdapter(() => 0));
    controller.start();
    try {
      await controller.decideLink(SAMPLE_LINK_ID, decision);
      expect(controller.getState().notice).toContain(decision === 'approve' ? '批准连接请求完成' : '拒绝连接请求完成');
      setLocaleOverride('en');
      expect(controller.getState().notice).toContain(decision === 'approve' ? 'Approve connection request completed.' : 'Decline connection request completed.');
      await controller.decideLink(SAMPLE_LINK_ID, decision);
      expect(controller.getState().notice).toContain('This connection request was already handled');
      expect(controller.getState().notice).toContain('Nothing changed this time.');
      setLocaleOverride('zh'); expect(controller.getState().notice).toContain('这条连接请求已处理');
      expect(controller.getState().handledLinks).toEqual([SAMPLE_LINK_ID]);
      expect(controller.getState().data!.grants.map(grant => grant.agentId)).not.toContain('sample-assistant');
      expect(network).not.toHaveBeenCalled();
    } finally { controller.stop(); network.mockRestore(); }
  });
  it.each(['approve','decline'] as const)('relocalizes a pending %s action before its acknowledgement', async decision => {
    vi.useFakeTimers();
    const adapter = createSampleAdapter(() => 0);
    let acknowledge!: () => void;
    const decide = adapter.decideLink.bind(adapter);
    adapter.decideLink = async (...args) => { await new Promise<void>(resolve => {acknowledge = resolve;}); await decide(...args); };
    const controller = new ConsoleController(adapter);
    controller.start();
    try {
      const action = controller.decideLink(SAMPLE_LINK_ID, decision);
      expect(controller.getState().pending).toBe(decision === 'approve' ? '批准连接请求' : '拒绝连接请求');
      setLocaleOverride('en');
      expect(controller.getState().pending).toBe(decision === 'approve' ? 'Approve connection request' : 'Decline connection request');
      acknowledge(); await action;
      expect(controller.getState().pending).toBe('');
      expect(controller.getState().notice).toContain('completed.');
    } finally { controller.stop(); }
  });
});
