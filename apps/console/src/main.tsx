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
import { PolicyPanel } from './PolicyPanel';
import './style.css';

const basis: Record<string, string> = { stated: '用户陈述', observed: '观察记录', inferred: '推测' };
const formatTime = (at: string | number) => new Date(at).toLocaleString('zh-CN', { hour12: false });
const focusCard = () => document.getElementById('card-title')?.focus({ preventScroll: true });
const createConsoleSample = () => createSampleAdapter(Date.now, consoleSeed.contributions as Contribution[], learningSeed as LearningSeed,
  new URLSearchParams(window.location.search).get('learningStage') ?? undefined, consoleSeed.presentation as PresentationSeed);

function Connection({ adapter, change }: { adapter: ConsoleAdapter; change: (next: ConsoleAdapter) => void }) {
  return <details className="connection">
    <summary>{adapter.mode === 'sample' ? '连接本机工作台' : '连接设置'}</summary>
    <p>目标：<code>127.0.0.1:4310</code>。使用本机控制台服务配置的 owner 钥匙，页面无需输入。</p>
    <button className="primary" type="button" onClick={() => change(createLiveAdapter())}>连接</button>
    <p className="muted">连接后，撤销与重置会发送给这个本机工作台。</p>
    {adapter.mode === 'live' && <button type="button" onClick={() => change(createConsoleSample())}>断开并返回 Sample</button>}
  </details>;
}

function Dashboard({ adapter, change }: { adapter: ConsoleAdapter; change: (next: ConsoleAdapter) => void }) {
  const controller = useMemo(() => new ConsoleController(adapter), [adapter]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { controller.start(); return () => controller.stop(); }, [controller]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { document.title = `Agent Cookie · ${adapter.mode === 'sample' ? 'Sample ' : ''}控制台`; }, [adapter.mode]);
  const sample = adapter.mode === 'sample';
  const data = state.data;
  const blocked = !!state.pending || !data || !!state.error;
  const name = (id: string) => sample ? agents.find((agent) => agent.agentId === id)?.name ?? id : id;
  const connectionState = sample ? 'Sample · 未连接工作台' : state.loading ? '工作台 · 连接中' : state.error ? '工作台 · 需核对' : data ? `${data.sample ? 'Sample ' : ''}工作台 · 已连接` : '工作台 · 未连接';

  return <>
    <a className="skip-link" href="#card-title">跳到身份卡</a>
    <header className="masthead">
      <a className="brand" href="#card" aria-label="Agent Cookie 首页"><span className="brand-mark" aria-hidden="true">ac</span>Agent Cookie</a>
      <div className="header-actions"><span className={`mode-badge ${sample ? 'sample' : ''}`}>{connectionState}</span>
        <LearningToggle state={data?.learning} disabled={blocked} change={(paused) => void controller.setLearning(paused)} />
        <button type="button" disabled={blocked} onClick={() => void controller.reset()}>{state.pending.startsWith('重置') ? '正在重置…' : sample ? '重置 Sample' : '重置演示'}</button>
      </div>
    </header>
    <main>
      <div className="intro"><div><p className="context">你的 agent，从这里认识你</p><h1>我的 Agent Cookie</h1></div><p className="intro-note">信息有来处，授权有期限。<br />你随时可以收回。</p></div>
      <aside className="mode-notice"><strong>{sample ? 'Sample' : data?.sample ? 'Sample · 本机工作台' : '本机工作台'}</strong><p>{sample
        ? '这是本页内存中的演示账户、身份卡与授权。所有操作只改变 Sample，不会请求真实服务。'
        : `${data?.sample ? '这是工作台上的 Sample 数据。' : ''}正在连接本机工作台。撤销将立即提交；重置仅在工作台开启演示模式时可用。`}</p></aside>
      <Connection adapter={adapter} change={change} />
      <nav className="section-nav" aria-label="控制台导航"><a href="#card">身份卡</a><a href="#learned">学到的</a><a href="#intent-conditions">本次请求</a><a href="#grants">授权</a><a href="#receipts">回执</a><a href="#policy">策略</a><a href="#funnel">漏斗</a><a href="#experiments">实验</a><a href="#activity">活动</a></nav>
      <div className="sync-line"><span>{data ? `最近更新 ${formatTime(data.receivedAt)} · 每 2 秒刷新` : state.loading ? '正在读取…' : '尚未读取工作台数据'}</span>
        <button type="button" className="text-button" disabled={!!state.pending} onClick={() => void controller.refresh()}>立即刷新</button></div>
      {state.pending && <p className="status-message" role="status">正在{state.pending}…</p>}
      {state.notice && <p className="status-message success" role="status">{state.notice}</p>}
      {state.error && <p className="status-message error" role="alert">{state.error}{data ? ' 下面保留最近一次读取的内容。' : ''}</p>}

      <section id="card" className="panel" aria-labelledby="card-title" aria-busy={state.loading}>
        <div className="sheet-heading"><h2 id="card-title" tabIndex={-1}>身份卡</h2><span>{sample ? 'Sample · 来源可展开' : '来源可展开'}</span></div>
        {!data ? <p className="empty">{state.loading ? '正在读取身份卡…' : '尚未连接。检查工作台和钥匙后重试，或返回 Sample。'}</p>
          : data.card.card.length === 0 ? <p className="empty">身份卡目前没有字段。{sample ? '你可以重置 Sample，恢复种子演示记录。' : 'agent 记录的合格信息将在这里显示。'}</p>
          : data.card.card.map((field) => {
            const records = data.contributions?.filter((row) => row.field === field.field && row.value === field.value && !row.revokedAt);
            return <details className="field-row" key={field.field}>
              <summary><span className="field-name"><FieldName field={field.field} /></span><span className="field-value">{field.value || '（空值）'}</span><span className="source-toggle">查看来源 <span aria-hidden="true">＋</span></span></summary>
              <div className="source-detail">
                <p className="field-meta">可信度：{field.confidence === 'high' ? '高' : '中'}{field.changedRecently ? ' · 最近发生变化' : ''} · 最后支持时间 {formatTime(field.lastSupportedAt)}</p>
                {records?.map((record) => <article className="source-record" key={record.id}>
                  <h3>{name(record.agentId)}</h3>
                  <dl><div><dt>记录依据</dt><dd>{basis[record.basis]}（{record.basis}）</dd></div><div><dt>记录时间</dt><dd><time dateTime={record.createdAt}>{formatTime(record.createdAt)}</time></dd></div><div><dt>记录 ID</dt><dd>{record.id}</dd></div></dl>
                  <button type="button" className="danger" disabled={blocked} aria-label={`撤销${fieldName(field.field)}的来源 ${record.id}`} onClick={() => void controller.revokeContribution(record.id).then(focusCard)}>撤销这条来源</button>
                </article>)}
                {data.contributions === null && <><ul className="source-list">{field.sources.map((source) => <li key={source}>{name(source)}</li>)}</ul><p className="source-note">工作台目前只提供来源 agent ID，尚未提供贡献记录 ID；暂不能逐条撤销来源。</p></>}
                {records?.length === 0 && <p className="source-note">此字段没有可操作的来源记录。</p>}
              </div>
            </details>;
          })}
        {data && data.card.candidates.length > 0 && <details className="secondary-section"><summary>候选信息 · 尚未进入身份卡</summary><ul>{data.card.candidates.map((row, index) => <li key={`${row.field}-${index}`}><FieldName field={row.field} />：{row.value} · {row.reason === 'inferred' ? '推测' : '仅一个来源'}</li>)}</ul></details>}
        {data && data.card.superseded.length > 0 && <details className="secondary-section"><summary>历史值</summary><ul>{data.card.superseded.map((row, index) => <li key={`${row.field}-${index}`}><FieldName field={row.field} />：{row.value} → {row.supersededBy || '已不在身份卡中'}</li>)}</ul></details>}
      </section>

      <LearningPanel state={data?.learning} sample={sample} disabled={blocked}
        revoke={(id) => void controller.revokeContribution(id).then(() => document.getElementById('learned-title')?.focus({ preventScroll: true }))}
        selectStage={sample ? (id) => void controller.selectLearningStage(id) : undefined} />

      <IntentConditionsPanel intents={data?.intents} />

      <GrantsPanel data={data} sample={sample} now={now} blocked={blocked}
        currentPolicyId={data?.policy?.availability === 'ready' ? data.policy.data.policyId : undefined}
        revoke={(id) => void controller.revokeGrant(id)} />

      <ReceiptPanel receipts={data?.receipts} sample={sample || data?.sample === true} />

      <PolicyPanel state={data?.policy} sample={sample} result={state.policyResult} disabled={blocked}
        shadow={(text) => void controller.shadowPolicy(text)} install={(text) => void controller.installPolicy(text)} />

      <FunnelPanel state={data?.funnel} sample={sample} />

      <ExperimentPanel state={data?.experiments} sample={sample} />

      <ActivityPanel data={data} />
      <footer className="page-footer"><span>{sample ? 'Sample 数据 · 不代表真实用户' : '本机工作台 · 钥匙由本机服务保管'}</span><span>身份信息由 agent 记录，工作台按规则合并。</span></footer>
    </main>
  </>;
}

function App() {
  const [adapter, setAdapter] = useState<ConsoleAdapter>(createConsoleSample);
  return <Dashboard adapter={adapter} change={setAdapter} />;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
