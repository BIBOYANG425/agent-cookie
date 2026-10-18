// Funnel report — docs/commerce-analytics-plan.md Phase 0. Joins what the workspace already records (intents,
// intent_sessions, quotes, grants, receipts, activity) into one row per intent. Counts and ids only: a field VALUE
// never enters this file. The owner (the user) is the only reader; a merchant never sees another merchant's rows.
import type { Field, FunnelReport, FunnelRow } from "@agent-cookie/contract";
import type { IntentRow } from "../db.js";
import type { Ctx } from "./context.js";

/** Median of a list of milliseconds (mean of the two middle values, rounded, for an even count); undefined when empty. */
export function median(xs: readonly number[]): number | undefined {
  if (xs.length === 0) return undefined;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** Milliseconds from `from` to `to` (ISO times), never negative (the test clock can move backwards); undefined if unparsable. */
export function elapsedMs(from: string, to: string): number | undefined {
  const a = Date.parse(from);
  const b = Date.parse(to);
  return Number.isNaN(a) || Number.isNaN(b) ? undefined : Math.max(0, b - a);
}

export class FunnelService {
  constructor(private ctx: Ctx) {}

  report(userId: string, opts: { limit?: number; since?: string } = {}): FunnelReport {
    const { store, clock, config } = this.ctx;
    const intents = store.intentsForUser(userId)
      .filter((i) => opts.since === undefined || i.createdAt >= opts.since)
      .slice(0, opts.limit ?? 200);
    // Recorded replays and the Sample seed are not live merchants: the console labels the whole report.
    return { rows: intents.map((i) => this.row(i)), sample: config.ucpMode !== "live", generatedAt: clock.nowIso() };
  }

  private row(i: IntentRow): FunnelRow {
    const { store } = this.ctx;
    const sessions = store.intentSessions(i.id);
    const quotes = store.quotesForIntent(i.id);
    const createdAt = Date.parse(i.createdAt);
    const firstQuote = quotes.map((q) => Date.parse(q.createdAt)).filter((t) => !Number.isNaN(t)).sort((a, b) => a - b)[0];
    const chosen = quotes.find((q) => q.acceptedAt !== undefined || q.result !== undefined || (q.status !== "open"));
    const granted = new Set<Field>();
    for (const g of store.grantsForIntent(i.id)) for (const f of g.fields) granted.add(f);
    const read = new Set<string>();
    for (const e of store.fieldReadsForIntent(i.id)) {
      // reason = "<field,field> purpose=<p> intent=<id>" (services/fields.ts); the first token is the field list.
      for (const f of (e.reason.split(" ")[0] ?? "").split(",")) if (f) read.add(f);
    }
    const row: FunnelRow = {
      intentId: i.id,
      createdAt: i.createdAt,
      source: quotes.some((q) => q.source === "fixture") ? "fixture" : "live",
      introduced: sessions.length,
      quoted: new Set(quotes.map((q) => q.agentId)).size,
      accepted: chosen !== undefined,
      fieldsGranted: granted.size,
      fieldsRead: read.size,
      purposeReleases: store.receiptsForIntent(i.id).length,
    };
    if (firstQuote !== undefined && !Number.isNaN(createdAt)) row.firstQuoteMs = Math.max(0, firstQuote - createdAt);
    if (chosen?.result) row.outcome = chosen.result.status;
    if (i.arm) row.arm = i.arm;
    const search = store.searchStatsForIntent(i.id);
    if (search) row.search = search;
    return row;
  }
}
