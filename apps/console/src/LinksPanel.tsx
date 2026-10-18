import { ASSISTANT_GRANT_TTL_MS, LINK_TTL_MS } from '../../../packages/contract/src/types';
import type { Section } from './model';
import { linkStatusLabels, orderLinks, type LinkDecision, type LinkList } from './links';
import { shortId } from './receipts';
import { dateLocale, localizeUiText, t } from './i18n';
import './panels.css';

const formatTime = (at: string) => new Date(at).toLocaleString(dateLocale(), { hour12: false });
const LINK_MINUTES = Math.round(LINK_TTL_MS / 60_000);
const GRANT_DAYS = Math.round(ASSISTANT_GRANT_TTL_MS / 86_400_000);

/**
 * GET /owner/links: who asked, the link id (shortened), its status and times. 批准 / 拒绝 only on a pending link, and
 * only the acknowledged, reloaded snapshot changes a row; a link the workspace answered 409 for reads 已处理.
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
    <div className="sheet-heading"><h2 id="links-title" tabIndex={-1}>{t('connectionRequests')}</h2>
      <span>{labelled ? 'Sample · ' : ''}{t('linkApprovalHeading')}</span></div>
    {!state ? <p className="empty">{t('linkConnectToView')}</p>
      : !list ? <p className="empty">{state.availability !== 'ready' && localizeUiText(state.message)}</p>
      : rows.length === 0 ? <p className="empty">{t('linkEmpty')}</p>
      : <>
        <p className="link-summary">{t('linkPendingCount', waiting, rows.length)}</p>
        <ol className="link-list">{rows.map((link) => {
          const done = handled.includes(link.id);
          const open = link.status === 'pending' && !done;
          const status = link.status === 'pending' && done ? t('linkHandled') : `${linkStatusLabels[link.status]}${done ? ` · ${t('linkHandled')}` : ''}`;
          return <li className="link-record" key={link.id}>
            <div className="link-heading"><div><h3>{link.agentName}</h3><p className="muted small">{link.agentId}</p></div>
              <span className={`link-status ${open ? '' : 'inactive'}`}>{status}</span></div>
            <dl>
              <div><dt>{t('linkRequestId')}</dt><dd><code title={link.id}>{shortId(link.id)}</code></dd></div>
              <div><dt>{t('linkRequestedAt')}</dt><dd><time dateTime={link.createdAt}>{formatTime(link.createdAt)}</time></dd></div>
              <div><dt>{t('linkExpiresAt')}</dt><dd><time dateTime={link.expiresAt}>{formatTime(link.expiresAt)}</time></dd></div>
              <div><dt>{t('linkDecidedAt')}</dt><dd>{link.decidedAt ? <time dateTime={link.decidedAt}>{formatTime(link.decidedAt)}</time>
                : link.status === 'expired' ? t('linkExpiredUndecided') : t('linkUndecided')}</dd></div>
            </dl>
            {open && <div className="link-actions">
              <button type="button" className="primary" disabled={blocked} aria-label={t('linkApproveFor', link.agentName)}
                onClick={() => decide(link.id, 'approve')}>{t('linkApprove')}</button>
              <button type="button" className="danger" disabled={blocked} aria-label={t('linkDeclineFor', link.agentName)}
                onClick={() => decide(link.id, 'decline')}>{t('linkDecline')}</button>
            </div>}
          </li>;
        })}</ol>
      </>}
    {list && <p className="panel-note">{sample ? t('linkSampleNote')
      : `${labelled ? `${t('linkSampleAssistantsNote')} ` : ''}${t('linkConfirmedNote')}`}
      {' '}{t('linkConsentNote', GRANT_DAYS, LINK_MINUTES)}</p>}
  </section>;
}
