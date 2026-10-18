import { t, dateLocale } from './i18n';
import type { Receipt } from '../../../packages/contract/src/types';
import { FieldName } from './fields';
import { formatCents, purposeLabel, RECEIPT_LIMIT, shortId } from './receipts';
import './panels.css';

const formatTime = (at: string) => new Date(at).toLocaleString(dateLocale(), { hour12: false });

/** A receipt names released fields; it does not contain or reconstruct their values. amount is integer cents, shown in dollars. */
export function ReceiptPanel({ receipts, sample = false }: { receipts?: readonly Receipt[] | null; sample?: boolean }) {
  const rows = receipts && [...receipts].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return <section id="receipts" className="panel" aria-labelledby="receipts-title">
    <div className="sheet-heading"><h2 id="receipts-title">{t("accessReceipts")}</h2><span>{sample ? 'Sample · ' : ''}{t("whoReadWhichFieldsAndFor")}</span></div>
    {receipts === undefined ? <p className="empty">{t("receiptsAppearAfterLoading")}</p>
      : receipts === null ? <p className="empty" role="status">{t("temporarilyUnavailableOtherViewsRemainUsable")}</p>
        : !rows || rows.length === 0 ? <p className="empty">{t("noAccessReceiptsYetTheWorkspace")}</p>
          : <>
            <ol className="receipt-list">{rows.map(receipt => <li className="receipt-record" key={receipt.id}>
              <div className="receipt-heading"><h3>{receipt.agentId}</h3><time dateTime={receipt.createdAt}>{formatTime(receipt.createdAt)}</time></div>
              <dl><div><dt>{t("fieldsRead193")}</dt><dd>{receipt.fields.length > 0 ? <ul className="grant-fields">{receipt.fields.map(field => <li key={field}><FieldName field={field} /></li>)}</ul> : t("noFields")}</dd></div>
                <div><dt>{t("purpose")}</dt><dd>{purposeLabel(receipt.purpose)}</dd></div>
                {receipt.amount !== undefined && <div><dt>{t("authorizedAmount")}</dt><dd>{formatCents(receipt.amount)}</dd></div>}
                <div><dt>{t("intent")}</dt><dd>{receipt.intentId ? <code title={receipt.intentId}>{shortId(receipt.intentId)}</code> : t("notRecorded")}</dd></div>
                <div><dt>{t("session")}</dt><dd>{receipt.sessionId}</dd></div>
                <div><dt>{t("receiptId")}</dt><dd>{receipt.id}</dd></div>
              </dl>
            </li>)}</ol>
            {rows.length >= RECEIPT_LIMIT && <p className="panel-note">{t("onlyTheLatest")}{RECEIPT_LIMIT}{t("receiptsAreReadOlderReceiptsAre")}</p>}
            <p className="panel-note">{sample ? t("sampleDataNotRealMerchantsOr") : t("receiptsRecordOnlyMerchantFieldNames")}
              {rows.some(receipt => receipt.amount !== undefined) && t("paymentAuthorizationAmountsAreDisplayedIn")}</p>
          </>}
  </section>;
}
