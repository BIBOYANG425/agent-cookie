import { remainingSeconds } from './controller';
import { FieldName } from './fields';
import { GrantNeeds } from './GrantNeeds';
import { stageLabels } from './funnel';
import type { ConsoleSnapshot, GrantView } from './model';
import { shortPolicyId } from './policy';
const formatTime = (at: string | number) => new Date(at).toLocaleString('en-US', { hour12: false });

export function GrantsPanel({ data, sample, now, blocked, currentPolicyId, revoke }: {
  data: ConsoleSnapshot | null; sample: boolean; now: number; blocked: boolean; currentPolicyId?: string;
  revoke: (id: string) => void;
}) {
  const active = data?.grants.filter(grant => grant.status === 'live' && remainingSeconds(grant, data.receivedAt, now) > 0) ?? [];
  const history = data?.grants.filter(grant => !active.includes(grant)) ?? [];
  const renderGrant = (grant: GrantView) => {
    const seconds = remainingSeconds(grant, data!.receivedAt, now);
    const status = grant.status === 'revoked' ? 'Revoked' : seconds === 0 ? 'Expired' : `${seconds}s remaining`;
    return <article className="grant" key={grant.id}>
      <div className="grant-title"><div><h3>{grant.agentName}</h3><p className="muted small">{grant.purpose === 'handshake' ? 'Introduction' : grant.purpose} · {grant.fields.length} allowed fields</p>
        <GrantNeeds grant={grant} events={data!.events} /></div><span className={`grant-status ${grant.status !== 'live' || seconds === 0 ? 'inactive' : ''}`}>{status}</span></div>
      <details className="grant-inspect"><summary>Inspect fields, purpose and session</summary>
        <dl><div><dt>Recipient</dt><dd>{grant.agentId}</dd></div>
          <div><dt>Allowed fields</dt><dd>{grant.fields.length ? <ul className="grant-fields">{grant.fields.map(field => <li key={field}><FieldName field={field} /></li>)}</ul> : 'None'}</dd></div>
          <div><dt>Purpose</dt><dd>{grant.purpose === 'handshake' ? 'Introduction (handshake)' : grant.purpose}</dd></div>
          <div><dt>Stage</dt><dd>{grant.stage ? `${stageLabels[grant.stage]} (${grant.stage})` : 'Not recorded'}</dd></div>
          <div><dt>Policy</dt><dd>{grant.policyId ? <><code title={grant.policyId}>{shortPolicyId(grant.policyId)}</code>{grant.policyId === currentPolicyId ? ' · current policy' : ''}</> : 'Not recorded'}</dd></div>
          <div><dt>Session</dt><dd>{grant.sessionId}</dd></div>
          <div><dt>Expires</dt><dd><time dateTime={grant.expiresAt}>{formatTime(grant.expiresAt)}</time></dd></div></dl>
      </details>
      <button type="button" className="danger" disabled={blocked || grant.status !== 'live' || seconds === 0} aria-label={`Revoke access for ${grant.agentName}`} onClick={() => revoke(grant.id)}>{grant.status === 'revoked' ? 'Revoked' : 'Revoke access'}</button>
    </article>;
  };
  return <section id="grants" className="panel" aria-labelledby="grants-title">
    <div className="sheet-heading"><h2 id="grants-title">Permissions</h2><span>Expiry or revocation stops future reads</span></div>
    {!data ? <p className="empty">Connect to view permissions.</p>
      : <>{active.length ? <div className="grant-list">{active.map(renderGrant)}</div> : <p className="empty">No active permissions. Access appears here when a merchant is introduced.</p>}
        {history.length > 0 && <details className="records-history"><summary>Past permissions ({history.length})</summary><div className="grant-list">{history.map(renderGrant)}</div></details>}</>}
    {data && <p className="panel-note">{sample ? 'Sample countdowns are illustrative.' : 'The workspace checks access on every read. A permission does not mean information has been read.'}</p>}
  </section>;
}
