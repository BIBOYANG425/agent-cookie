import { FieldName, fieldName } from './fields';
import type { LearningState } from './learning';

const time = (at: string) => new Date(at).toLocaleString('zh-CN', { hour12: false });

export function LearningToggle({ state, disabled, change }: {
  state?: LearningState; disabled: boolean; change: (enabled: boolean) => void;
}) {
  const ready = state?.availability === 'ready' && state.enabled !== null;
  return <button type="button" className="learning-toggle" role="switch" aria-label="暂停学习"
    aria-checked={ready && state.enabled === false} disabled={disabled || !ready}
    aria-describedby="learning-toggle-note" onClick={() => { if (ready) change(!state.enabled); }}>
    <span className="switch-track" aria-hidden="true"><span /></span>暂停学习
    <span className="small">{!ready ? '状态未确认' : state.enabled ? '未暂停' : '已暂停'}</span>
  </button>;
}

export function LearningPanel({ state, sample, disabled, revoke, selectStage }: {
  state?: LearningState; sample: boolean; disabled: boolean;
  revoke: (id: string) => void; selectStage?: (id: string) => void;
}) {
  const active = state?.entries.filter((entry) => !entry.revokedAt) ?? [];
  const sourcesByValue = new Map<string, Set<string>>();
  for (const entry of active) {
    const key = JSON.stringify([entry.field, entry.value]);
    const sources = sourcesByValue.get(key) ?? new Set<string>();
    for (const source of entry.sources) sources.add(JSON.stringify([source.kind, source.id]));
    sourcesByValue.set(key, sources);
  }
  return <section id="learned" className="panel" aria-labelledby="learned-title">
    <div className="sheet-heading"><h2 id="learned-title" tabIndex={-1}>学到的</h2>
      <span>{sample || state?.sample ? 'Sample · 学习状态演示' : '记录、来源与证据'}</span></div>
    <p id="learning-toggle-note" className="panel-note">{state?.availability === 'ready'
      ? state.enabled ? '学习已开启。你可以在页面顶部暂停，也可以逐条撤销。' : '学习已暂停。已有记录仍保留，你可以逐条撤销。'
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
      : active.length === 0 ? <p className="empty">还没学到什么，和你的 agent 聊几句就会出现在这里</p>
      : <ol className="learned-list">{active.map((entry) => <li key={entry.id} className="learned-record">
        <div className="learned-heading"><div><h3><FieldName field={entry.field} /></h3><p className="learned-value">{entry.value || '（空值）'}</p></div>
          <span className={`learned-status ${entry.status}`}>{entry.status === 'on_card' ? '已进入身份卡'
            : entry.status === 'confirmed' ? '已确认 · 上卡状态待对齐' : '候选 · 尚未上卡'}</span></div>
        {entry.evidence && <blockquote className="learned-evidence">{entry.evidence}</blockquote>}
        <dl><div><dt>{entry.createdAt ? '记录时间' : '更新时间'}</dt><dd><time dateTime={entry.createdAt ?? entry.updatedAt}>{time((entry.createdAt ?? entry.updatedAt)!)}</time></dd></div>
          <div><dt>记录 ID</dt><dd><code>{entry.id}</code></dd></div></dl>
        <details className="learned-sources" open><summary>{entry.sources.length === 0 ? '来源与证据 · 尚未提供'
          : <>来源与证据 · 本条 {entry.sources.length} 个来源 · 同字段同值共 {sourcesByValue.get(JSON.stringify([entry.field, entry.value]))!.size} 个独立来源</>}</summary>
          <p className="source-note">{sample || state?.sample ? 'Sample 来源统计；上卡状态来自预设演示阶段。' : '上卡状态以工作台返回为准；同一对话或意图只计一次。'}</p>
          {entry.sources.length === 0 ? <p className="source-note">工作台尚未提供来源详情。</p>
            : <ul>{entry.sources.map((source) => <li key={JSON.stringify([source.kind, source.id])}>
              <p><strong>{source.kind === 'conversation' ? '对话' : '意图'}</strong>{source.label ? ` · ${source.label}` : ''} · <code>{source.id}</code></p>
              {source.agentId && <p className="small">agent：<code>{source.agentId}</code></p>}
              {source.evidence && <blockquote className="learned-evidence">{source.evidence}</blockquote>}
              {source.at && <time className="small" dateTime={source.at}>{time(source.at)}</time>}
            </li>)}</ul>}
        </details>
        {!entry.contributionId && <p className="source-note">学习记录 ID 尚未确认可用于贡献撤销，暂不能逐条撤销。</p>}
        <button type="button" className="danger" disabled={disabled || !entry.contributionId}
          aria-label={`撤销学到的${fieldName(entry.field)}记录 ${entry.id}`} onClick={() => { if (entry.contributionId) revoke(entry.contributionId); }}>撤销这条记录</button>
      </li>)}</ol>}
  </section>;
}
