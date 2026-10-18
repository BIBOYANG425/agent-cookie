import { ASSISTANT_GRANT_TTL_MS, LINK_TTL_MS } from '../../../packages/contract/src/types';
import type { Section } from './model';
import { linkStatusLabels, orderLinks, type LinkDecision, type LinkList } from './links';
import { shortId } from './receipts';
import './panels.css';

const formatTime = (at: string) => new Date(at).toLocaleString('en-US', { hour12: false });
const LINK_MINUTES = Math.round(LINK_TTL_MS / 60_000);
const GRANT_DAYS = Math.round(ASSISTANT_GRANT_TTL_MS / 86_400_000);

/**
 * GET /owner/links: who asked, the link id (shortened), its status and times. Approve / Decline only on a pending link, and
 * only the acknowledged, reloaded snapshot changes a row; a link the workspace answered 409 for reads Handled.
 */
export function LinksPanel({ state, sample, blocked, handled, decide }: {
  state?: Section<LinkList>; sample: boolean; blocked: boolean; handled: readonly string[];
  decide: (id: string, decision: LinkDecision) => void;
}) {
  const list = state?.availability === 'ready' ? state.data : undefined;
  const labelled = sample || (state?.availability === 'ready' && state.sample === true);
  const rows = list ? orderLinks(list.links) : [];
  const waiting = rows.filter((link) => link.status === 'pending' && !handled.includes(link.id)).length;
  return <section id="links" className="panel" aria-labelledby="links-title">
    <div className="sheet-heading"><h2 id="links-title" tabIndex={-1}>Connections</h2>
      <span>{labelled ? 'Sample · ' : ''}Approve access for connected assistants</span></div>
    {!state ? <p className="empty">Connect to view connection requests.</p>
      : !list ? <p className="empty">{state.availability !== 'ready' && state.message}</p>
      : rows.length === 0 ? <p className="empty">No connection requests. An assistant needs your approval before it receives a session.</p>
      : <>
        <p className="link-summary">{waiting} pending of {rows.length} requests.</p>
        <ol className="link-list">{rows.map((link) => {
          const done = handled.includes(link.id);
          const open = link.status === 'pending' && !done;
          const status = link.status === 'pending' && done ? 'Handled' : `${linkStatusLabels[link.status]}${done ? ' · Handled' : ''}`;
          return <li className="link-record" key={link.id}>
            <div className="link-heading"><div><h3>{link.agentName}</h3><p className="muted small">{link.agentId}</p></div>
              <span className={`link-status ${open ? '' : 'inactive'}`}>{status}</span></div>
            <dl>
              <div><dt>Request ID</dt><dd><code title={link.id}>{shortId(link.id)}</code></dd></div>
              <div><dt>Requested</dt><dd><time dateTime={link.createdAt}>{formatTime(link.createdAt)}</time></dd></div>
              <div><dt>Valid until</dt><dd><time dateTime={link.expiresAt}>{formatTime(link.expiresAt)}</time></dd></div>
              <div><dt>Decided</dt><dd>{link.decidedAt ? <time dateTime={link.decidedAt}>{formatTime(link.decidedAt)}</time>
                : link.status === 'expired' ? 'Expired without a decision' : 'Not decided'}</dd></div>
            </dl>
            {open && <div className="link-actions">
              <button type="button" className="primary" disabled={blocked} aria-label={`Approve connection for ${link.agentName}`}
                onClick={() => decide(link.id, 'approve')}>Approve</button>
              <button type="button" className="danger" disabled={blocked} aria-label={`Decline connection for ${link.agentName}`}
                onClick={() => decide(link.id, 'decline')}>Decline</button>
            </div>}
          </li>;
        })}</ol>
      </>}
    {list && <p className="panel-note">{sample ? 'Sample only. Approval or rejection changes this preview without creating a session or contacting the workspace.'
      : `${labelled ? 'Sample data, not an actual assistant or user.' : ''}Changes appear after workspace confirmation.`}
      Approval creates a separate session and a {GRANT_DAYS}-day grant. You can revoke it at any time. The assistant follows the assistant field policy and
      can never read shipping addresses or payment methods. Requests are single-use and expire after {LINK_MINUTES} minutes.</p>}
  </section>;
}
