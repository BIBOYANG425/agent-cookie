import { t, dateLocale, localizeUiText, getLocale, getLocaleOverride, setLocaleOverride, setCardLanguage, subscribeLocale } from './i18n';
import { StrictMode, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import consoleSeed from '../../../fixtures/console/generalized.json';
import { ReceiptPanel } from './ReceiptPanel';
import { IntentConditionsPanel } from './IntentConditionsPanel';
import agents from '../../../fixtures/agents.json';
import learningSeed from '../../../fixtures/learning/console.json';
import { ActivityPanel } from './ActivityPanel';
import { createLiveAdapter, createSampleAdapter, type PresentationSeed } from './adapters';
import { ConsoleController } from './controller';
import { ExperimentPanel } from './ExperimentPanel';
import { FieldName, fieldName } from './fields';
import { FunnelPanel } from './FunnelPanel';
import { GrantsPanel } from './GrantsPanel';
import type { ConsoleAdapter, Contribution } from './model';
import type { LearningSeed } from './learning';
import { LearningPanel, LearningToggle } from './LearningPanel';
import { LinksPanel } from './LinksPanel';
import { PolicyPanel } from './PolicyPanel';
import './style.css';

const basis: Record<string, string> = { get stated() { return t("userStated"); }, get observed() { return t("observed"); }, get inferred() { return t("inferred"); } };
const formatTime = (at: string | number) => new Date(at).toLocaleString(dateLocale(), { hour12: false });
const focusCard = () => document.getElementById('card-title')?.focus({ preventScroll: true });
const createConsoleSample = () => createSampleAdapter(Date.now, consoleSeed.contributions as Contribution[], learningSeed as LearningSeed,
  new URLSearchParams(window.location.search).get('learningStage') ?? undefined, consoleSeed.presentation as PresentationSeed);

function Connection({ adapter, change }: { adapter: ConsoleAdapter; change: (next: ConsoleAdapter) => void }) {
  return <details className="connection">
    <summary>{adapter.mode === 'sample' ? t("connectLocalWorkspace") : t("connectionSettings")}</summary>
    <p>{t("target")}<code>127.0.0.1:4310</code>{t("usesTheOwnerKeyConfiguredIn")}</p>
    <button className="primary" type="button" onClick={() => change(createLiveAdapter())}>{t("connect")}</button>
    <p className="muted">{t("afterConnectingRevocationsAndResetsAre")}</p>
    {adapter.mode === 'live' && <button type="button" onClick={() => change(createConsoleSample())}>{t("disconnectAndReturnToSample")}</button>}
  </details>;
}

function Dashboard({ adapter, change }: { adapter: ConsoleAdapter; change: (next: ConsoleAdapter) => void }) {
  const controller = useMemo(() => new ConsoleController(adapter), [adapter]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const locale = useSyncExternalStore(subscribeLocale, getLocale);
  useEffect(() => { if (state.data) setCardLanguage(state.data.card.card.find(field => field.field === 'lang')?.value); }, [state.data]);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { controller.start(); return () => controller.stop(); }, [controller]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { document.title = t("agentCookieConsole", adapter.mode === 'sample' ? 'Sample ' : ''); }, [adapter.mode, locale]);
  const sample = adapter.mode === 'sample';
  const data = state.data;
  const blocked = !!state.pending || !data || !!state.error;
  const name = (id: string) => sample ? agents.find((agent) => agent.agentId === id)?.name ?? id : id;
  const connectionState = sample ? t("sampleNotConnected") : state.loading ? t("workspaceConnecting") : state.error ? t("workspaceNeedsChecking") : data ? t("workspaceConnected", data.sample ? 'Sample ' : '') : t("workspaceNotConnected");

  return <>
    <a className="skip-link" href="#card-title">{t("skipToIdentityCard")}</a>
    <header className="masthead">
      <a className="brand" href="#card" aria-label={t("agentCookieHome")}><span className="brand-mark" aria-hidden="true">ac</span>Agent Cookie</a>
      <div className="header-actions"><span className={`mode-badge ${sample ? 'sample' : ''}`}>{connectionState}</span>
        <label className="locale-toggle">{t('displayLanguage')}
          <select aria-label={t('displayLanguage')} value={getLocaleOverride() ?? 'card'}
            onChange={(event) => setLocaleOverride(event.target.value === 'card' ? undefined : event.target.value as 'zh' | 'en')}>
            <option value="card">{t('followCardLanguage')}</option><option value="zh">{t('chinese')}</option><option value="en">{t('english')}</option>
          </select></label>
        <LearningToggle state={data?.learning} disabled={blocked} change={(paused) => void controller.setLearning(paused)} />
        <button type="button" disabled={blocked} onClick={() => void controller.reset()}>{state.pending.startsWith(t("reset")) ? t("resetting") : sample ? t("resetSample") : t("resetDemo")}</button>
      </div>
    </header>
    <main>
      <div className="intro"><div><p className="context">{t("whereYourAgentGetsToKnow")}</p><h1>{t("myAgentCookie")}</h1></div><p className="intro-note">{t("informationHasSourcesAccessHasAn")}<br />{t("youCanTakeItBackAt")}</p></div>
      <aside className="mode-notice"><strong>{sample ? 'Sample' : data?.sample ? t("sampleLocalWorkspace") : t("localWorkspace")}</strong><p>{sample
        ? t("demoAccountCardAndGrantsHeld")
        : t("connectingToTheLocalWorkspaceRevocations", data?.sample ? t("thisIsSampleDataOnThe") : '')}</p></aside>
      <Connection adapter={adapter} change={change} />
      <nav className="section-nav" aria-label={t("consoleNavigation")}><a href="#card">{t("identityCard")}</a><a href="#learned">{t("learned")}</a><a href="#intent-conditions">{t("thisRequest315")}</a><a href="#links">{t("connectionRequests")}</a><a href="#grants">{t("grants")}</a><a href="#receipts">{t("receipts")}</a><a href="#policy">{t("policy")}</a><a href="#funnel">{t("funnel")}</a><a href="#experiments">{t("experiments")}</a><a href="#activity">{t("activity")}</a></nav>
      <div className="sync-line"><span>{data ? t("updatedRefreshesEverySeconds", formatTime(data.receivedAt)) : state.loading ? t("loading") : t("workspaceDataNotLoadedYet")}</span>
        <button type="button" className="text-button" disabled={!!state.pending} onClick={() => void controller.refresh()}>{t("refreshNow")}</button></div>
      {state.pending && <p className="status-message" role="status">{t("working")}{localizeUiText(state.pending)}…</p>}
      {state.notice && <p className="status-message success" role="status">{state.notice}</p>}
      {state.error && <p className="status-message error" role="alert">{state.error}{data ? t("theLastLoadedContentIsRetained") : ''}</p>}

      <section id="card" className="panel" aria-labelledby="card-title" aria-busy={state.loading}>
        <div className="sheet-heading"><h2 id="card-title" tabIndex={-1}>{t("identityCard")}</h2><span>{sample ? t("sampleExpandForSources") : t("expandForSources")}</span></div>
        {!data ? <p className="empty">{state.loading ? t("loadingIdentityCard") : t("notConnectedCheckTheWorkspaceAnd")}</p>
          : data.card.card.length === 0 ? <p className="empty">{t("theCardHasNoFieldsYet")}{sample ? t("resetSampleToRestoreSeedDemo") : t("eligibleAgentRecordsAppearHere")}</p>
          : data.card.card.map((field) => {
            const records = data.contributions?.filter((row) => row.field === field.field && row.value === field.value && !row.revokedAt);
            return <details className="field-row" key={field.field}>
              <summary><span className="field-name"><FieldName field={field.field} /></span><span className="field-value">{field.value || t("empty")}</span><span className="source-toggle">{t("viewSources")}<span aria-hidden="true">＋</span></span></summary>
              <div className="source-detail">
                <p className="field-meta">{t("confidence")}{field.confidence === 'high' ? t("high") : t("medium")}{field.changedRecently ? t("changedRecently") : ''}{t("lastSupported")}{formatTime(field.lastSupportedAt)}</p>
                {records?.map((record) => <article className="source-record" key={record.id}>
                  <h3>{name(record.agentId)}</h3>
                  <dl><div><dt>{t("recordBasis")}</dt><dd>{basis[record.basis]}（{record.basis}）</dd></div><div><dt>{t("recordedAt")}</dt><dd><time dateTime={record.createdAt}>{formatTime(record.createdAt)}</time></dd></div><div><dt>{t("recordId")}</dt><dd>{record.id}</dd></div></dl>
                  <button type="button" className="danger" disabled={blocked} aria-label={t("revokeSourceFor", fieldName(field.field), record.id)} onClick={() => void controller.revokeContribution(record.id).then(focusCard)}>{t("revokeThisSource")}</button>
                </article>)}
                {data.contributions === null && <><ul className="source-list">{field.sources.map((source) => <li key={source}>{name(source)}</li>)}</ul><p className="source-note">{t("theWorkspaceProvidesSourceAgentIds")}</p></>}
                {records?.length === 0 && <p className="source-note">{t("noActionableSourceRecordsForThis")}</p>}
              </div>
            </details>;
          })}
        {data && data.card.candidates.length > 0 && <details className="secondary-section"><summary>{t("candidatesNotOnTheCardYet")}</summary><ul>{data.card.candidates.map((row, index) => <li key={`${row.field}-${index}`}><FieldName field={row.field} />：{row.value} · {row.reason === 'inferred' ? t("inferred") : t("onlyOneSource")}</li>)}</ul></details>}
        {data && data.card.superseded.length > 0 && <details className="secondary-section"><summary>{t("previousValues")}</summary><ul>{data.card.superseded.map((row, index) => <li key={`${row.field}-${index}`}><FieldName field={row.field} />：{row.value} → {row.supersededBy || t("noLongerOnTheCard")}</li>)}</ul></details>}
      </section>

      <LearningPanel state={data?.learning} sample={sample} disabled={blocked}
        revoke={(id) => void controller.revokeContribution(id).then(() => document.getElementById('learned-title')?.focus({ preventScroll: true }))}
        selectStage={sample ? (id) => void controller.selectLearningStage(id) : undefined} />

      <IntentConditionsPanel intents={data?.intents} />

      <LinksPanel state={data?.links} sample={sample} blocked={blocked} handled={state.handledLinks}
        decide={(id, decision) => void controller.decideLink(id, decision).then(() => document.getElementById('links-title')?.focus({ preventScroll: true }))} />

      <GrantsPanel data={data} sample={sample} now={now} blocked={blocked}
        currentPolicyId={data?.policy?.availability === 'ready' ? data.policy.data.policyId : undefined}
        revoke={(id) => void controller.revokeGrant(id)} />

      <ReceiptPanel receipts={data?.receipts} sample={sample || data?.sample === true} />

      <PolicyPanel state={data?.policy} sample={sample} result={state.policyResult} disabled={blocked}
        shadow={(text) => void controller.shadowPolicy(text)} install={(text) => void controller.installPolicy(text)} />

      <FunnelPanel state={data?.funnel} sample={sample} />

      <ExperimentPanel state={data?.experiments} sample={sample} />

      <ActivityPanel data={data} sample={sample} />
      <footer className="page-footer"><span>{sample ? t("sampleDataNotRealUsers") : t("localWorkspaceKeyHeldByLocal")}</span><span>{t("agentsRecordIdentityInformationTheWorkspace")}</span></footer>
    </main>
  </>;
}

function App() {
  const [adapter, setAdapter] = useState<ConsoleAdapter>(createConsoleSample);
  return <Dashboard adapter={adapter} change={setAdapter} />;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
