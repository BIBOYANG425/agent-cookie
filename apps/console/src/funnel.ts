import { t, type MessageKey } from './i18n';
import type { FunnelReport, FunnelRow, FunnelStage, SearchStats } from '../../../packages/contract/src/analytics';
import type { AcceptResult, DataSource } from '../../../packages/contract/src/types';
import { isExperimentArm, type ExperimentArm } from './experiments';

export type { FunnelReport, FunnelRow, SearchStats };

/** Each poll asks for the newest 50 intents only; the panel says so when the page is full. */
export const FUNNEL_LIMIT = 50;

export const outcomeLabels: Record<AcceptResult['status'], string> = {
  get ordered() { return t("ordered"); }, get handoff() { return t("handOffToMerchant"); }, get blocked() { return t("blocked"); }, get failed() { return t("failed"); },
};
export const stageLabels: Record<FunnelStage, string> = {
  get introduced() { return t("introduced"); }, get quoted() { return t("quoted"); }, get accepted() { return t("accepted"); }, get checkout() { return t("checkout"); }, get payment() { return t("payment"); }, get completed() { return t("completed276"); },
};
export const sourceLabels: Record<DataSource, string> = { sample: 'Sample', get fixture() { return t("recordedReplay"); }, get live() { return t("live"); } };
/** Filter buckets in the order the workspace checks them (contract SearchStats). */
export const searchBuckets: ReadonlyArray<[keyof SearchStats, MessageKey]> = [
  ['droppedAvoid', "avoidPrefAvoid"], ['droppedCurrency', "nonUsd"], ['droppedUnavailable', "unavailable"],
  ['droppedShipsTo', "doesNotShipToDestinationCountry"], ['droppedBudget', "overThisRequestSBudget"], ['droppedInvalid', "invalidPriceOrSellerDetails"],
];
const SEARCH_KEYS: ReadonlyArray<keyof SearchStats> = ['offers', 'droppedAvoid', 'droppedCurrency', 'droppedUnavailable',
  'droppedShipsTo', 'droppedBudget', 'droppedInvalid', 'eligible', 'eligibleSellers', 'picked'];

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256;
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const count = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const malformed = () => new Error(t("funnelResponseDoesNotMatchThe"));

/** Copies only the contract's count and id keys, so nothing else a response carries can reach the page. */
export function normalizeFunnelReport(body: unknown): FunnelReport {
  if (!object(body) || !Array.isArray(body.rows) || typeof body.sample !== 'boolean' || !date(body.generatedAt)) throw malformed();
  const rows = body.rows.map((row): FunnelRow => {
    if (!object(row) || !text(row.intentId) || !date(row.createdAt) || !['sample', 'fixture', 'live'].includes(String(row.source))
      || !['introduced', 'quoted', 'fieldsGranted', 'fieldsRead', 'purposeReleases'].every((key) => count(row[key]))
      || typeof row.accepted !== 'boolean'
      || (row.firstQuoteMs !== undefined && !(typeof row.firstQuoteMs === 'number' && Number.isFinite(row.firstQuoteMs) && row.firstQuoteMs >= 0))
      || (row.outcome !== undefined && !Object.hasOwn(outcomeLabels, String(row.outcome)))
      || (row.search !== undefined && !(object(row.search) && SEARCH_KEYS.every((key) => count((row.search as Record<string, unknown>)[key]))))
      || (row.arm !== undefined && !isExperimentArm(row.arm))) {
      throw malformed();
    }
    const search = row.search as Record<string, number> | undefined;
    return { intentId: row.intentId, createdAt: row.createdAt, source: row.source as DataSource,
      introduced: row.introduced as number, quoted: row.quoted as number,
      ...(row.firstQuoteMs !== undefined ? { firstQuoteMs: row.firstQuoteMs as number } : {}),
      accepted: row.accepted, ...(row.outcome !== undefined ? { outcome: row.outcome as AcceptResult['status'] } : {}),
      fieldsGranted: row.fieldsGranted as number, fieldsRead: row.fieldsRead as number, purposeReleases: row.purposeReleases as number,
      ...(search ? { search: Object.fromEntries(SEARCH_KEYS.map((key) => [key, search[key]])) as unknown as SearchStats } : {}),
      ...(row.arm !== undefined ? { arm: row.arm as ExperimentArm } : {}) };
  });
  return { rows, sample: body.sample, generatedAt: body.generatedAt };
}

export interface FunnelTotals {
  intents: number; introduced: number; quoted: number; accepted: number;
  fieldsRead: number; fieldsGranted: number; purposeReleases: number;
}
/** Sums over the rows on the page only (not all history). Conversion is accepted / intents of those rows. */
export function funnelTotals(rows: readonly FunnelRow[]): FunnelTotals {
  const sum = (key: 'introduced' | 'quoted' | 'fieldsRead' | 'fieldsGranted' | 'purposeReleases') => rows.reduce((total, row) => total + row[key], 0);
  return { intents: rows.length, introduced: sum('introduced'), quoted: sum('quoted'), accepted: rows.filter((row) => row.accepted).length,
    fieldsRead: sum('fieldsRead'), fieldsGranted: sum('fieldsGranted'), purposeReleases: sum('purposeReleases') };
}

export function conversionText(totals: FunnelTotals): string {
  if (totals.intents === 0) return '—';
  return `${totals.accepted}/${totals.intents}（${Math.round((totals.accepted / totals.intents) * 100)}%）`;
}

/**
 * Sample only: authored rows, labelled Sample; not measured from any merchant. Bucket counts add up to `offers`. The arms
 * match sampleExperimentReport (src/experiments.ts).
 */
export function sampleFunnelReport(now: number): FunnelReport {
  const minutesAgo = (minutes: number) => new Date(now - minutes * 60000).toISOString();
  return { sample: true, generatedAt: new Date(now).toISOString(), rows: [
    { intentId: 'sample-intent-3', createdAt: minutesAgo(5), source: 'sample', introduced: 3, quoted: 2, firstQuoteMs: 1840,
      accepted: true, outcome: 'ordered', fieldsGranted: 6, fieldsRead: 4, purposeReleases: 2,
      search: { offers: 12, droppedAvoid: 2, droppedCurrency: 1, droppedUnavailable: 1, droppedShipsTo: 2, droppedBudget: 1,
        droppedInvalid: 0, eligible: 5, eligibleSellers: 4, picked: 3 }, arm: 'treatment' },
    { intentId: 'sample-intent-2', createdAt: minutesAgo(40), source: 'sample', introduced: 3, quoted: 1, firstQuoteMs: 2650,
      accepted: true, outcome: 'handoff', fieldsGranted: 6, fieldsRead: 3, purposeReleases: 1,
      search: { offers: 8, droppedAvoid: 0, droppedCurrency: 0, droppedUnavailable: 2, droppedShipsTo: 1, droppedBudget: 2,
        droppedInvalid: 0, eligible: 3, eligibleSellers: 3, picked: 3 }, arm: 'control' },
    { intentId: 'sample-intent-1', createdAt: minutesAgo(120), source: 'sample', introduced: 2, quoted: 0, accepted: false,
      fieldsGranted: 6, fieldsRead: 0, purposeReleases: 0, arm: 'control' },
  ] };
}
