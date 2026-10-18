import { armLabels, armNotes, compareArms, durationText, EXPERIMENT_ARMS, intervalText, MIN_ARM_N, percent, points,
  type ExperimentReport } from './experiments';
import type { Section } from './model';

const time = (at: string) => new Date(at).toLocaleString('zh-CN', { hour12: false });
const COLUMNS = ['分组', '意图数（n）', '接受', '接受率', '95% 区间（Wilson）', '中位接受时长'] as const;

/** 样本不足 below the minimum n in either arm (and no difference is computed); otherwise the difference with its interval. */
function Comparison({ report }: { report: ExperimentReport }) {
  const comparison = compareArms(report);
  if (comparison.kind === 'insufficient') return <p className="experiment-verdict insufficient">
    <strong>样本不足</strong>：每组至少需要 {MIN_ARM_N} 个意图才比较两组，现在对照 {comparison.control} 个、处理 {comparison.treatment} 个。下表只列各组自己的数字，不计算两组之差，也不说明哪一组更好。</p>;
  if (comparison.kind !== 'ready') return null;
  const [lo, hi] = comparison.interval;
  return <p className="experiment-verdict">处理 − 对照：<strong>{points(comparison.difference)} 个百分点</strong>
    （95% 区间 {points(lo)} 至 {points(hi)} 个百分点，Newcombe 方法，由两组的 Wilson 区间合成）。
    {lo > 0 ? '区间在 0 以上：在这些意图上，处理组的接受率高于对照组。'
      : hi < 0 ? '区间在 0 以下：在这些意图上，处理组的接受率低于对照组。'
      : '区间包含 0：现有数据不能说明两组的接受率不同。'}</p>;
}

/** Counts only: per arm n, accepted, rate with the workspace's Wilson interval, median time to accept. */
export function ExperimentPanel({ state, sample }: { state?: Section<ExperimentReport>; sample: boolean }) {
  const report = state?.availability === 'ready' ? state.data : undefined;
  const labelled = sample || report?.sample === true || (state?.availability === 'ready' && state.sample === true);
  const off = !!report && report.arms.control.n === 0 && report.arms.treatment.n === 0;
  return <section id="experiments" className="panel" aria-labelledby="experiments-title">
    <div className="sheet-heading"><h2 id="experiments-title" tabIndex={-1}>实验</h2>
      <span>{labelled ? 'Sample · 排序实验 E1 · 只含计数' : '排序实验 E1 · 只含计数'}</span></div>
    {!state ? <p className="empty">连接后显示实验。</p>
      : !report ? <p className="empty">{state.availability !== 'ready' && state.message}</p>
      : <>
        <p className="experiment-intro">每个意图在创建时按密钥哈希分到一组，之后不再改变。处理组按卖家在你过往意图中的结果记录（报价被接受、结账失败的比例）排序要介绍的商家；对照组保持今天的顺序。每组少于 {MIN_ARM_N} 个意图时，不声称任何提升（docs/commerce-analytics-plan.md §6）。</p>
        {off ? <p className="empty">实验未开启：两组都还没有意图。工作台设置 <code>AGENT_COOKIE_EXPERIMENT=ranking</code>，
          且已安装的策略带非零排序权重（ranking）时，新意图才会分到对照组或处理组。</p>
          : <>
            <Comparison report={report} />
            <table className="experiment-table stack-table">
              <caption className="visually-hidden">排序实验每组的意图数、接受数、接受率及其 95% 区间、中位接受时长</caption>
              <thead><tr>{COLUMNS.map((column) => <th scope="col" key={column}>{column}</th>)}</tr></thead>
              <tbody>{EXPERIMENT_ARMS.map((arm) => {
                const stats = report.arms[arm];
                return <tr key={arm}>
                  <th scope="row" data-label="分组"><span>{armLabels[arm]}（{arm}）<span className="experiment-arm-note">{armNotes[arm]}</span></span></th>
                  <td data-label="意图数（n）" className="num">{stats.n}</td>
                  <td data-label="接受" className="num">{stats.accepted}</td>
                  <td data-label="接受率" className="num">{stats.n === 0 ? '—' : percent(stats.rate)}</td>
                  <td data-label="95% 区间（Wilson）" className="num">{stats.n === 0 ? '—' : intervalText(stats.wilson95)}</td>
                  <td data-label="中位接受时长" className="num">{stats.medianAcceptMs === undefined ? '—' : durationText(stats.medianAcceptMs)}</td>
                </tr>;
              })}</tbody>
            </table>
          </>}
        <p className="panel-note">{sample ? 'Sample 数据：编写的分组计数，不来自工作台或任何商家，也不代表真实用户。'
          : `${labelled ? 'Sample 数据，不代表真实商家或用户。' : ''}工作台按意图上保存的分组重新计算，只含计数，不含任何字段值；接受率与区间由工作台计算。`}
          中位接受时长是从意图创建到第一次接受。报告生成于 <time dateTime={report.generatedAt}>{time(report.generatedAt)}</time>。</p>
      </>}
  </section>;
}
