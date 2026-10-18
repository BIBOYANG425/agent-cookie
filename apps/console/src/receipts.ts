import { stageLabels } from './funnel';
import type { ActivityEvent } from './model';

// Display helpers for ReceiptPanel (the receipt type itself is packages/contract/src/types.ts `Receipt`) and the payment
// labels in the activity log.

/** The live adapter reads /personal/receipts without a query, so the workspace's default page applies: the newest 50. */
export const RECEIPT_LIMIT = 50;

const purposeLabels: Record<string, string> = { handshake: 'Introduction', checkout: 'Checkout address', payment: 'Payment authorization', tier0: 'Text-prefix delivery', history: 'History records' };
/**
 * handshake → Introduction (as in the grants panel), checkout → Checkout address, payment → Payment authorization, tier0 → Text-prefix delivery, a funnel stage
 * (quoted, accepted) → Stage · Quoted; else the raw purpose. The raw purpose always stays visible.
 */
export function purposeLabel(purpose: string): string {
  if (Object.hasOwn(purposeLabels, purpose)) return `${purposeLabels[purpose]} (${purpose})`;
  if (Object.hasOwn(stageLabels, purpose)) return `Stage · ${stageLabels[purpose as keyof typeof stageLabels]} (${purpose})`;
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
// An unknown authorize result is shown raw; an unknown reverse result is an error code (the reversal threw), so Reversal failed.
const paymentEvents: Record<string, { title: string; note: string; results: Record<string, string>; fallback?: string }> = {
  'payment.authorize': {
    title: 'Payment authorization',
    note: 'The workspace requests a payment hold for this amount. tap= records the payer signature; billto= names billing-address fields. none means absent. Field values are never shown.',
    results: { authorized: 'Permissions', reversed: 'Revoked', OVER_BUDGET: 'Over budget', used: 'Used', AUTHORIZATION_USED: 'Used',
      declined: 'Decline', SCOPE_DENIED: 'Decline', NOT_FOUND: 'Decline', JAR_LOCKED: 'Jar locked', UPSTREAM_ERROR: 'Payment provider error' },
  },
  'payment.reverse': {
    title: 'Reverse payment authorization',
    note: 'Releases an unused payment hold. Unless reversal is confirmed, the hold may remain until expiry.',
    results: { reversed: 'Revoked', not_reversed: 'Not reversed', not_supported: 'Reversal unsupported' },
    fallback: 'Reversal failed',
  },
};
export interface ActivityLabel { title: string; result: string; note?: string }
/** Chinese labels for the payment events, each with its raw event name and result kept beside it; other events as they are. */
export function activityLabel(event: ActivityEvent): ActivityLabel {
  const known = Object.hasOwn(paymentEvents, event.event) ? paymentEvents[event.event] : undefined;
  if (!known) return { title: event.event, result: event.result };
  const label = Object.hasOwn(known.results, event.result) ? known.results[event.result] : known.fallback;
  return { title: `${known.title} (${event.event})`, result: !label ? event.result : event.result ? `${label} (${event.result})` : label,
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
