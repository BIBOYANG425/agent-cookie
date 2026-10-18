import { remainingSeconds } from './controller';
import { FieldName } from './fields';
import { GrantNeeds } from './GrantNeeds';
import { stageLabels } from './funnel';
import type { ConsoleSnapshot } from './model';
import { shortPolicyId } from './policy';

const formatTime = (at: string | number) => new Date(at).toLocaleString('zh-CN', { hour12: false });

export function GrantsPanel({ data, sample, now, blocked, currentPolicyId, revoke }: {
  data: ConsoleSnapshot | null; sample: boolean; now: number; blocked: boolean; currentPolicyId?: string;
  revoke: (id: string) => void;
}) {
  return <section id="grants" className="panel" aria-labelledby="grants-title">
    <div className="sheet-heading"><h2 id="grants-title">授权</h2><span>到期或撤销后，商家不能继续读取</span></div>
    {!data || data.grants.length === 0 ? <p className="empty">{!data ? '连接后显示授权。' : '目前没有授权。介绍给商家后，相应的字段、用途和期限会显示在这里。'}</p>
      : <div className="grant-list">{data.grants.map((grant) => {
        const seconds = remainingSeconds(grant, data.receivedAt, now);
        const status = grant.status === 'revoked' ? '已撤销' : seconds === 0 ? '已过期' : `剩余 ${seconds} 秒`;
        return <article className="grant" key={grant.id}>
          <div className="grant-title"><div><h3>{grant.agentName}</h3><GrantNeeds grant={grant} events={data.events} /><p className="muted small">{grant.agentId}</p></div><span className={`grant-status ${grant.status !== 'live' || seconds === 0 ? 'inactive' : ''}`}>{status}</span></div>
          <dl><div><dt>允许字段</dt><dd>{grant.fields.length ? <ul className="grant-fields">{grant.fields.map((field) => <li key={field}><FieldName field={field} /></li>)}</ul> : '无'}</dd></div><div><dt>用途</dt><dd>{grant.purpose === 'handshake' ? '首次介绍（handshake）' : grant.purpose}</dd></div>
            <div><dt>阶段</dt><dd>{grant.stage ? `${stageLabels[grant.stage]}（${grant.stage}）` : '未记录'}</dd></div>
            <div><dt>策略</dt><dd>{grant.policyId ? <><code title={grant.policyId}>{shortPolicyId(grant.policyId)}</code>{grant.policyId === currentPolicyId ? ' · 当前策略' : ''}</> : '未记录'}</dd></div>
            <div><dt>会话</dt><dd>{grant.sessionId}</dd></div><div><dt>到期时间</dt><dd><time dateTime={grant.expiresAt}>{formatTime(grant.expiresAt)}</time></dd></div></dl>
          <button type="button" className="danger" disabled={blocked || grant.status !== 'live' || seconds === 0} aria-label={`撤销 ${grant.agentName} 的授权`} onClick={() => revoke(grant.id)}>{grant.status === 'revoked' ? '已撤销' : '撤销授权'}</button>
        </article>;
      })}</div>}
    {data && <p className="panel-note">{sample ? 'Sample 倒计时仅用于演示。' : '剩余秒数由工作台返回的时长计算；最终放行以工作台检查为准。'}</p>}
  </section>;
}
