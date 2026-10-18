import { t, dateLocale } from './i18n';
import { remainingSeconds } from './controller';
import { FieldName } from './fields';
import { GrantNeeds } from './GrantNeeds';
import { stageLabels } from './funnel';
import type { ConsoleSnapshot } from './model';
import { shortPolicyId } from './policy';

const formatTime = (at: string | number) => new Date(at).toLocaleString(dateLocale(), { hour12: false });

export function GrantsPanel({ data, sample, now, blocked, currentPolicyId, revoke }: {
  data: ConsoleSnapshot | null; sample: boolean; now: number; blocked: boolean; currentPolicyId?: string;
  revoke: (id: string) => void;
}) {
  return <section id="grants" className="panel" aria-labelledby="grants-title">
    <div className="sheet-heading"><h2 id="grants-title">{t("grants")}</h2><span>{t("merchantsCannotKeepReadingAfterExpiry")}</span></div>
    {!data || data.grants.length === 0 ? <p className="empty">{!data ? t("connectToViewGrants") : t("noGrantsYetIntroductionsToMerchants")}</p>
      : <div className="grant-list">{data.grants.map((grant) => {
        const seconds = remainingSeconds(grant, data.receivedAt, now);
        const status = grant.status === 'revoked' ? t("revoked") : seconds === 0 ? t("expired") : t("secondsRemaining", seconds);
        return <article className="grant" key={grant.id}>
          <div className="grant-title"><div><h3>{grant.agentName}</h3><GrantNeeds grant={grant} events={data.events} /><p className="muted small">{grant.agentId}</p></div><span className={`grant-status ${grant.status !== 'live' || seconds === 0 ? 'inactive' : ''}`}>{status}</span></div>
          <dl><div><dt>{t("allowedFields")}</dt><dd>{grant.fields.length ? <ul className="grant-fields">{grant.fields.map((field) => <li key={field}><FieldName field={field} /></li>)}</ul> : t("none")}</dd></div><div><dt>{t("purpose")}</dt><dd>{grant.purpose === 'handshake' ? t("firstIntroductionHandshake") : grant.purpose}</dd></div>
            <div><dt>{t("stage")}</dt><dd>{grant.stage ? `${stageLabels[grant.stage]}（${grant.stage}）` : t("notRecorded")}</dd></div>
            <div><dt>{t("policy")}</dt><dd>{grant.policyId ? <><code title={grant.policyId}>{shortPolicyId(grant.policyId)}</code>{grant.policyId === currentPolicyId ? t("currentPolicy") : ''}</> : t("notRecorded")}</dd></div>
            <div><dt>{t("session")}</dt><dd>{grant.sessionId}</dd></div><div><dt>{t("expiresAt")}</dt><dd><time dateTime={grant.expiresAt}>{formatTime(grant.expiresAt)}</time></dd></div></dl>
          <button type="button" className="danger" disabled={blocked || grant.status !== 'live' || seconds === 0} aria-label={t("revokeGrantFor", grant.agentName)} onClick={() => revoke(grant.id)}>{grant.status === 'revoked' ? t("revoked") : t("revokeGrant")}</button>
        </article>;
      })}</div>}
    {data && <p className="panel-note">{sample ? t("sampleCountdownForDemonstrationOnly") : t("remainingSecondsAreCalculatedFromThe")}</p>}
  </section>;
}
