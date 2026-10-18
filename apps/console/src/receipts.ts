import { stageLabels } from './funnel';
import type { ActivityEvent } from './model';

// Display helpers for ReceiptPanel (the receipt type itself is packages/contract/src/types.ts `Receipt`) and the payment
// labels in the activity log.

/** The live adapter reads /personal/receipts without a query, so the workspace's default page applies: the newest 50. */
export const RECEIPT_LIMIT = 50;

const purposeLabels: Record<string, string> = { handshake: '首次介绍', checkout: '结账地址', payment: '支付授权', tier0: '零接入前缀', history: '历史记录' };
/**
 * handshake → 首次介绍 (as in the grants panel), checkout → 结账地址, payment → 支付授权, tier0 → 零接入前缀, history → 历史记录
 * (GET /assistant/history; its receipts carry no fields), a funnel stage (quoted, accepted) → 阶段 · 报价; else the raw purpose.
 * The raw purpose always stays visible.
 */
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

/** Sample only: the authorize and reverse rows the workspace would log for sample-intent-3's accept (the store did not take the payment). */
export function samplePaymentEvents(now: number, nextId: () => string): ActivityEvent[] {
  return [
    { id: nextId(), at: new Date(now - 240000).toISOString(), event: 'payment.authorize', actor: 'Sample · workspace',
      object: 'sample-quote-3', result: 'authorized', reason: 'tap=none billto=shipping_address' },
    { id: nextId(), at: new Date(now - 238000).toISOString(), event: 'payment.reverse', actor: 'Sample · workspace',
      object: 'sample-quote-3', result: 'reversed', reason: '' },
  ];
}
