import type { Field } from '../../../packages/contract/src/types';
import { stageLabels } from './funnel';
import type { ActivityEvent } from './model';

// Mirror of packages/contract/src/types.ts `Receipt`, with the additive `amount` (integer cents, lane D's payment
// authorization), `intentId` and `policyId`. test/experiments.test.ts checks at compile time that it stays identical.
export interface Receipt {
  id: string;
  sessionId: string;
  agentId: string;
  fields: Field[];
  purpose: string;
  amount?: number;
  createdAt: string;
  intentId?: string;
  policyId?: string;
}
/** GET /personal/receipts → { receipts }. Field names, purpose and amount only; a receipt never carries a field value. */
export interface ReceiptsView { receipts: Receipt[]; sample?: boolean }

/** The bridge allows the endpoint without a query, so the workspace's default page applies: the newest 50. */
export const RECEIPT_LIMIT = 50;

const purposeLabels: Record<string, string> = { checkout: '结账地址', payment: '支付授权', tier0: '零接入前缀' };
/** checkout → 结账地址, payment → 支付授权, tier0 → 零接入前缀, a funnel stage (quoted, accepted) → 阶段 · 报价; else the raw purpose. */
export function purposeLabel(purpose: string): string {
  if (Object.hasOwn(purposeLabels, purpose)) return `${purposeLabels[purpose]}（${purpose}）`;
  if (Object.hasOwn(stageLabels, purpose)) return `阶段 · ${stageLabels[purpose as keyof typeof stageLabels]}（${purpose}）`;
  return purpose;
}

/** Integer cents → "$1,234.56". Payments are USD only (contract PaymentAuthorization.currency). */
export function formatCents(cents: number): string {
  const dollars = Math.floor(cents / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
  return `$${dollars}.${String(cents % 100).padStart(2, '0')}`;
}

/**
 * Display form of an intent id. The workspace's own ids (`i_` + 8 characters) stay whole; a longer id shows an ellipsis and
 * its last eight characters, which tell ids apart better than a shared prefix does. The full id goes in the title.
 */
export function shortId(id: string): string {
  return id.length > 12 ? `…${id.slice(-8)}` : id;
}

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256;
const name = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const malformed = () => new Error('回执响应格式与契约不一致。');

/** Copies only the contract's receipt keys, so nothing else a response carries can reach the page. */
export function normalizeReceipts(body: unknown): ReceiptsView {
  if (!object(body) || !Array.isArray(body.receipts)) throw malformed();
  const receipts = body.receipts.map((row): Receipt => {
    if (!object(row) || !text(row.id) || !text(row.sessionId) || !text(row.agentId) || !text(row.purpose) || !date(row.createdAt)
      || !Array.isArray(row.fields) || !row.fields.every(name)
      || (row.amount !== undefined && !(Number.isSafeInteger(row.amount) && (row.amount as number) >= 0))
      || (row.intentId !== undefined && !text(row.intentId)) || (row.policyId !== undefined && !text(row.policyId))) throw malformed();
    return { id: row.id, sessionId: row.sessionId, agentId: row.agentId, fields: [...row.fields] as Field[], purpose: row.purpose,
      ...(row.amount !== undefined ? { amount: row.amount as number } : {}), createdAt: row.createdAt,
      ...(row.intentId !== undefined ? { intentId: row.intentId } : {}), ...(row.policyId !== undefined ? { policyId: row.policyId } : {}) };
  });
  return { receipts, ...(body.sample === true ? { sample: true } : {}) };
}

// ---- payment events in the activity log (apps/workspace commerce.ts) ----
// payment.authorize: result = the authorization status or the error code; reason = `tap=<signature> billto=<field name|none>`.
// payment.reverse: result = the reversal outcome (reversed, not_reversed, not_supported) or an error code.
// An unknown authorize result is shown raw; an unknown reverse result is an error code (the reversal threw), so 撤销失败.
const paymentEvents: Record<string, { title: string; note: string; results: Record<string, string>; fallback?: string }> = {
  'payment.authorize': {
    title: '支付授权',
    note: '工作台代你向支付提供方申请这笔金额的预授权。tap= 是付款方签名（none 表示没有签名），billto= 是作为账单地址交给支付提供方的字段名（none 表示没有交），都不含字段值。',
    results: { authorized: '授权', reversed: '已撤销', OVER_BUDGET: '超预算', used: '已使用', AUTHORIZATION_USED: '已使用',
      declined: '拒绝', SCOPE_DENIED: '拒绝', NOT_FOUND: '拒绝', JAR_LOCKED: 'jar 已锁定', UPSTREAM_ERROR: '支付提供方出错' },
  },
  'payment.reverse': {
    title: '撤销支付授权',
    note: '释放商家没有使用的预授权。结果不是“已撤销”时，预授权可能保留在卡上，直到过期。',
    results: { reversed: '已撤销', not_reversed: '未撤销', not_supported: '不支持撤销' },
    fallback: '撤销失败',
  },
};
export interface ActivityLabel { title: string; result: string; note?: string }
/** Chinese labels for the payment events, each with its raw event name and result kept beside it; other events as they are. */
export function activityLabel(event: ActivityEvent): ActivityLabel {
  const known = Object.hasOwn(paymentEvents, event.event) ? paymentEvents[event.event] : undefined;
  if (!known) return { title: event.event, result: event.result };
  const label = Object.hasOwn(known.results, event.result) ? known.results[event.result] : known.fallback;
  return { title: `${known.title}（${event.event}）`, result: !label ? event.result : event.result ? `${label}（${event.result}）` : label,
    note: known.note };
}

/**
 * Sample only: authored receipts, labelled Sample, consistent with the Sample funnel's purposeReleases (two for
 * sample-intent-3, one for sample-intent-2) and the Sample grants' agents and sessions. Field names only.
 */
export function sampleReceipts(now: number): ReceiptsView {
  const secondsAgo = (seconds: number) => new Date(now - seconds * 1000).toISOString();
  return { sample: true, receipts: [
    { id: 'sample-receipt-3', sessionId: 'sample-session-a', agentId: 'sample-store-a', fields: ['payment_method'], purpose: 'payment',
      amount: 8999, createdAt: secondsAgo(240), intentId: 'sample-intent-3', policyId: 'sample-policy' },
    { id: 'sample-receipt-2', sessionId: 'sample-session-a', agentId: 'sample-store-a', fields: ['shipping_address'], purpose: 'checkout',
      createdAt: secondsAgo(250), intentId: 'sample-intent-3', policyId: 'sample-policy' },
    { id: 'sample-receipt-1', sessionId: 'sample-session-b', agentId: 'sample-store-b', fields: ['lang', 'shoe_size'], purpose: 'tier0',
      createdAt: secondsAgo(2400), intentId: 'sample-intent-2', policyId: 'sample-policy' },
  ] };
}

/** Sample only: the authorize and reverse rows the workspace would log for sample-intent-3's accept (the store did not take the payment). */
export function samplePaymentEvents(now: number, nextId: () => string): ActivityEvent[] {
  return [
    { id: nextId(), at: new Date(now - 240000).toISOString(), event: 'payment.authorize', actor: 'Sample · workspace',
      object: 'sample-quote-3', result: 'authorized', reason: 'tap=none billto=shipping_address' },
    { id: nextId(), at: new Date(now - 238000).toISOString(), event: 'payment.reverse', actor: 'Sample · workspace',
      object: 'sample-quote-3', result: 'reversed', reason: '' },
  ];
}
