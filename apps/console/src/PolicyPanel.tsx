import { useState } from 'react';
import type { PolicyResult } from './controller';
import type { Section } from './model';
import { categoryLabels, decisionLabels, POLICY_CATEGORIES, sourceLabels, type PolicyView } from './policy';

const SHOWN_CHANGES = 100;

function FieldList({ fields }: { fields: readonly string[] }) {
  return fields.length === 0 ? <span className="muted">None</span>
    : <ul className="policy-fields">{fields.map((field) => <li key={field}><code className="field-key">{field}</code></li>)}</ul>;
}

export function PolicyResultView({ result }: { result?: PolicyResult }) {
  if (!result) return null;
  if (result.kind === 'invalid') return <p className="status-message error policy-result" role="alert">{result.message}</p>;
  if (result.kind === 'installed') return <p className="status-message success policy-result" role="status">
    Installed policy <code>{result.policyId}</code>. New grants and receipts will reference this ID.</p>;
  if (result.kind === 'violations') return <div className="status-message error policy-result" role="alert">
    <p>{result.action === 'Install' ? 'Installation rejected. The current policy is unchanged.' : 'Policy preview rejected: the candidate does not meet the required safeguards.'}
      Fix these {result.violations.length} requirements:</p>
    <ul className="policy-violations">{result.violations.map((line, index) => <li key={index}>{line}</li>)}</ul>
  </div>;
  const { report } = result;
  return <div className="policy-result shadow-report">
    <p role="status"><strong>Policy preview</strong>: candidate <code>{report.candidateId}</code> compared with current <code>{report.currentId}</code>
      {report.candidateId === report.currentId ? ' (identical documents)' : ''}: {report.changed.length} decisions would change; {report.unchanged} would stay the same.
      Replays past reads without changing the current policy.</p>
    {report.changed.length > 0 && <>
      <p className="small muted">receipt = released fields; read = logged access. {Object.entries(decisionLabels)
        .map(([code, label]) => `${code} = ${label}`).join(', ')}. </p>
      <ol className="shadow-list">{report.changed.slice(0, SHOWN_CHANGES).map((row, index) => <li key={index}>
        <code>{row.ref}</code> · {row.kind} · <code>{row.field}</code>: {row.before} → {row.after}</li>)}</ol>
      {report.changed.length > SHOWN_CHANGES && <p className="small muted">Showing {SHOWN_CHANGES} of {report.changed.length} changes.</p>}
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
    <div className="sheet-heading"><h2 id="policy-title" tabIndex={-1}>Policy</h2>
      <span>{labelled ? 'Sample · access checked by purpose' : 'Access checked by purpose'}</span></div>
    {!state ? <p className="empty">Connect to view the current policy.</p>
      : !view ? <p className="empty">{state.availability !== 'ready' && state.message}</p>
      : <>
        <dl className="policy-meta">
          <div><dt>Policy ID</dt><dd><code>{view.policyId}</code>{sample ? ' (sample placeholder)' : ''}</dd></div>
          <div><dt>Source</dt><dd>{sourceLabels[view.source].label} ({view.source})<span className="policy-source-note">{sourceLabels[view.source].note}</span></dd></div>
          <div><dt>Ranking weights</dt><dd>{view.policy.ranking
            ? <>winRate {view.policy.ranking.winRate} · failure {view.policy.ranking.failure}
              {view.policy.ranking.winRate === 0 && view.policy.ranking.failure === 0 ? ' (both zero; default order)' : ''}</>
            : 'Default: merchant, size, preferences, budget, then catalog order.'}</dd></div>
        </dl>
        <table className="policy-table stack-table">
          <caption className="visually-hidden">Field access by category: automatic, purpose-based and writable</caption>
          <thead><tr><th scope="col">Category</th><th scope="col">Automatic on introduction</th><th scope="col">By purpose</th><th scope="col">Writable</th></tr></thead>
          <tbody>{POLICY_CATEGORIES.map((category) => {
            const purposes = Object.entries(view.policy.purpose[category] ?? {});
            return <tr key={category}>
              <th scope="row">{categoryLabels[category]} <code className="field-key">{category}</code></th>
              <td data-label="Automatic"><FieldList fields={view.policy.auto[category] ?? []} /></td>
              <td data-label="By purpose">{purposes.length === 0 ? <span className="muted">None</span>
                : <ul className="policy-purposes">{purposes.map(([field, list]) => <li key={field}>
                  <code className="field-key">{field}</code> only for {(list ?? []).map((name, index) => <span key={name}>{index > 0 ? ', ' : ''}<code>{name}</code></span>)}</li>)}</ul>}</td>
              <td data-label="Writable"><FieldList fields={view.policy.write[category] ?? []} /></td>
            </tr>;
          })}</tbody>
        </table>
      </>}
    <div className="policy-candidate">
      <h3>Candidate policy</h3>
      <p id="policy-candidate-note" className="small muted">Paste a policy as JSON. Preview replays past reads without changing data.
        Installation takes effect immediately. Both actions validate the required safeguards and list any violations.{sample ? ' Connect to a workspace to preview or install a policy.' : ''}</p>
      <label htmlFor="policy-candidate-input">Candidate policy (JSON)</label>
      <textarea id="policy-candidate-input" value={text} rows={8} spellCheck={false} autoComplete="off"
        aria-describedby="policy-candidate-note" onChange={(event) => setText(event.target.value)} />
      <div className="policy-actions">
        <button type="button" disabled={!view} onClick={() => { if (view) setText(JSON.stringify(view.policy, null, 2)); }}>Use current policy</button>
        <button type="button" disabled={!submit} onClick={() => shadow(text)}>Policy preview</button>
        <button type="button" className="primary" disabled={!submit} onClick={() => install(text)}>Install</button>
      </div>
      <PolicyResultView result={result} />
    </div>
  </section>;
}
