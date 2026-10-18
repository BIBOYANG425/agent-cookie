import { t, dateLocale } from './i18n';
import { armLabels, armNotes, compareArms, durationText, EXPERIMENT_ARMS, intervalText, MIN_ARM_N, percent, points,
  type ExperimentReport } from './experiments';
import type { Section } from './model';

const time = (at: string) => new Date(at).toLocaleString(dateLocale(), { hour12: false });

/** 样本不足 below the minimum n in either arm (and no difference is computed); otherwise the difference with its interval. */
function Comparison({ report }: { report: ExperimentReport }) {
  const comparison = compareArms(report);
  if (comparison.kind === 'insufficient') return <p className="experiment-verdict insufficient">
    <strong>{t("insufficientSample")}</strong>{t("eachGroupNeedsAtLeast")}{MIN_ARM_N}{t("intentsForComparisonCurrentlyControl")}{comparison.control}{t("treatment")}{comparison.treatment}{t("theTableShowsEachGroupS")}</p>;
  if (comparison.kind !== 'ready') return null;
  const [lo, hi] = comparison.interval;
  return <p className="experiment-verdict">{t("treatmentControl")}<strong>{points(comparison.difference)}{t("percentagePoints")}</strong>
    {t("interval")}{points(lo)}{t("to")}{points(hi)}{t("percentagePointsNewcombeMethodCombiningThe")}{lo > 0 ? t("intervalAboveTreatmentAcceptanceWasHigher")
      : hi < 0 ? t("intervalBelowTreatmentAcceptanceWasLower")
      : t("intervalIncludesCurrentDataDoesNot")}</p>;
}

/** Counts only: per arm n, accepted, rate with the workspace's Wilson interval, median time to accept. */
export function ExperimentPanel({ state, sample }: { state?: Section<ExperimentReport>; sample: boolean }) {
  const COLUMNS = [t("group"), t("intentsN"), t("accepted"), t("acceptanceRate"), t("intervalWilson"), t("medianTimeToAccept")] as const;
  const report = state?.availability === 'ready' ? state.data : undefined;
  const labelled = sample || report?.sample === true || (state?.availability === 'ready' && state.sample === true);
  const off = !!report && report.arms.control.n === 0 && report.arms.treatment.n === 0;
  return <section id="experiments" className="panel" aria-labelledby="experiments-title">
    <div className="sheet-heading"><h2 id="experiments-title" tabIndex={-1}>{t("experiments")}</h2>
      <span>{labelled ? t("sampleRankingExperimentECountsOnly") : t("rankingExperimentECountsOnly")}</span></div>
    {!state ? <p className="empty">{t("connectToViewExperiments")}</p>
      : !report ? <p className="empty">{state.availability !== 'ready' && state.message}</p>
      : <>
        <p className="experiment-intro">{t("eachIntentIsAssignedOnceAt")}{MIN_ARM_N}{t("intentsPerGroupDocsCommerceAnalytics")}</p>
        {off ? <p className="empty">{t("experimentOffNeitherGroupHasIntents")}<code>AGENT_COOKIE_EXPERIMENT=ranking</code>{t("andTheInstalledPolicyHasNonzero")}</p>
          : <>
            <Comparison report={report} />
            <table className="experiment-table stack-table">
              <caption className="visually-hidden">{t("rankingExperimentIntentsAcceptedAcceptanceRate")}</caption>
              <thead><tr>{COLUMNS.map((column) => <th scope="col" key={column}>{column}</th>)}</tr></thead>
              <tbody>{EXPERIMENT_ARMS.map((arm) => {
                const stats = report.arms[arm];
                return <tr key={arm}>
                  <th scope="row" data-label={t("group")}><span>{armLabels[arm]}（{arm}）<span className="experiment-arm-note">{armNotes[arm]}</span></span></th>
                  <td data-label={t("intentsN")} className="num">{stats.n}</td>
                  <td data-label={t("accepted")} className="num">{stats.accepted}</td>
                  <td data-label={t("acceptanceRate")} className="num">{stats.n === 0 ? '—' : percent(stats.rate)}</td>
                  <td data-label={t("intervalWilson")} className="num">{stats.n === 0 ? '—' : intervalText(stats.wilson95)}</td>
                  <td data-label={t("medianTimeToAccept")} className="num">{stats.medianAcceptMs === undefined ? '—' : durationText(stats.medianAcceptMs)}</td>
                </tr>;
              })}</tbody>
            </table>
          </>}
        <p className="panel-note">{sample ? t("sampleDataAuthoredGroupCountsNot")
          : t("theWorkspaceRecalculatesFromTheGroup", labelled ? t("sampleDataNotRealMerchantsOr") : '')}
          {t("medianTimeToAcceptRunsFrom")}<time dateTime={report.generatedAt}>{time(report.generatedAt)}</time>。</p>
      </>}
  </section>;
}
