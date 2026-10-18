import type { Section } from './model';
import { armLabels } from './experiments';
import { conversionText, FUNNEL_LIMIT, funnelTotals, outcomeLabels, searchBuckets, sourceLabels, type FunnelReport, type FunnelRow } from './funnel';

const time = (at: string) => new Date(at).toLocaleString('en-US', { hour12: false });
const COLUMNS = ['Time', 'Group', 'Introduced', 'Quoted', 'First quote (ms)', 'Accepted', 'Outcome', 'Fields (read/granted)', 'Receipts'] as const;

function outcome(row: FunnelRow): string {
  if (row.outcome) return `${outcomeLabels[row.outcome]} (${row.outcome})`;
  return row.accepted ? 'No outcome yet' : '—';
}

function SearchLine({ row }: { row: FunnelRow }) {
  const search = row.search;
  if (!search) return <span className="small muted">No catalog filtering record for this request.</span>;
  return <details className="funnel-search-detail">
    <summary>Catalog: {search.offers} offers → {search.eligible} eligible · {search.picked} introduced</summary>
    <p className="small">Excluded: {searchBuckets.map(([key, label]) => `${label} ${search[key]}`).join(' · ')}.
      Eligible products from {search.eligibleSellers} sellers.</p>
  </details>;
}

/** Counts and ids only: the workspace sends no field value, and the adapter keeps only the contract's keys. */
export function FunnelPanel({ state, sample }: { state?: Section<FunnelReport>; sample: boolean }) {
  const report = state?.availability === 'ready' ? state.data : undefined;
  const labelled = sample || report?.sample === true || (state?.availability === 'ready' && state.sample === true);
  const totals = report ? funnelTotals(report.rows) : undefined;
  return <section id="funnel" className="panel" aria-labelledby="funnel-title">
    <div className="sheet-heading"><h2 id="funnel-title" tabIndex={-1}>Journey</h2>
      <span>{labelled ? 'Sample · one row per request' : 'One row per request · counts only'}</span></div>
    {!state ? <p className="empty">Connect to view the journey report.</p>
      : !report || !totals ? <p className="empty">{state.availability !== 'ready' && state.message}</p>
      : report.rows.length === 0 ? <p className="empty">No requests yet. A shopping request will show introductions, quotes and outcomes here.</p>
      : <>
        <p className="funnel-totals"><strong>Totals for the {totals.intents} requests below</strong>: Introduced {totals.introduced} ·
          Quoted {totals.quoted} · Accepted {conversionText(totals)} · Fields read {totals.fieldsRead} / granted {totals.fieldsGranted} ·
          Receipts {totals.purposeReleases}</p>
        {report.rows.length >= FUNNEL_LIMIT && <p className="panel-note">Showing the latest {FUNNEL_LIMIT} requests. Earlier requests are excluded from these totals.</p>}
        <table className="funnel-table stack-table">
          <caption className="visually-hidden">Journey counts per request, newest first</caption>
          <thead><tr>{COLUMNS.map((column) => <th scope="col" key={column}>{column}</th>)}</tr></thead>
          {report.rows.map((row) => <tbody key={row.intentId}>
            <tr>
              <th scope="row" data-label="Time"><span><time dateTime={row.createdAt}>{time(row.createdAt)}</time>
                <span className="funnel-intent"><code>{row.intentId}</code> · {sourceLabels[row.source]}</span></span></th>
              <td data-label="Group">{row.arm ? armLabels[row.arm] : '—'}</td>
              <td data-label="Introduced" className="num">{row.introduced}</td>
              <td data-label="Quoted" className="num">{row.quoted}</td>
              <td data-label="First quote (ms)" className="num">{row.firstQuoteMs === undefined ? '—' : Math.round(row.firstQuoteMs)}</td>
              <td data-label="Accepted">{row.accepted ? 'Yes' : 'No'}</td>
              <td data-label="Outcome">{outcome(row)}</td>
              <td data-label="Fields (read/granted)" className="num">{row.fieldsRead}/{row.fieldsGranted}</td>
              <td data-label="Receipts" className="num">{row.purposeReleases}</td>
            </tr>
            <tr className="funnel-search"><td colSpan={COLUMNS.length}><SearchLine row={row} /></td></tr>
          </tbody>)}
        </table>
        <p className="panel-note">The group is assigned when a request starts. A dash means no experiment was running for that request.
          {labelled ? 'Sample data, not actual merchants or users.' : 'The workspace returns counts and IDs only, without field values.'}
          Report generated <time dateTime={report.generatedAt}>{time(report.generatedAt)}</time>. </p>
      </>}
  </section>;
}
