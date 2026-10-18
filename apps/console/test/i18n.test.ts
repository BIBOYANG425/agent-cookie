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
  it('keeps the demo interface English even when the underlying card language is Chinese', async () => {
    setCardLanguage('zh'); setLocaleOverride('zh');
    const html = renderToStaticMarkup(createElement('div', null,
      createElement(FieldName, {field:'pref.color'}),
      createElement(LearningPanel, {sample:false, disabled:false, revoke:()=>{}, state:{availability:'ready', paused:false,entries:[{field:'pref.color',value:'黑色',status:'candidate',sources:[],evidence:[]}]}})));
    expect(html).toContain('Preferred colors');
    expect(html).not.toContain('颜色偏好');
    expect(html).toContain('黑色'); // User evidence remains exact; only presentation is English.
    const controller = new ConsoleController(createSampleAdapter(Date.now));
    controller.start();
    try {
      await controller.reset();
      expect(controller.getState().notice).not.toMatch(/[\u4e00-\u9fff]/u);
      await controller.decideLink(SAMPLE_LINK_ID, 'approve');
      expect(controller.getState().notice).not.toMatch(/[\u4e00-\u9fff]/u);
      await controller.decideLink(SAMPLE_LINK_ID, 'approve');
      expect(controller.getState().notice).toContain('already approved');
      expect(controller.getState().handledLinks).toEqual([SAMPLE_LINK_ID]);
    } finally { controller.stop(); }
  });
});
