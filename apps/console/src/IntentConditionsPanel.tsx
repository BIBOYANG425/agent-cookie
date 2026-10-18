import { t, dateLocale } from './i18n';
import type { IntentHistoryEntry } from '../../../packages/contract/src/types';
import { FieldName } from './fields';
import './panels.css';

const formatTime = (at: string) => new Date(at).toLocaleString(dateLocale(), { hour12: false });

/** public is explicit intent data. Do not infer field authorization or overwrite card defaults. */
export function IntentConditionsPanel({ intents }: { intents?: readonly IntentHistoryEntry[] | null }) {
  const rows = intents && [...intents].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return <section id="intent-conditions" className="panel" aria-labelledby="intent-conditions-title">
    <div className="sheet-heading"><h2 id="intent-conditions-title">{t("conditionsForThisRequest")}</h2><span>{t("shownSeparatelyPerRequest")}</span></div>
    <p className="panel-note">{t("explicitConditionsFromEachRequestThese")}</p>
    {intents === undefined ? <p className="empty">{t("requestConditionsAppearAfterLoading")}</p>
      : intents === null ? <p className="empty" role="status">{t("temporarilyUnavailableOtherViewsRemainUsable")}</p>
        : rows?.length === 0 ? <p className="empty">{t("noRequestHistoryYet")}</p>
          : <ol className="intent-list">{rows?.map(intent => <li className="intent-record" key={intent.id}>
            <div className="intent-heading"><h3>{intent.query || intent.text || t("request")}</h3><time dateTime={intent.createdAt}>{formatTime(intent.createdAt)}</time></div>
            <p className="small muted">{intent.id} · {intent.agentId}</p>
            {Object.keys(intent.public).length === 0 ? <p className="muted small">{t("noSeparateConditionsWereSpecifiedFor")}</p>
              : <dl className="intent-conditions">{Object.entries(intent.public).map(([field, value]) => <div key={field}>
                <dt>{field === 'size' ? <><span className="field-label">{t("size")}</span><code className="field-key">size</code></> : <FieldName field={field} />}</dt>
                <dd><span className="intent-condition-value">{value || t("empty")}</span><span className="intent-scope">{t("thisRequest")}</span></dd>
              </div>)}</dl>}
          </li>)}</ol>}
  </section>;
}
