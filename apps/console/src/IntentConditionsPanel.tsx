import type { IntentHistoryEntry } from '../../../packages/contract/src/types';
import { FieldName } from './fields';
import './panels.css';

const formatTime = (at: string) => new Date(at).toLocaleString('en-US', { hour12: false });
function RequestRecord({ intent }: { intent: IntentHistoryEntry }) {
  return <li className="intent-record">
    <div className="intent-heading"><h3>{intent.query || intent.text || 'Request'}</h3><time dateTime={intent.createdAt}>{formatTime(intent.createdAt)}</time></div>
    <p className="small muted">{intent.id} · {intent.agentId}</p>
    {Object.keys(intent.public).length === 0 ? <p className="muted small">No additional conditions were specified.</p>
      : <dl className="intent-conditions">{Object.entries(intent.public).map(([field, value]) => <div key={field}>
        <dt>{field === 'size' ? <><span className="field-label">Size </span><code className="field-key">size</code></> : <FieldName field={field} />}</dt>
        <dd><span className="intent-condition-value">{value || '(empty)'}</span><span className="intent-scope">This request</span></dd>
      </div>)}</dl>}
  </li>;
}

/** Explicit request data is kept separate from context defaults and access grants. */
export function IntentConditionsPanel({ intents }: { intents?: readonly IntentHistoryEntry[] | null }) {
  const rows = intents && [...intents].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return <section id="intent-conditions" className="panel" aria-labelledby="intent-conditions-title">
    <div className="sheet-heading"><div><p className="eyebrow">CURRENT REQUEST</p><h2 id="intent-conditions-title">What I need now</h2></div><span>Latest request first</span></div>
    <p className="panel-note">Explicit request conditions. These do not overwrite your context or prove merchant access.</p>
    {intents === undefined ? <p className="empty">Connect to view requests.</p>
      : intents === null ? <p className="empty" role="status">Temporarily unavailable. Other sections remain accessible.</p>
      : !rows?.length ? <p className="empty">No requests yet.</p>
      : <><ol className="intent-list"><RequestRecord intent={rows[0]} /></ol>
        {rows.length > 1 && <details className="records-history"><summary>Previous requests ({rows.length - 1})</summary>
          <ol className="intent-list">{rows.slice(1).map(intent => <RequestRecord key={intent.id} intent={intent} />)}</ol></details>}</>}
  </section>;
}
