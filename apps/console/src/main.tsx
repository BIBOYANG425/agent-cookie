import { StrictMode, useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import agents from '../../../fixtures/agents.json';
import { createLiveAdapter, createSampleAdapter } from './adapters';
import { ConsoleController, remainingSeconds } from './controller';
import type { ConsoleAdapter } from './model';
import './style.css';

const labels: Record<string, string> = { lang: '语言', tone: '说话方式', length: '回复长度', shoe_size: '鞋码',
  budget: '预算', deadline: '时间要求', shipping_address: '收货地址', payment_method: '支付方式引用' };
const basis: Record<string, string> = { stated: '用户陈述', observed: '观察记录', inferred: '推测' };
const formatTime = (at: string | number) => new Date(at).toLocaleString('zh-CN', { hour12: false });
const focusCard = () => document.getElementById('card-title')?.focus({ preventScroll: true });

function Connection({ adapter, change }: { adapter: ConsoleAdapter; change: (next: ConsoleAdapter) => void }) {
  function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem('ownerKey') as HTMLInputElement;
    const key = input.value.trim();
    if (!key) return;
    input.value = '';
    change(createLiveAdapter(key));
  }
  return <details className="connection">
    <summary>{adapter.mode === 'sample' ? '连接本机工作台' : '连接设置'}</summary>
    <p>目标：<code>127.0.0.1:4310</code>。钥匙只用于当前页面，刷新或断开后需重新输入。</p>
    <form onSubmit={connect}>
      <label htmlFor="owner-key">Owner 钥匙</label>
      <div className="connection-input">
        <input id="owner-key" name="ownerKey" type="password" autoComplete="off" spellCheck={false} required placeholder="手动输入 owner 钥匙" aria-describedby="key-help" />
        <button className="primary" type="submit">连接</button>
      </div>
      <p id="key-help" className="muted">连接后，撤销与重置会发送给这个本机工作台。</p>
    </form>
    {adapter.mode === 'live' && <button type="button" onClick={() => change(createSampleAdapter())}>断开并返回 Sample</button>}
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
  const connectionState = sample ? 'Sample · 未连接工作台' : state.loading ? '工作台 · 连接中' : state.error ? '工作台 · 需核对' : data ? '工作台 · 已连接' : '工作台 · 未连接';

  return <>
    <a className="skip-link" href="#card-title">跳到身份卡</a>
    <header className="masthead">
      <a className="brand" href="#card" aria-label="Agent Cookie 首页"><span className="brand-mark" aria-hidden="true">ac</span>Agent Cookie</a>
      <div className="header-actions"><span className={`mode-badge ${sample ? 'sample' : ''}`}>{connectionState}</span>
        <button type="button" disabled={blocked} onClick={() => void controller.reset()}>{state.pending.startsWith('重置') ? '正在重置…' : sample ? '重置 Sample' : '重置演示'}</button>
      </div>
    </header>
    <main>
      <div className="intro"><div><p className="context">你的 agent，从这里认识你</p><h1>我的 Agent Cookie</h1></div><p className="intro-note">信息有来处，授权有期限。<br />你随时可以收回。</p></div>
      <aside className="mode-notice"><strong>{sample ? 'Sample' : '本机工作台'}</strong><p>{sample
        ? '这是本页内存中的演示账户、身份卡与授权。所有操作只改变 Sample，不会请求真实服务。'
        : '正在使用你输入的 owner 钥匙。撤销将立即提交；重置仅在工作台开启演示模式时可用。'}</p></aside>
      <Connection adapter={adapter} change={change} />
      <nav className="section-nav" aria-label="控制台导航"><a href="#card">身份卡</a><a href="#grants">授权</a><a href="#activity">活动</a></nav>
      <div className="sync-line"><span>{data ? `最近更新 ${formatTime(data.receivedAt)} · 每 2 秒刷新` : state.loading ? '正在读取…' : '尚未读取工作台数据'}</span>
        <button type="button" className="text-button" disabled={!!state.pending} onClick={() => void controller.refresh()}>立即刷新</button></div>
      {state.pending && <p className="status-message" role="status">正在{state.pending}…</p>}
      {state.notice && <p className="status-message success" role="status">{state.notice}</p>}
      {state.error && <p className="status-message error" role="alert">{state.error}{data ? ' 下面保留最近一次读取的内容。' : ''}</p>}

      <section id="card" className="panel" aria-labelledby="card-title" aria-busy={state.loading}>
        <div className="sheet-heading"><h2 id="card-title" tabIndex={-1}>身份卡</h2><span>{sample ? 'Sample · 来源可展开' : '来源可展开'}</span></div>
        {!data ? <p className="empty">{state.loading ? '正在读取身份卡…' : '尚未连接。检查工作台和钥匙后重试，或返回 Sample。'}</p>
          : data.card.card.length === 0 ? <p className="empty">身份卡目前没有字段。{sample ? '你可以重置 Sample，恢复三条演示记录。' : 'agent 记录的合格信息将在这里显示。'}</p>
          : data.card.card.map((field) => {
            const records = data.contributions?.filter((row) => row.field === field.field && row.value === field.value && !row.revokedAt);
            return <details className="field-row" key={field.field}>
              <summary><span className="field-name">{labels[field.field] ?? field.field}</span><span className="field-value">{field.value || '（空值）'}</span><span className="source-toggle">查看来源 <span aria-hidden="true">＋</span></span></summary>
              <div className="source-detail">
                <p className="field-meta">可信度：{field.confidence === 'high' ? '高' : '中'}{field.changedRecently ? ' · 最近发生变化' : ''} · 最后支持时间 {formatTime(field.lastSupportedAt)}</p>
                {records?.map((record) => <article className="source-record" key={record.id}>
                  <h3>{name(record.agentId)}</h3>
                  <dl><div><dt>记录依据</dt><dd>{basis[record.basis]}（{record.basis}）</dd></div><div><dt>记录时间</dt><dd><time dateTime={record.createdAt}>{formatTime(record.createdAt)}</time></dd></div><div><dt>记录 ID</dt><dd>{record.id}</dd></div></dl>
                  <button type="button" className="danger" disabled={blocked} aria-label={`撤销${labels[field.field] ?? field.field}的来源 ${record.id}`} onClick={() => void controller.revokeContribution(record.id).then(focusCard)}>撤销这条来源</button>
                </article>)}
                {data.contributions === null && <><ul className="source-list">{field.sources.map((source) => <li key={source}>{name(source)}</li>)}</ul><p className="source-note">工作台目前只提供来源 agent ID，尚未提供贡献记录 ID；暂不能逐条撤销来源。</p></>}
                {records?.length === 0 && <p className="source-note">此字段没有可操作的来源记录。</p>}
              </div>
            </details>;
          })}
        {data && data.card.candidates.length > 0 && <details className="secondary-section"><summary>候选信息 · 尚未进入身份卡</summary><ul>{data.card.candidates.map((row, index) => <li key={`${row.field}-${index}`}>{labels[row.field] ?? row.field}：{row.value} · {row.reason === 'inferred' ? '推测' : '仅一个来源'}</li>)}</ul></details>}
        {data && data.card.superseded.length > 0 && <details className="secondary-section"><summary>历史值</summary><ul>{data.card.superseded.map((row, index) => <li key={`${row.field}-${index}`}>{labels[row.field] ?? row.field}：{row.value} → {row.supersededBy || '已不在身份卡中'}</li>)}</ul></details>}
      </section>

      <section id="grants" className="panel" aria-labelledby="grants-title">
        <div className="sheet-heading"><h2 id="grants-title">授权</h2><span>到期或撤销后，商家不能继续读取</span></div>
        {!data || data.grants.length === 0 ? <p className="empty">{!data ? '连接后显示授权。' : '目前没有授权。介绍给商家后，相应的字段、用途和期限会显示在这里。'}</p>
          : <div className="grant-list">{data.grants.map((grant) => {
            const seconds = remainingSeconds(grant, data.receivedAt, now);
            const status = grant.status === 'revoked' ? '已撤销' : seconds === 0 ? '已过期' : `剩余 ${seconds} 秒`;
            return <article className="grant" key={grant.id}>
              <div className="grant-title"><div><h3>{grant.agentName}</h3><p className="muted small">{grant.agentId}</p></div><span className={`grant-status ${grant.status !== 'live' || seconds === 0 ? 'inactive' : ''}`}>{status}</span></div>
              <dl><div><dt>允许字段</dt><dd>{grant.fields.map((field) => labels[field] ?? field).join('、') || '无'}</dd></div><div><dt>用途</dt><dd>{grant.purpose === 'handshake' ? '首次介绍（handshake）' : grant.purpose}</dd></div><div><dt>会话</dt><dd>{grant.sessionId}</dd></div><div><dt>到期时间</dt><dd><time dateTime={grant.expiresAt}>{formatTime(grant.expiresAt)}</time></dd></div></dl>
              <button type="button" className="danger" disabled={blocked || grant.status !== 'live' || seconds === 0} aria-label={`撤销 ${grant.agentName} 的授权`} onClick={() => void controller.revokeGrant(grant.id)}>{grant.status === 'revoked' ? '已撤销' : '撤销授权'}</button>
            </article>;
          })}</div>}
        {data && <p className="panel-note">{sample ? 'Sample 倒计时仅用于演示。' : '剩余秒数由工作台返回的时长计算；最终放行以工作台检查为准。'}</p>}
      </section>

      <section id="activity" className="panel" aria-labelledby="activity-title">
        <div className="sheet-heading"><h2 id="activity-title">活动</h2><span>最新在前 · 展开查看原因</span></div>
        {!data || data.events.length === 0 ? <p className="empty">{!data ? '连接后显示活动。' : '还没有活动记录。发生读取或修改后，这里会显示结果和原因。'}</p>
          : <ol className="activity-list">{data.events.map((event) => <li key={event.id}><details>
            <summary><div><time dateTime={event.at}>{formatTime(event.at)}</time><h3>{event.event}</h3></div><span className="activity-result">{event.result}</span><span className="reason-toggle">查看原因</span></summary>
            <div className="activity-detail"><dl><div><dt>执行者</dt><dd>{event.actor}</dd></div><div><dt>对象</dt><dd>{event.object || '无'}</dd></div><div><dt>原因</dt><dd>{event.reason || '没有额外原因说明。'}</dd></div></dl></div>
          </details></li>)}</ol>}
      </section>
      <footer className="page-footer"><span>{sample ? 'Sample 数据 · 不代表真实用户' : '本机工作台 · 断开后清除页面钥匙'}</span><span>身份信息由 agent 记录，工作台按规则合并。</span></footer>
    </main>
  </>;
}

function App() {
  const [adapter, setAdapter] = useState<ConsoleAdapter>(() => createSampleAdapter());
  return <Dashboard adapter={adapter} change={setAdapter} />;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
