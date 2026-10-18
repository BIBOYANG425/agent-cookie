import { armLabels, armNotes, compareArms, durationText, EXPERIMENT_ARMS, intervalText, MIN_ARM_N, percent, points,
  type ExperimentReport } from './experiments';
import type { Section } from './model';

const time = (at: string) => new Date(at).toLocaleString('en-US', { hour12: false });
const COLUMNS = ['Group', 'Requests (n)', 'Accepted', 'Acceptance rate', '95% interval (Wilson)', 'Median time to accept'] as const;

/** Insufficient data below the minimum n in either arm (and no difference is computed); otherwise the difference with its interval. */
function Comparison({ report }: { report: ExperimentReport }) {
  const comparison = compareArms(report);
  if (comparison.kind === 'insufficient') return <p className="experiment-verdict insufficient">
    <strong>Insufficient data</strong>: at least {MIN_ARM_N} requests per group are needed. Control has {comparison.control}; treatment has {comparison.treatment}. No difference or improvement is claimed.</p>;
  if (comparison.kind !== 'ready') return null;
  const [lo, hi] = comparison.interval;
  return <p className="experiment-verdict">Treatment − Control: <strong>{points(comparison.difference)} percentage points</strong>
     (95% interval {points(lo)} to {points(hi)} percentage points, Newcombe method using Wilson intervals).
    {lo > 0 ? 'The interval is above zero: treatment had a higher acceptance rate for these requests.'
      : hi < 0 ? 'The interval is below zero: treatment had a lower acceptance rate for these requests.'
      : 'The interval includes zero: the data does not establish a difference.'}</p>;
}

/** Counts only: per arm n, accepted, rate with the workspace's Wilson interval, median time to accept. */
export function ExperimentPanel({ state, sample }: { state?: Section<ExperimentReport>; sample: boolean }) {
  const report = state?.availability === 'ready' ? state.data : undefined;
  const labelled = sample || report?.sample === true || (state?.availability === 'ready' && state.sample === true);
  const off = !!report && report.arms.control.n === 0 && report.arms.treatment.n === 0;
  return <section id="experiments" className="panel" aria-labelledby="experiments-title">
    <div className="sheet-heading"><h2 id="experiments-title" tabIndex={-1}>Experiments</h2>
      <span>{labelled ? 'Sample · ranking experiment E1' : 'Ranking experiment E1 · counts only'}</span></div>
    {!state ? <p className="empty">Connect to view experiments.</p>
      : !report ? <p className="empty">{state.availability !== 'ready' && state.message}</p>
      : <>
        <p className="experiment-intro">Each request keeps the group assigned at creation. Treatment ranks merchants by previous acceptance and checkout-failure outcomes; control uses the default order. No improvement is claimed below {MIN_ARM_N} requests per group.</p>
        {off ? <p className="empty">No experiment data. Enable <code>AGENT_COOKIE_EXPERIMENT=ranking</code>,
          and install nonzero ranking weights to assign new requests to groups.</p>
          : <>
            <Comparison report={report} />
            <table className="experiment-table stack-table">
              <caption className="visually-hidden">Requests, acceptances, rates, 95% intervals and median time by experiment group</caption>
              <thead><tr>{COLUMNS.map((column) => <th scope="col" key={column}>{column}</th>)}</tr></thead>
              <tbody>{EXPERIMENT_ARMS.map((arm) => {
                const stats = report.arms[arm];
                return <tr key={arm}>
                  <th scope="row" data-label="Group"><span>{armLabels[arm]} ({arm})<span className="experiment-arm-note">{armNotes[arm]}</span></span></th>
                  <td data-label="Requests (n)" className="num">{stats.n}</td>
                  <td data-label="Accepted" className="num">{stats.accepted}</td>
                  <td data-label="Acceptance rate" className="num">{stats.n === 0 ? '—' : percent(stats.rate)}</td>
                  <td data-label="95% interval (Wilson)" className="num">{stats.n === 0 ? '—' : intervalText(stats.wilson95)}</td>
                  <td data-label="Median time to accept" className="num">{stats.medianAcceptMs === undefined ? '—' : durationText(stats.medianAcceptMs)}</td>
                </tr>;
              })}</tbody>
            </table>
          </>}
        <p className="panel-note">{sample ? 'Sample counts, not actual workspace, merchant or user results.'
          : `${labelled ? 'Sample data, not actual merchants or users. ' : ''}Counts, rates and intervals are calculated by the workspace from recorded groups. Field values are excluded.`}
          Median time runs from request creation to first acceptance. Report generated <time dateTime={report.generatedAt}>{time(report.generatedAt)}</time>. </p>
      </>}
  </section>;
}
