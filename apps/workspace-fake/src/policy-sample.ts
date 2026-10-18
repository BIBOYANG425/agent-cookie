// Sample funnel rows and a Sample release history for the B-local fake. Ids, field NAMES, counts and decision codes
// only; no value ever appears here. Nothing below is measured: every row is labelled Sample and `sample: true`.
import { evaluateRead, policyId, type Category, type Field, type FunnelRow, type PolicyDocument, type ShadowReport } from '@agent-cookie/contract';

const search = (offers: number, eligible: number, picked: number, dropped: { budget?: number; unavailable?: number } = {}) => ({
  offers, droppedAvoid: 0, droppedCurrency: 0, droppedUnavailable: dropped.unavailable ?? 0, droppedShipsTo: 0,
  droppedBudget: dropped.budget ?? 0, droppedInvalid: 0, eligible, eligibleSellers: eligible, picked,
});

/** Newest first, like the workspace's intent history. */
export const SAMPLE_FUNNEL_ROWS: readonly FunnelRow[] = Object.freeze([
  { intentId: 'sample-intent-3', createdAt: '2026-10-17T19:40:00.000Z', source: 'sample', introduced: 0, quoted: 0,
    accepted: false, fieldsGranted: 0, fieldsRead: 0, purposeReleases: 0, search: search(2, 0, 0, { budget: 1, unavailable: 1 }) },
  { intentId: 'sample-intent-2', createdAt: '2026-10-17T19:10:00.000Z', source: 'sample', introduced: 1, quoted: 1,
    firstQuoteMs: 2600, accepted: false, fieldsGranted: 6, fieldsRead: 1, purposeReleases: 0, search: search(2, 1, 1, { budget: 1 }) },
  { intentId: 'sample-intent-1', createdAt: '2026-10-17T18:05:00.000Z', source: 'sample', introduced: 2, quoted: 2,
    firstQuoteMs: 1200, accepted: true, outcome: 'handoff', fieldsGranted: 7, fieldsRead: 3, purposeReleases: 1, search: search(2, 2, 2) },
]);

export interface ReleaseRecord { ref: string; kind: 'receipt' | 'read'; category: Category; field: Field; purpose?: string }

/** A small fixed history of past Sample releases and reads that a candidate document is re-evaluated against. */
export const SAMPLE_RELEASE_HISTORY: readonly ReleaseRecord[] = Object.freeze([
  { ref: 'sample-read-1', kind: 'read', category: 'shoe', field: 'lang' },
  { ref: 'sample-read-1', kind: 'read', category: 'shoe', field: 'shoe_size' },
  { ref: 'sample-read-1', kind: 'read', category: 'shoe', field: 'budget' },
  { ref: 'sample-read-2', kind: 'read', category: 'shoe', field: 'deadline' },
  { ref: 'sample-read-3', kind: 'read', category: 'retail', field: 'shoe_size' },
  { ref: 'sample-read-3', kind: 'read', category: 'retail', field: 'pref.brand' },
  { ref: 'sample-read-3', kind: 'read', category: 'retail', field: 'pref.avoid' },
  { ref: 'sample-receipt-1', kind: 'receipt', category: 'shoe', field: 'shipping_address', purpose: 'checkout' },
  { ref: 'sample-receipt-2', kind: 'receipt', category: 'retail', field: 'shipping_address', purpose: 'checkout' },
]);

/** Same comparison as the workspace's shadow: one decision per (ref, field) under the current and candidate documents. */
export function shadowReport(current: PolicyDocument, candidate: PolicyDocument, history: readonly ReleaseRecord[]): ShadowReport {
  const report: ShadowReport = { candidateId: policyId(candidate), currentId: policyId(current), changed: [], unchanged: 0 };
  for (const { ref, kind, category, field, purpose } of history) {
    const before = evaluateRead(current, category, field, purpose);
    const after = evaluateRead(candidate, category, field, purpose);
    if (before === after) report.unchanged++;
    else report.changed.push({ ref, kind, field, before, after });
  }
  return report;
}
