import type { Receipt } from '../../../packages/contract/src/types';
import { FieldName } from './fields';
import { formatCents, purposeLabel, RECEIPT_LIMIT, shortId } from './receipts';
import './panels.css';

const formatTime = (at: string) => new Date(at).toLocaleString('zh-CN', { hour12: false });

/** A receipt names released fields; it does not contain or reconstruct their values. amount is integer cents, shown in dollars. */
export function ReceiptPanel({ receipts, sample = false }: { receipts?: readonly Receipt[] | null; sample?: boolean }) {
  const rows = receipts && [...receipts].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return <section id="receipts" className="panel" aria-labelledby="receipts-title">
    <div className="sheet-heading"><h2 id="receipts-title">读取回执</h2><span>{sample ? 'Sample · ' : ''}谁因为什么用途读取了哪些字段</span></div>
    {receipts === undefined ? <p className="empty">读取后显示回执。</p>
      : receipts === null ? <p className="empty" role="status">暂时无法读取，其他视图可继续使用。</p>
        : !rows || rows.length === 0 ? <p className="empty">还没有读取回执。工作台放行字段后，会在这里留下记录。</p>
          : <>
            <ol className="receipt-list">{rows.map(receipt => <li className="receipt-record" key={receipt.id}>
              <div className="receipt-heading"><h3>{receipt.agentId}</h3><time dateTime={receipt.createdAt}>{formatTime(receipt.createdAt)}</time></div>
              <dl><div><dt>读取字段</dt><dd>{receipt.fields.length > 0 ? <ul className="grant-fields">{receipt.fields.map(field => <li key={field}><FieldName field={field} /></li>)}</ul> : '无字段'}</dd></div>
                <div><dt>用途</dt><dd>{purposeLabel(receipt.purpose)}</dd></div>
                {receipt.amount !== undefined && <div><dt>授权金额</dt><dd>{formatCents(receipt.amount)}</dd></div>}
                <div><dt>意图</dt><dd>{receipt.intentId ? <code title={receipt.intentId}>{shortId(receipt.intentId)}</code> : '未记录'}</dd></div>
                <div><dt>会话</dt><dd>{receipt.sessionId}</dd></div>
                <div><dt>回执 ID</dt><dd>{receipt.id}</dd></div>
              </dl>
            </li>)}</ol>
            {rows.length >= RECEIPT_LIMIT && <p className="panel-note">只读取最近 {RECEIPT_LIMIT} 条回执，更早的不在列表中。</p>}
            <p className="panel-note">{sample ? 'Sample 数据，不代表真实商家或用户。' : '回执只记商家、字段名、用途和金额，不含字段值。'}
              {rows.some(receipt => receipt.amount !== undefined) && '支付授权的金额按美元显示（工作台以美分记录）。'}</p>
          </>}
  </section>;
}
