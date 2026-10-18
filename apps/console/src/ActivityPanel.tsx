import { t, dateLocale, localizeUiText } from './i18n';
import type { ConsoleSnapshot } from './model';
import { activityLabel } from './receipts';

const formatTime = (at: string | number) => new Date(at).toLocaleString(dateLocale(), { hour12: false });

/** Newest first. Payment events get Chinese labels beside their raw names; every reason is shown as the workspace wrote it. */
export function ActivityPanel({ data, sample = false }: { data: ConsoleSnapshot | null; sample?: boolean }) {
  return <section id="activity" className="panel" aria-labelledby="activity-title">
    <div className="sheet-heading"><h2 id="activity-title">{t("activity")}</h2><span>{t("newestFirstExpandForReasons")}</span></div>
    {!data || data.events.length === 0 ? <p className="empty">{!data ? t("connectToViewActivity") : t("noActivityYetReadsAndChanges")}</p>
      : <ol className="activity-list">{data.events.map((event) => {
        const display = sample ? { ...event, event: localizeUiText(event.event), actor: localizeUiText(event.actor), result: localizeUiText(event.result), reason: localizeUiText(event.reason) } : event;
        const label = activityLabel(display);
        return <li key={event.id}><details>
          <summary><div><time dateTime={event.at}>{formatTime(event.at)}</time><h3>{label.title}</h3></div><span className="activity-result">{label.result}</span><span className="reason-toggle">{t("viewReason")}</span></summary>
          <div className="activity-detail"><dl><div><dt>{t("actor")}</dt><dd>{display.actor}</dd></div><div><dt>{t("object")}</dt><dd>{event.object || t("none")}</dd></div><div><dt>{t("reason")}</dt><dd>{display.reason || t("noAdditionalReasonProvided")}</dd></div>
            {label.note && <div><dt>{t("note")}</dt><dd>{label.note}</dd></div>}</dl></div>
        </details></li>;
      })}</ol>}
  </section>;
}
