import { ASSISTANT_GRANT_TTL_MS, LINK_TTL_MS } from '../../../packages/contract/src/types';
import type { Section } from './model';
import { linkStatusLabels, orderLinks, type LinkDecision, type LinkList } from './links';
import { shortId } from './receipts';
import './panels.css';

const formatTime = (at: string) => new Date(at).toLocaleString('zh-CN', { hour12: false });
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
    <div className="sheet-heading"><h2 id="links-title" tabIndex={-1}>连接请求</h2>
      <span>{labelled ? 'Sample · ' : ''}公司助理申请连接，由你批准</span></div>
    {!state ? <p className="empty">连接后显示连接请求。</p>
      : !list ? <p className="empty">{state.availability !== 'ready' && state.message}</p>
      : rows.length === 0 ? <p className="empty">还没有连接请求。公司助理申请连接时会出现在这里；没有你的批准，它拿不到会话。</p>
      : <>
        <p className="link-summary">{waiting} 条待批准，共 {rows.length} 条。</p>
        <ol className="link-list">{rows.map((link) => {
          const done = handled.includes(link.id);
          const open = link.status === 'pending' && !done;
          const status = link.status === 'pending' && done ? '已处理' : `${linkStatusLabels[link.status]}${done ? ' · 已处理' : ''}`;
          return <li className="link-record" key={link.id}>
            <div className="link-heading"><div><h3>{link.agentName}</h3><p className="muted small">{link.agentId}</p></div>
              <span className={`link-status ${open ? '' : 'inactive'}`}>{status}</span></div>
            <dl>
              <div><dt>请求 ID</dt><dd><code title={link.id}>{shortId(link.id)}</code></dd></div>
              <div><dt>申请时间</dt><dd><time dateTime={link.createdAt}>{formatTime(link.createdAt)}</time></dd></div>
              <div><dt>有效期至</dt><dd><time dateTime={link.expiresAt}>{formatTime(link.expiresAt)}</time></dd></div>
              <div><dt>处理时间</dt><dd>{link.decidedAt ? <time dateTime={link.decidedAt}>{formatTime(link.decidedAt)}</time>
                : link.status === 'expired' ? '未处理，已过期' : '尚未处理'}</dd></div>
            </dl>
            {open && <div className="link-actions">
              <button type="button" className="primary" disabled={blocked} aria-label={`批准 ${link.agentName} 的连接请求`}
                onClick={() => decide(link.id, 'approve')}>批准</button>
              <button type="button" className="danger" disabled={blocked} aria-label={`拒绝 ${link.agentName} 的连接请求`}
                onClick={() => decide(link.id, 'decline')}>拒绝</button>
            </div>}
          </li>;
        })}</ol>
      </>}
    {list && <p className="panel-note">{sample ? 'Sample 数据：批准或拒绝只改变本页，不创建会话或授权，也不请求工作台。'
      : `${labelled ? 'Sample 数据，不代表真实助理或用户。' : ''}按钮只在工作台确认后才改变这一行。`}
      批准后，助理得到自己的成对会话和一份 {GRANT_DAYS} 天的授权，你可以随时撤销；它按策略里“公司助理”一行读取字段值，
      永远读不到收货地址和支付方式。连接请求只能用一次，{LINK_MINUTES} 分钟后过期，过期后助理需要重新申请。</p>}
  </section>;
}
