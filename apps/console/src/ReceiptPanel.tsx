import type { Receipt } from '../../../packages/contract/src/types';
import { FieldName } from './fields';
import { formatCents, purposeLabel, RECEIPT_LIMIT, shortId } from './receipts';
import './panels.css';

const formatTime = (at: string) => new Date(at).toLocaleString('en-US', { hour12: false });

function ReceiptRecord({ receipt }: { receipt: Receipt }) {
  return <li className="receipt-record">
    <div className="receipt-heading"><h3>{receipt.agentId}</h3><time dateTime={receipt.createdAt}>{formatTime(receipt.createdAt)}</time></div>
    <dl><div><dt>Released fields</dt><dd>{receipt.fields.length > 0 ? <ul className="grant-fields">{receipt.fields.map(field => <li key={field}><FieldName field={field} /></li>)}</ul> : 'No fields'}</dd></div>
      <div><dt>Purpose</dt><dd>{purposeLabel(receipt.purpose)}</dd></div>
      {receipt.amount !== undefined && <div><dt>Authorized amount</dt><dd>{formatCents(receipt.amount)}</dd></div>}
      <div><dt>Request</dt><dd>{receipt.intentId ? <code title={receipt.intentId}>{shortId(receipt.intentId)}</code> : 'Not recorded'}</dd></div>
      <div><dt>Session</dt><dd>{receipt.sessionId}</dd></div>
      <div><dt>Receipt ID</dt><dd>{receipt.id}</dd></div>
    </dl>
  </li>;
}

/** Receipts identify released fields, never their values. Amounts are integer cents. */
export function ReceiptPanel({ receipts, sample = false }: { receipts?: readonly Receipt[] | null; sample?: boolean }) {
  const rows = receipts && [...receipts].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return <section id="receipts" className="panel" aria-labelledby="receipts-title">
    <div className="sheet-heading"><h2 id="receipts-title">Access receipts</h2><span>{sample ? 'Sample · ' : ''}Who received which fields, and why</span></div>
    {receipts === undefined ? <p className="empty">Connect to view access receipts.</p>
      : receipts === null ? <p className="empty" role="status">Temporarily unavailable. Other sections remain accessible.</p>
        : !rows?.length ? <p className="empty">No receipts yet. Released fields will be recorded here.</p>
          : <>
            <ol className="receipt-list">{rows.slice(0, 3).map(receipt => <ReceiptRecord receipt={receipt} key={receipt.id} />)}</ol>
            {rows.length > 3 && <details className="records-history"><summary>Earlier receipts ({rows.length - 3})</summary>
              <ol className="receipt-list">{rows.slice(3).map(receipt => <ReceiptRecord receipt={receipt} key={receipt.id} />)}</ol>
            </details>}
            {rows.length >= RECEIPT_LIMIT && <p className="panel-note">Showing the latest {RECEIPT_LIMIT} receipts. Earlier records are not included.</p>}
            <p className="panel-note">{sample ? 'Sample data, not actual merchants or users.' : 'Receipts contain recipients, field names, purposes and amounts, never field values.'}
              {rows.some(receipt => receipt.amount !== undefined) && ' Amounts are shown in USD and stored as cents.'}</p>
          </>}
  </section>;
}
