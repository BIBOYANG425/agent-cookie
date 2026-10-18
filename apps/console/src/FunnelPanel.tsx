import { t, dateLocale } from './i18n';
import type { Section } from './model';
import { armLabels } from './experiments';
import { conversionText, FUNNEL_LIMIT, funnelTotals, outcomeLabels, searchBuckets, sourceLabels, type FunnelReport, type FunnelRow } from './funnel';

const time = (at: string) => new Date(at).toLocaleString(dateLocale(), { hour12: false });

function outcome(row: FunnelRow): string {
  if (row.outcome) return `${outcomeLabels[row.outcome]}（${row.outcome}）`;
  return row.accepted ? t("noOutcomeYet") : '—';
}

function SearchLine({ row }: { row: FunnelRow }) {
  const search = row.search;
  if (!search) return <span className="small muted">{t("noCatalogSearchFilterRecordFor")}</span>;
  return <details className="funnel-search-detail">
    <summary>{t("searchFiltersCandidates")}{search.offers}{t("eligible")}{search.eligible}{t("introduced54")}{search.picked}</summary>
    <p className="small">{t("excluded")}{searchBuckets.map(([key, label]) => `${t(label)} ${search[key]}`).join(' · ')}{t("eligibleProductsFrom")}{search.eligibleSellers}{t("sellers")}</p>
  </details>;
}

/** Counts and ids only: the workspace sends no field value, and the adapter keeps only the contract's keys. */
export function FunnelPanel({ state, sample }: { state?: Section<FunnelReport>; sample: boolean }) {
  const COLUMNS = [t("time"), t("group"), t("introduced"), t("quoted"), t("firstQuoteMs"), t("accepted"), t("outcome"), t("fieldsReadGranted"), t("receipts")] as const;
  const report = state?.availability === 'ready' ? state.data : undefined;
  const labelled = sample || report?.sample === true || (state?.availability === 'ready' && state.sample === true);
  const totals = report ? funnelTotals(report.rows) : undefined;
  return <section id="funnel" className="panel" aria-labelledby="funnel-title">
    <div className="sheet-heading"><h2 id="funnel-title" tabIndex={-1}>{t("funnel")}</h2>
      <span>{labelled ? t("sampleOneRowPerIntentCounts") : t("oneRowPerIntentCountsOnly")}</span></div>
    {!state ? <p className="empty">{t("connectToViewTheFunnel")}</p>
      : !report || !totals ? <p className="empty">{state.availability !== 'ready' && state.message}</p>
      : report.rows.length === 0 ? <p className="empty">{t("noIntentsYetAfterShoppingThrough")}</p>
      : <>
        <p className="funnel-totals"><strong>{t("totalsAcrossThe")}{totals.intents}{t("rowsBelow")}</strong>{t("introduced65")}{totals.introduced}{t("quoted66")}{totals.quoted}{t("accepted67")}{conversionText(totals)}{t("fieldsRead")}{totals.fieldsRead}{t("granted")}{totals.fieldsGranted}{t("receipts70")}{totals.purposeReleases}</p>
        {report.rows.length >= FUNNEL_LIMIT && <p className="panel-note">{t("onlyTheLatest")}{FUNNEL_LIMIT}{t("intentsAreReadOlderIntentsAre")}</p>}
        <table className="funnel-table stack-table">
          <caption className="visually-hidden">{t("funnelCountsPerIntentNewestFirst")}</caption>
          <thead><tr>{COLUMNS.map((column) => <th scope="col" key={column}>{column}</th>)}</tr></thead>
          {report.rows.map((row) => <tbody key={row.intentId}>
            <tr>
              <th scope="row" data-label={t("time")}><span><time dateTime={row.createdAt}>{time(row.createdAt)}</time>
                <span className="funnel-intent"><code>{row.intentId}</code> · {sourceLabels[row.source]}</span></span></th>
              <td data-label={t("group")}>{row.arm ? armLabels[row.arm] : '—'}</td>
              <td data-label={t("introduced")} className="num">{row.introduced}</td>
              <td data-label={t("quoted")} className="num">{row.quoted}</td>
              <td data-label={t("firstQuoteMs")} className="num">{row.firstQuoteMs === undefined ? '—' : Math.round(row.firstQuoteMs)}</td>
              <td data-label={t("accepted")}>{row.accepted ? t("yes") : t("no")}</td>
              <td data-label={t("outcome")}>{outcome(row)}</td>
              <td data-label={t("fieldsReadGranted")} className="num">{row.fieldsRead}/{row.fieldsGranted}</td>
              <td data-label={t("receipts")} className="num">{row.purposeReleases}</td>
            </tr>
            <tr className="funnel-search"><td colSpan={COLUMNS.length}><SearchLine row={row} /></td></tr>
          </tbody>)}
        </table>
        <p className="panel-note">{t("groupIsAssignedAtIntentCreation")}{labelled ? t("sampleDataNotRealMerchantsOr") : t("theWorkspaceReturnsCountsAndIds")}
          {t("reportGeneratedAt")}<time dateTime={report.generatedAt}>{time(report.generatedAt)}</time>。</p>
      </>}
  </section>;
}
