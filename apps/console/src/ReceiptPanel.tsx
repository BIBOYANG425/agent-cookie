import type { Receipt } from '../../../packages/contract/src/types';
import { FieldName } from './fields';
import './panels.css';

const formatTime = (at: string) => new Date(at).toLocaleString('zh-CN', { hour12: false });

/** A receipt names released fields; it does not contain or reconstruct their values. */
export function ReceiptPanel({ receipts }: { receipts?: readonly Receipt[] | null }) {
  const rows = receipts && [...receipts].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return <section id="receipts" className="panel" aria-labelledby="receipts-title">
    <div className="sheet-heading"><h2 id="receipts-title">读取回执</h2><span>谁因为什么用途读取了哪些字段</span></div>
    {receipts === undefined ? <p className="empty">读取后显示回执。</p>
      : receipts === null ? <p className="empty" role="status">暂时无法读取，其他视图可继续使用。</p>
        : rows?.length === 0 ? <p className="empty">还没有读取回执。工作台放行字段后，会在这里留下记录。</p>
          : <ol className="receipt-list">{rows?.map(receipt => <li className="receipt-record" key={receipt.id}>
            <div className="receipt-heading"><h3>{receipt.agentId}</h3><time dateTime={receipt.createdAt}>{formatTime(receipt.createdAt)}</time></div>
            <dl><div><dt>读取字段</dt><dd>{receipt.fields.length > 0 ? <ul className="grant-fields">{receipt.fields.map(field => <li key={field}><FieldName field={field} /></li>)}</ul> : '无字段'}</dd></div>
              <div><dt>用途</dt><dd>{receipt.purpose}</dd></div>
              <div><dt>会话</dt><dd>{receipt.sessionId}</dd></div>
              <div><dt>回执 ID</dt><dd>{receipt.id}</dd></div>
              {receipt.amount !== undefined && <div><dt>授权金额</dt><dd>{receipt.amount}</dd></div>}
            </dl>
          </li>)}</ol>}
  </section>;
}
