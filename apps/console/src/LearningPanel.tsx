import { FieldName, fieldName } from './fields';
import { countEvidenceSources, type LearningState } from './learning';

const time = (at: string) => new Date(at).toLocaleString('en-US', { hour12: false });
const basis = { stated: 'User statement', observed: 'Observation', inferred: 'Inference' };

export function LearningToggle({ state, disabled, change }: {
  state?: LearningState; disabled: boolean; change: (paused: boolean) => void;
}) {
  const ready = state?.availability === 'ready' && state.paused !== null;
  return <button type="button" className="learning-toggle" role="switch" aria-label="Pause learning"
    aria-checked={ready && state.paused === true} disabled={disabled || !ready}
    aria-describedby="learning-toggle-note" onClick={() => { if (ready) change(!state.paused); }}>
    <span className="switch-track" aria-hidden="true"><span /></span>Pause learning
    <span className="small">{!ready ? 'Unavailable' : state.paused ? 'Paused' : 'Active'}</span>
  </button>;
}

export function LearningPanel({ state, sample, disabled, revoke, selectStage }: {
  state?: LearningState; sample: boolean; disabled: boolean;
  revoke: (contributionId: string) => void; selectStage?: (id: string) => void;
}) {
  return <section id="learned" className="panel" aria-labelledby="learned-title">
    <div className="sheet-heading"><h2 id="learned-title" tabIndex={-1}>Learning</h2>
      <span>{sample ? 'Sample · scripted learning' : 'Candidates, sources and evidence'}</span></div>
    <p id="learning-toggle-note" className="panel-note">{state?.availability === 'ready'
      ? state.paused ? 'Learning is paused. Existing records remain available for review and removal.' : 'Learning is on. Pause it at any time, or remove a record below.'
      : 'Learning status is unavailable. Other sections remain accessible.'}</p>
    {sample && state?.sampleStages && <div className="learning-replay">
      <p>Sample replay · no model or merchant requests</p>
      <div className="replay-actions">{state.sampleStages.map((stage) => <button type="button" key={stage.id}
        aria-pressed={state.sampleStage === stage.id} disabled={disabled || !selectStage}
        onClick={() => selectStage?.(stage.id)}>{stage.label}</button>)}</div>
      {state.sampleDescription && <p className="sample-description">{state.sampleDescription}</p>}
    </div>}
    {!state ? <p className="empty">Connect to view learning status.</p>
      : state.availability !== 'ready' ? <p className="empty" role={state.availability === 'error' ? 'status' : undefined}>{state.message}</p>
      : state.entries.length === 0 ? <p className="empty">No learned preferences yet. Eligible observations will appear here after processing.</p>
      : <ol className="learned-list">{state.entries.map((entry) => <li key={JSON.stringify([entry.field, entry.value])} className="learned-record">
        <div className="learned-heading"><div><h3><FieldName field={entry.field} /></h3><p className="learned-value">{entry.value || '(empty)'}</p></div>
          <span className={`learned-status ${entry.status}`}>{entry.status === 'card' ? 'Added to context' : 'Candidate · not yet in context'}</span></div>
        <p className="small">Source agents: {entry.sources.length ? entry.sources.join(', ') : 'Not provided'}</p>
        <details className="learned-sources"><summary>{entry.evidence.length === 0 ? 'Sources and evidence · Not provided'
          : <>Sources and evidence · {entry.evidence.length} contributions · {countEvidenceSources(entry.evidence)} sources</>}</summary>
          <p className="source-note">{sample ? 'Sample only. Context status follows the scripted stage.'
            : 'Context status comes from the workspace. A conversation and its request count as one evidence source.'}</p>
          {entry.evidence.length === 0 ? <p className="source-note">Source records are unavailable, so individual removal is not available.</p>
            : entry.evidence.map((evidence) => <article className="source-record" key={evidence.contributionId}>
              <h3>{evidence.agentId}</h3>
              {evidence.snippet && <blockquote className="learned-evidence">{evidence.snippet}</blockquote>}
              <dl><div><dt>Basis</dt><dd>{basis[evidence.basis]} ({evidence.basis})</dd></div>
                <div><dt>Models</dt><dd>{[evidence.models?.gate, evidence.models?.extractor].filter(Boolean).join(' → ') || 'Local rules'}</dd></div>
                <div><dt>Recorded</dt><dd><time dateTime={evidence.createdAt}>{time(evidence.createdAt)}</time></dd></div>
                {evidence.conversationId && <div><dt>Conversation</dt><dd><code>{evidence.conversationId}</code></dd></div>}
                {evidence.intentId && <div><dt>Request</dt><dd><code>{evidence.intentId}</code></dd></div>}
                {!evidence.conversationId && !evidence.intentId && <div><dt>Source ID</dt><dd>No conversation or request ID. This does not count as an independent source.</dd></div>}
                <div><dt>Contribution ID</dt><dd><code>{evidence.contributionId}</code></dd></div></dl>
              <button type="button" className="danger" disabled={disabled}
                aria-label={`Remove learned ${fieldName(entry.field)}Record ${evidence.contributionId}`}
                onClick={() => revoke(evidence.contributionId)}>Remove this record</button>
            </article>)}
        </details>
      </li>)}</ol>}
  </section>;
}
