import { StrictMode, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import consoleSeed from './sample-context.json';
import learningSeed from './sample-learning.json';
import agents from '../../../fixtures/agents.json';
import { ContinuityPanel } from './ContinuityPanel';
import { ReceiptPanel } from './ReceiptPanel';
import { IntentConditionsPanel } from './IntentConditionsPanel';
import { ActivityPanel } from './ActivityPanel';
import { createLiveAdapter, createSampleAdapter, type PresentationSeed } from './adapters';
import { ConsoleController, remainingSeconds } from './controller';
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

const displayValue = (field: string, value: string) => ({ lang: { zh: 'Chinese', en: 'English' }, tone: { '简短': 'Concise' } } as Record<string, Record<string, string>>)[field]?.[value] ?? value;
const basis: Record<string, string> = { stated: 'User statement', observed: 'Observation', inferred: 'Inference' };
const formatTime = (at: string | number) => new Date(at).toLocaleString('en-US', { hour12: false });
const focusCard = () => document.getElementById('card-title')?.focus({ preventScroll: true });
const createConsoleSample = () => createSampleAdapter(Date.now, consoleSeed.contributions as Contribution[], learningSeed as LearningSeed,
  new URLSearchParams(window.location.search).get('learningStage') ?? undefined, consoleSeed.presentation as PresentationSeed);

function Connection({ adapter, change }: { adapter: ConsoleAdapter; change: (next: ConsoleAdapter) => void }) {
  return <details className="connection">
    <summary>{adapter.mode === 'sample' ? 'Connect your workspace' : 'Connection settings'}</summary>
    <p>Connect to the local workspace configured on this console server. Your owner key stays on the server.</p>
    <div className="connection-actions">
      <button className="primary" type="button" onClick={() => change(createLiveAdapter())}>Connect workspace</button>
      {adapter.mode === 'live' && <button type="button" onClick={() => change(createConsoleSample())}>Open sample preview</button>}
    </div>
    <p className="muted">Connected controls update your workspace. Sample controls only change the preview.</p>
  </details>;
}

function Dashboard({ adapter, change }: { adapter: ConsoleAdapter; change: (next: ConsoleAdapter) => void }) {
  const controller = useMemo(() => new ConsoleController(adapter), [adapter]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { controller.start(); return () => controller.stop(); }, [controller]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { document.title = `Agent Cookie · ${adapter.mode === 'sample' ? 'Sample preview' : 'Your workspace'}`; }, [adapter.mode]);
  const sample = adapter.mode === 'sample';
  const data = state.data;
  const blocked = !!state.pending || !data || !!state.error;
  const name = (id: string) => sample ? agents.find((agent) => agent.agentId === id)?.name ?? id : id;
  const connectionState = sample ? 'Sample preview' : state.loading ? 'Connecting' : state.error ? 'Connection needs attention' : data ? 'Workspace connected' : 'Not connected';
  const activeGrants = data?.grants.filter(grant => remainingSeconds(grant, data.receivedAt, now) > 0).length;
  const learning = data?.learning;
  const learnedCount = learning?.availability === 'ready' ? learning.entries.filter(entry => entry.status === 'candidate').length : undefined;

  return <>
    <a className="skip-link" href="#card-title">Skip to my context</a>
    <header className="masthead">
      <a className="brand" href="#card" aria-label="Agent Cookie home"><span className="brand-mark" aria-hidden="true">ac</span>Agent Cookie</a>
      <div className="header-actions"><span className={`mode-badge ${sample ? 'sample' : state.error ? 'disconnected' : 'connected'}`}><span className="status-dot" />{connectionState}</span>
        <LearningToggle state={learning} disabled={blocked} change={(paused) => void controller.setLearning(paused)} />
      </div>
    </header>
    <main>
      <div className="intro"><div><p className="context">YOUR PERSONAL CONTEXT</p><h1>Familiar to your agents.<br /><span>Always yours to control.</span></h1></div><p className="intro-note">See what your agents know,<br />where it came from, and who can use it.</p></div>
      <div className="workspace-summary" aria-label="Workspace overview">
        <div><span>Known details</span><strong>{data?.card.card.length ?? '—'}</strong><small>In your shared context</small></div>
        <div><span>Learning candidates</span><strong>{learnedCount ?? '—'}</strong><small>Waiting for enough evidence</small></div>
        <div><span>Active permissions</span><strong>{activeGrants ?? '—'}</strong><small>Access with a purpose and expiry</small></div>
      </div>
      <aside className={`mode-notice ${sample ? '' : 'workspace-notice'}`}><strong>{sample ? 'Sample' : data?.sample ? 'Sample workspace' : 'Local workspace'}</strong><p>{sample
        ? 'Explore a scripted preview. It uses no live workspace, model or merchant requests.'
        : `${data?.sample ? 'This workspace uses sample data. ' : ''}Changes apply to the connected workspace. Revocation stops future reads; it cannot recall data already shared.`}</p></aside>
      <Connection adapter={adapter} change={change} />
      <nav className="section-nav" aria-label="Workspace sections"><a href="#card">My context</a><a href="#intent-conditions">Requests</a><a href="#grants">Permissions</a><a href="#learned">Learning</a><a href="#receipts">Receipts</a></nav>
      <div className="sync-line"><span>{data ? `Updated ${formatTime(data.receivedAt)} · refreshes every 2s` : state.loading ? 'Loading workspace…' : 'Workspace data not loaded'}</span>
        <button type="button" className="text-button" disabled={!!state.pending} onClick={() => void controller.refresh()}>Refresh now</button></div>
      {state.pending && <p className="status-message" role="status">{state.pending}…</p>}
      {state.notice && <p className="status-message success" role="status">{state.notice}</p>}
      {state.error && <p className="status-message error" role="alert">{state.error}{data ? ' Showing the last successfully loaded data.' : ''}</p>}

      <div className="overview-grid">
      <section id="card" className="panel context-panel" aria-labelledby="card-title" aria-busy={state.loading}>
        <div className="sheet-heading"><div><p className="eyebrow">01 / CONTEXT</p><h2 id="card-title" tabIndex={-1}>What my agents know</h2></div><span>Every detail has a source</span></div>
        {!data ? <p className="empty">{state.loading ? 'Loading your context…' : 'Connect your workspace or open the sample preview.'}</p>
          : data.card.card.length === 0 ? <p className="empty">No shared details yet. Eligible information recorded by your agents will appear here.</p>
          : <div className="context-fields">{data.card.card.map((field) => {
            const records = data.contributions?.filter((row) => row.field === field.field && row.value === field.value && !row.revokedAt);
            return <details className="field-row" key={field.field}>
              <summary><span className="field-name"><FieldName field={field.field} /></span><span className="field-value">{field.field === 'shipping_address' ? 'Stored address' : displayValue(field.field, field.value) || '(empty)'}</span><span className="source-toggle">View source <span aria-hidden="true">↗</span></span></summary>
              <div className="source-detail">
                {field.field === 'shipping_address' && <p>{field.value}</p>}
                <p className="field-meta">Confidence: {field.confidence === 'high' ? 'High' : 'Medium'}{field.changedRecently ? ' · Recently changed' : ''} · Last supported {formatTime(field.lastSupportedAt)}</p>
                {records?.map((record) => <article className="source-record" key={record.id}>
                  <h3>{name(record.agentId)}</h3>
                  <dl><div><dt>Basis</dt><dd>{basis[record.basis]} ({record.basis})</dd></div><div><dt>Recorded</dt><dd><time dateTime={record.createdAt}>{formatTime(record.createdAt)}</time></dd></div><div><dt>Record ID</dt><dd>{record.id}</dd></div></dl>
                  <button type="button" className="danger" disabled={blocked} aria-label={`Remove source for ${fieldName(field.field)}: ${record.id}`} onClick={() => void controller.revokeContribution(record.id).then(focusCard)}>Remove this source</button>
                </article>)}
                {data.contributions === null && <><ul className="source-list">{field.sources.map((source) => <li key={source}>{name(source)}</li>)}</ul><p className="source-note">The workspace provides source agent IDs only. Individual removal needs a contribution ID.</p></>}
                {records?.length === 0 && <p className="source-note">No individual source records are available for this field.</p>}
              </div>
            </details>;
          })}</div>}
        {data && data.card.candidates.length > 0 && <details className="secondary-section"><summary>Candidates · not yet in your context</summary><ul>{data.card.candidates.map((row, index) => <li key={`${row.field}-${index}`}><FieldName field={row.field} />: {row.value} · {row.reason === 'inferred' ? 'Inference' : 'One source'}</li>)}</ul></details>}
        {data && data.card.superseded.length > 0 && <details className="secondary-section"><summary>Previous values</summary><ul>{data.card.superseded.map((row, index) => <li key={`${row.field}-${index}`}><FieldName field={row.field} />: {row.value} → {row.supersededBy || 'No longer in your context'}</li>)}</ul></details>}
      </section>
      <IntentConditionsPanel intents={data?.intents} />
      </div>

      <ContinuityPanel intents={data?.intents} receipts={data?.receipts} sample={sample || data?.sample === true} />
      <div className="section-heading"><p className="eyebrow">02 / CONNECTIONS & ACCESS</p><h2>Who can use your context</h2><p>Separate permissions for each recipient. Only actual reads appear in receipts.</p></div>
      <LinksPanel state={data?.links} sample={sample} blocked={blocked} handled={state.handledLinks}
        decide={(id, decision) => void controller.decideLink(id, decision).then(() => document.getElementById('links-title')?.focus({ preventScroll: true }))} />
      <GrantsPanel data={data} sample={sample} now={now} blocked={blocked}
        currentPolicyId={data?.policy?.availability === 'ready' ? data.policy.data.policyId : undefined}
        revoke={(id) => void controller.revokeGrant(id)} />

      <div className="section-heading"><p className="eyebrow">03 / SOURCES & HISTORY</p><h2>Nothing added without a trace</h2><p>Review learning candidates and the information your workspace has released.</p></div>
      <LearningPanel state={learning} sample={sample} disabled={blocked}
        revoke={(id) => void controller.revokeContribution(id).then(() => document.getElementById('learned-title')?.focus({ preventScroll: true }))}
        selectStage={sample ? (id) => void controller.selectLearningStage(id) : undefined} />
      <ReceiptPanel receipts={data?.receipts} sample={sample || data?.sample === true} />

      <details id="advanced" className="advanced-tools">
        <summary><span>Advanced</span><small>Policy, journey, experiments and activity</small></summary>
        <PolicyPanel state={data?.policy} sample={sample} result={state.policyResult} disabled={blocked}
          shadow={(text) => void controller.shadowPolicy(text)} install={(text) => void controller.installPolicy(text)} />
        <FunnelPanel state={data?.funnel} sample={sample} />
        <ExperimentPanel state={data?.experiments} sample={sample} />
        <ActivityPanel data={data} />
        <div className="demo-tools"><p>Reset clears demo records on the connected workspace. Use only when ready to start a new rehearsal.</p><button type="button" disabled={blocked} onClick={() => void controller.reset()}>{state.pending.startsWith('Reset') ? 'Resetting…' : sample ? 'Reset sample' : 'Reset demo'}</button></div>
      </details>
      <footer className="page-footer"><span>Agent Cookie · {sample ? 'Sample preview' : 'Local workspace'}</span><span>Context with sources. Access with limits.</span></footer>
    </main>
  </>;
}

function App() {
  const [adapter, setAdapter] = useState<ConsoleAdapter>(() => new URLSearchParams(window.location.search).get('mode') === 'live' ? createLiveAdapter() : createConsoleSample());
  const change = (next: ConsoleAdapter) => {
    const url = new URL(window.location.href);
    url.searchParams.set('mode', next.mode);
    window.history.replaceState(null, '', url);
    setAdapter(next);
  };
  return <Dashboard adapter={adapter} change={change} />;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
