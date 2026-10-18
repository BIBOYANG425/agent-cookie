import { useState } from 'react';
import type { PolicyResult } from './controller';
import type { Section } from './model';
import { categoryLabels, decisionLabels, POLICY_CATEGORIES, sourceLabels, type PolicyView } from './policy';

const SHOWN_CHANGES = 100;

function FieldList({ fields }: { fields: readonly string[] }) {
  return fields.length === 0 ? <span className="muted">无</span>
    : <ul className="policy-fields">{fields.map((field) => <li key={field}><code className="field-key">{field}</code></li>)}</ul>;
}

export function PolicyResultView({ result }: { result?: PolicyResult }) {
  if (!result) return null;
  if (result.kind === 'invalid') return <p className="status-message error policy-result" role="alert">{result.message}</p>;
  if (result.kind === 'installed') return <p className="status-message success policy-result" role="status">
    已安装策略 <code>{result.policyId}</code>。之后的新授权和回执会记下这个 ID。</p>;
  if (result.kind === 'violations') return <div className="status-message error policy-result" role="alert">
    <p>{result.action === '安装' ? '工作台拒绝安装，当前策略没有改变。' : '工作台没有做影子评估：候选文档不满足底线。'}
      以下 {result.violations.length} 项需要修改：</p>
    <ul className="policy-violations">{result.violations.map((line, index) => <li key={index}>{line}</li>)}</ul>
  </div>;
  const { report } = result;
  return <div className="policy-result shadow-report">
    <p role="status"><strong>影子评估</strong>：候选 <code>{report.candidateId}</code> 对比当前 <code>{report.currentId}</code>
      {report.candidateId === report.currentId ? '（两份文档相同）' : ''}：{report.changed.length} 处决定会改变，{report.unchanged} 处不变。
      只重放过去的回执和读取，没有改变任何东西。</p>
    {report.changed.length > 0 && <>
      <p className="small muted">receipt = 已放行的回执，read = 日志里的字段读取。{Object.entries(decisionLabels)
        .map(([code, label]) => `${code} = ${label}`).join('，')}。</p>
      <ol className="shadow-list">{report.changed.slice(0, SHOWN_CHANGES).map((row, index) => <li key={index}>
        <code>{row.ref}</code> · {row.kind} · <code>{row.field}</code>: {row.before} → {row.after}</li>)}</ol>
      {report.changed.length > SHOWN_CHANGES && <p className="small muted">仅显示前 {SHOWN_CHANGES} 条，共 {report.changed.length} 条。</p>}
    </>}
  </div>;
}

export function PolicyPanel({ state, sample, result, disabled, shadow, install }: {
  state?: Section<PolicyView>; sample: boolean; result?: PolicyResult; disabled: boolean;
  shadow: (text: string) => void; install: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const view = state?.availability === 'ready' ? state.data : undefined;
  const labelled = sample || (state?.availability === 'ready' && state.sample === true);
  const submit = !disabled && !sample && !!view;
  return <section id="policy" className="panel" aria-labelledby="policy-title">
    <div className="sheet-heading"><h2 id="policy-title" tabIndex={-1}>策略</h2>
      <span>{labelled ? 'Sample · 按用途放行，确定性核对' : '按用途放行，确定性核对'}</span></div>
    {!state ? <p className="empty">连接后显示当前字段策略。</p>
      : !view ? <p className="empty">{state.availability !== 'ready' && state.message}</p>
      : <>
        <dl className="policy-meta">
          <div><dt>策略 ID</dt><dd><code>{view.policyId}</code>{sample ? '（Sample 占位，不是哈希）' : ''}</dd></div>
          <div><dt>来源</dt><dd>{sourceLabels[view.source].label}（{view.source}）<span className="policy-source-note">{sourceLabels[view.source].note}</span></dd></div>
          <div><dt>排序权重</dt><dd>{view.policy.ranking
            ? <>winRate {view.policy.ranking.winRate} · failure {view.policy.ranking.failure}
              {view.policy.ranking.winRate === 0 && view.policy.ranking.failure === 0 ? '（均为 0，等同未设置）' : ''}</>
            : '未设置：按指定商家、尺码、偏好、预算和目录顺序排列。'}</dd></div>
        </dl>
        <table className="policy-table stack-table">
          <caption className="visually-hidden">每个类别的字段策略：自动、按用途、可写</caption>
          <thead><tr><th scope="col">类别</th><th scope="col">自动（握手即可读）</th><th scope="col">按用途</th><th scope="col">可写</th></tr></thead>
          <tbody>{POLICY_CATEGORIES.map((category) => {
            const purposes = Object.entries(view.policy.purpose[category] ?? {});
            return <tr key={category}>
              <th scope="row">{categoryLabels[category]} <code className="field-key">{category}</code></th>
              <td data-label="自动"><FieldList fields={view.policy.auto[category] ?? []} /></td>
              <td data-label="按用途">{purposes.length === 0 ? <span className="muted">无</span>
                : <ul className="policy-purposes">{purposes.map(([field, list]) => <li key={field}>
                  <code className="field-key">{field}</code> 仅用于 {(list ?? []).map((name, index) => <span key={name}>{index > 0 ? '、' : ''}<code>{name}</code></span>)}</li>)}</ul>}</td>
              <td data-label="可写"><FieldList fields={view.policy.write[category] ?? []} /></td>
            </tr>;
          })}</tbody>
        </table>
      </>}
    <div className="policy-candidate">
      <h3>候选策略</h3>
      <p id="policy-candidate-note" className="small muted">粘贴 JSON 格式的策略文档。影子评估只重放过去的回执和字段读取，不改变任何东西；
        安装后立即生效。两者都先由工作台按底线核对，不满足时列出每一项原因。{sample ? ' Sample 模式不评估也不安装，连接本机工作台后可用。' : ''}</p>
      <label htmlFor="policy-candidate-input">候选策略文档（JSON）</label>
      <textarea id="policy-candidate-input" value={text} rows={8} spellCheck={false} autoComplete="off"
        aria-describedby="policy-candidate-note" onChange={(event) => setText(event.target.value)} />
      <div className="policy-actions">
        <button type="button" disabled={!view} onClick={() => { if (view) setText(JSON.stringify(view.policy, null, 2)); }}>填入当前文档</button>
        <button type="button" disabled={!submit} onClick={() => shadow(text)}>影子评估</button>
        <button type="button" className="primary" disabled={!submit} onClick={() => install(text)}>安装</button>
      </div>
      <PolicyResultView result={result} />
    </div>
  </section>;
}
