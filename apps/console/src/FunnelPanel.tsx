import type { Section } from './model';
import { armLabels } from './experiments';
import { conversionText, FUNNEL_LIMIT, funnelTotals, outcomeLabels, searchBuckets, sourceLabels, type FunnelReport, type FunnelRow } from './funnel';

const time = (at: string) => new Date(at).toLocaleString('zh-CN', { hour12: false });
const COLUMNS = ['时间', '分组', '介绍', '报价', '首个报价(ms)', '接受', '结果', '字段(读/授)', '回执'] as const;

function outcome(row: FunnelRow): string {
  if (row.outcome) return `${outcomeLabels[row.outcome]}（${row.outcome}）`;
  return row.accepted ? '尚无结果' : '—';
}

function SearchLine({ row }: { row: FunnelRow }) {
  const search = row.search;
  if (!search) return <span className="small muted">这个意图没有目录搜索的过滤记录。</span>;
  return <details className="funnel-search-detail">
    <summary>搜索过滤：候选 {search.offers} → 合格 {search.eligible} · 介绍 {search.picked}</summary>
    <p className="small">排除：{searchBuckets.map(([key, label]) => `${label} ${search[key]}`).join(' · ')}。
      合格商品来自 {search.eligibleSellers} 个卖家。</p>
  </details>;
}

/** Counts and ids only: the workspace sends no field value, and the adapter keeps only the contract's keys. */
export function FunnelPanel({ state, sample }: { state?: Section<FunnelReport>; sample: boolean }) {
  const report = state?.availability === 'ready' ? state.data : undefined;
  const labelled = sample || report?.sample === true || (state?.availability === 'ready' && state.sample === true);
  const totals = report ? funnelTotals(report.rows) : undefined;
  return <section id="funnel" className="panel" aria-labelledby="funnel-title">
    <div className="sheet-heading"><h2 id="funnel-title" tabIndex={-1}>漏斗</h2>
      <span>{labelled ? 'Sample · 每个意图一行 · 只含计数' : '每个意图一行 · 只含计数'}</span></div>
    {!state ? <p className="empty">连接后显示漏斗。</p>
      : !report || !totals ? <p className="empty">{state.availability !== 'ready' && state.message}</p>
      : report.rows.length === 0 ? <p className="empty">还没有意图。通过个人 agent 发起一次购物后，这里会按意图显示介绍、报价和结果的计数。</p>
      : <>
        <p className="funnel-totals"><strong>合计（按下方显示的 {totals.intents} 行计算）</strong>：介绍 {totals.introduced} ·
          报价 {totals.quoted} · 接受 {conversionText(totals)} · 字段 读 {totals.fieldsRead} / 授 {totals.fieldsGranted} ·
          回执 {totals.purposeReleases}</p>
        {report.rows.length >= FUNNEL_LIMIT && <p className="panel-note">只读取最近 {FUNNEL_LIMIT} 个意图，更早的不在表中，也不计入合计。</p>}
        <table className="funnel-table stack-table">
          <caption className="visually-hidden">每个意图的漏斗计数，最新在前</caption>
          <thead><tr>{COLUMNS.map((column) => <th scope="col" key={column}>{column}</th>)}</tr></thead>
          {report.rows.map((row) => <tbody key={row.intentId}>
            <tr>
              <th scope="row" data-label="时间"><span><time dateTime={row.createdAt}>{time(row.createdAt)}</time>
                <span className="funnel-intent"><code>{row.intentId}</code> · {sourceLabels[row.source]}</span></span></th>
              <td data-label="分组">{row.arm ? armLabels[row.arm] : '—'}</td>
              <td data-label="介绍" className="num">{row.introduced}</td>
              <td data-label="报价" className="num">{row.quoted}</td>
              <td data-label="首个报价(ms)" className="num">{row.firstQuoteMs === undefined ? '—' : Math.round(row.firstQuoteMs)}</td>
              <td data-label="接受">{row.accepted ? '是' : '否'}</td>
              <td data-label="结果">{outcome(row)}</td>
              <td data-label="字段(读/授)" className="num">{row.fieldsRead}/{row.fieldsGranted}</td>
              <td data-label="回执" className="num">{row.purposeReleases}</td>
            </tr>
            <tr className="funnel-search"><td colSpan={COLUMNS.length}><SearchLine row={row} /></td></tr>
          </tbody>)}
        </table>
        <p className="panel-note">分组是意图创建时分到的实验组（对照 / 处理，见实验面板）；— 表示创建时没有实验在运行，这个意图不属于任何一组。
          {labelled ? 'Sample 数据，不代表真实商家或用户。' : '工作台只返回计数和 ID，不含任何字段值。'}
          报告生成于 <time dateTime={report.generatedAt}>{time(report.generatedAt)}</time>。</p>
      </>}
  </section>;
}
