import { FieldName, fieldName } from './fields';
import { countEvidenceSources, type LearningState } from './learning';

const time = (at: string) => new Date(at).toLocaleString('zh-CN', { hour12: false });
const basis = { stated: '用户陈述', observed: '观察记录', inferred: '推测' };

export function LearningToggle({ state, disabled, change }: {
  state?: LearningState; disabled: boolean; change: (paused: boolean) => void;
}) {
  const ready = state?.availability === 'ready' && state.paused !== null;
  return <button type="button" className="learning-toggle" role="switch" aria-label="暂停学习"
    aria-checked={ready && state.paused === true} disabled={disabled || !ready}
    aria-describedby="learning-toggle-note" onClick={() => { if (ready) change(!state.paused); }}>
    <span className="switch-track" aria-hidden="true"><span /></span>暂停学习
    <span className="small">{!ready ? '状态未确认' : state.paused ? '已暂停' : '未暂停'}</span>
  </button>;
}

export function LearningPanel({ state, sample, disabled, revoke, selectStage }: {
  state?: LearningState; sample: boolean; disabled: boolean;
  revoke: (contributionId: string) => void; selectStage?: (id: string) => void;
}) {
  return <section id="learned" className="panel" aria-labelledby="learned-title">
    <div className="sheet-heading"><h2 id="learned-title" tabIndex={-1}>学到的</h2>
      <span>{sample || state?.sample ? 'Sample · 学习状态演示' : '记录、来源与证据'}</span></div>
    <p id="learning-toggle-note" className="panel-note">{state?.availability === 'ready'
      ? state.paused ? '学习已暂停。已有记录仍保留，你可以逐条撤销。' : '学习已开启。你可以在页面顶部暂停，也可以逐条撤销。'
      : '学习开关状态尚未确认，暂不能修改。身份卡、授权和活动仍可使用。'}</p>
    {sample && state?.sampleStages && <div className="learning-replay">
      <p>Sample 分阶段演示 · 不会运行提取器或请求商家</p>
      <div className="replay-actions">{state.sampleStages.map((stage) => <button type="button" key={stage.id}
        aria-pressed={state.sampleStage === stage.id} disabled={disabled || !selectStage}
        onClick={() => selectStage?.(stage.id)}>{stage.label}</button>)}</div>
      {state.sampleDescription && <p className="sample-description">{state.sampleDescription}</p>}
    </div>}
    {!state ? <p className="empty">连接后读取学习状态。</p>
      : state.availability !== 'ready' ? <p className="empty" role={state.availability === 'error' ? 'status' : undefined}>{state.message}</p>
      : state.entries.length === 0 ? <p className="empty">还没学到什么，和你的 agent 聊几句就会出现在这里</p>
      : <ol className="learned-list">{state.entries.map((entry) => <li key={JSON.stringify([entry.field, entry.value])} className="learned-record">
        <div className="learned-heading"><div><h3><FieldName field={entry.field} /></h3><p className="learned-value">{entry.value || '（空值）'}</p></div>
          <span className={`learned-status ${entry.status}`}>{entry.status === 'card' ? '已进入身份卡' : '候选 · 尚未上卡'}</span></div>
        <p className="small">来源 agent：{entry.sources.length ? entry.sources.join('、') : '尚未提供'}</p>
        <details className="learned-sources" open><summary>{entry.evidence.length === 0 ? '来源与证据 · 尚未提供'
          : <>来源与证据 · {entry.evidence.length} 条贡献 · {countEvidenceSources(entry.evidence)} 个来源</>}</summary>
          <p className="source-note">{sample || state.sample ? 'Sample 示意；上卡状态来自预设演示阶段。'
            : '上卡状态由工作台返回。对话与意图同时标注在同一证据时，只算一个来源。'}</p>
          {entry.evidence.length === 0 ? <p className="source-note">工作台尚未提供贡献记录，暂不能逐条撤销。</p>
            : entry.evidence.map((evidence) => <article className="source-record" key={evidence.contributionId}>
              <h3>{evidence.agentId}</h3>
              {evidence.snippet && <blockquote className="learned-evidence">{evidence.snippet}</blockquote>}
              <dl><div><dt>记录依据</dt><dd>{basis[evidence.basis]}（{evidence.basis}）</dd></div>
                <div><dt>记录时间</dt><dd><time dateTime={evidence.createdAt}>{time(evidence.createdAt)}</time></dd></div>
                {evidence.conversationId && <div><dt>对话</dt><dd><code>{evidence.conversationId}</code></dd></div>}
                {evidence.intentId && <div><dt>意图</dt><dd><code>{evidence.intentId}</code></dd></div>}
                {!evidence.conversationId && !evidence.intentId && <div><dt>来源标识</dt><dd>未提供对话或意图 ID，按来源 agent 去重。</dd></div>}
                <div><dt>贡献 ID</dt><dd><code>{evidence.contributionId}</code></dd></div></dl>
              <button type="button" className="danger" disabled={disabled}
                aria-label={`撤销学到的${fieldName(entry.field)}记录 ${evidence.contributionId}`}
                onClick={() => revoke(evidence.contributionId)}>撤销这条记录</button>
            </article>)}
        </details>
      </li>)}</ol>}
  </section>;
}
