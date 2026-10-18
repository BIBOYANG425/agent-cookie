import { FieldName } from './fields';
import type { Section } from './model';
import { formatCents, purposeLabel, RECEIPT_LIMIT, shortId, type ReceiptsView } from './receipts';

const time = (at: string) => new Date(at).toLocaleString('zh-CN', { hour12: false });
const COLUMNS = ['时间', '用途', '商家', '字段', '金额', '意图'] as const;

/** One row per release: who, which field names, for which purpose, and the amount of a payment. Never a field value. */
export function ReceiptsPanel({ state, sample }: { state?: Section<ReceiptsView>; sample: boolean }) {
  const view = state?.availability === 'ready' ? state.data : undefined;
  const labelled = sample || view?.sample === true || (state?.availability === 'ready' && state.sample === true);
  return <section id="receipts" className="panel" aria-labelledby="receipts-title">
    <div className="sheet-heading"><h2 id="receipts-title" tabIndex={-1}>回执</h2>
      <span>{labelled ? 'Sample · 每次放行一条 · 只记字段名' : '每次放行一条 · 只记字段名'}</span></div>
    {!state ? <p className="empty">连接后显示回执。</p>
      : !view ? <p className="empty">{state.availability !== 'ready' && state.message}</p>
      : view.receipts.length === 0 ? <p className="empty">还没有回执。商家按用途读取字段（例如结账地址）、零接入前缀投递，或工作台代你做支付授权时，这里会各记一条。</p>
      : <>
        <table className="receipt-table stack-table">
          <caption className="visually-hidden">回执，最新在前：时间、用途、商家、字段名、金额、意图</caption>
          <thead><tr>{COLUMNS.map((column) => <th scope="col" key={column}>{column}</th>)}</tr></thead>
          <tbody>{view.receipts.map((receipt) => <tr key={receipt.id}>
            <th scope="row" data-label="时间"><time dateTime={receipt.createdAt}>{time(receipt.createdAt)}</time></th>
            <td data-label="用途">{purposeLabel(receipt.purpose)}</td>
            <td data-label="商家"><code>{receipt.agentId}</code></td>
            <td data-label="字段">{receipt.fields.length === 0 ? '无'
              : <ul className="receipt-fields">{receipt.fields.map((field) => <li key={field}><FieldName field={field} /></li>)}</ul>}</td>
            <td data-label="金额" className="num">{receipt.amount === undefined ? '—' : formatCents(receipt.amount)}</td>
            <td data-label="意图">{receipt.intentId ? <code title={receipt.intentId}>{shortId(receipt.intentId)}</code> : '未记录'}</td>
          </tr>)}</tbody>
        </table>
        {view.receipts.length >= RECEIPT_LIMIT && <p className="panel-note">只读取最近 {RECEIPT_LIMIT} 条回执，更早的不在表中。</p>}
        <p className="panel-note">{labelled ? 'Sample 数据，不代表真实商家或用户。' : '回执只记商家、字段名、用途和金额，不含字段值。'}
          支付授权的金额按美元显示（工作台以美分记录）。</p>
      </>}
  </section>;
}
