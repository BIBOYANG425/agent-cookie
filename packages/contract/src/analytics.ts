// Funnel analytics — docs/commerce-analytics-plan.md Phase 0. Counts and ids only; a field VALUE never appears here.
// The owner (the user) may join everything about their own intents; a merchant never sees these shapes.
import type { AcceptResult, DataSource } from "./types.js";

/** Where an intent is in the buying funnel. Ordered; a session's stage for an intent only moves forward. */
export type FunnelStage = "introduced" | "quoted" | "accepted" | "checkout" | "payment" | "completed";
export const FUNNEL_STAGES: readonly FunnelStage[] = ["introduced", "quoted", "accepted", "checkout", "payment", "completed"];

export function stageIndex(stage: FunnelStage): number {
  return FUNNEL_STAGES.indexOf(stage);
}

export function isFunnelStage(x: unknown): x is FunnelStage {
  return typeof x === "string" && (FUNNEL_STAGES as readonly string[]).includes(x);
}

/**
 * What the hard filters did to one catalog search (apps/workspace ucp-filter: USD, ships to the user's country,
 * available, the budget stated in this request, the card's learned `pref.avoid`). `offers` = eligible + every dropped
 * bucket; an offer is counted in the first bucket that rejects it, checked in the order avoid, currency, unavailable,
 * shipsTo, invalid price, budget, missing seller or variant id (`invalid`).
 */
export interface SearchStats {
  offers: number;
  droppedAvoid: number;
  droppedCurrency: number;
  droppedUnavailable: number;
  droppedShipsTo: number;
  droppedBudget: number;
  /** Malformed price or missing seller/variant id. */
  droppedInvalid: number;
  eligible: number;
  /** Distinct seller domains among eligible offers. */
  eligibleSellers: number;
  /** Sellers introduced (≤ the request's count). */
  picked: number;
}

/** One intent, from creation to its terminal outcome. */
export interface FunnelRow {
  intentId: string;
  createdAt: string;
  /** "fixture" when any merchant answer for this intent was a recorded replay; "live" otherwise. */
  source: DataSource;
  /** Merchants introduced (sessions attached to the intent, every channel). */
  introduced: number;
  /** Distinct merchants that quoted. */
  quoted: number;
  /** Milliseconds from intent creation to the first quote; absent when nobody quoted. */
  firstQuoteMs?: number;
  accepted: boolean;
  /** The accepted quote's terminal status, once there is one. */
  outcome?: AcceptResult["status"];
  /** Distinct field names in the grants issued for this intent (every merchant). */
  fieldsGranted: number;
  /** Distinct field names merchants actually read under those grants. fieldsRead / fieldsGranted is the minimization ratio. */
  fieldsRead: number;
  /** Receipts written for this intent (purpose releases and Tier 0 deliveries). */
  purposeReleases: number;
  search?: SearchStats;
}

/** Response of GET /owner/funnel. `sample` is true unless the workspace talks to live merchants. */
export interface FunnelReport {
  rows: FunnelRow[];
  sample: boolean;
  generatedAt: string;
}

// ---- Phase 3: outcome-aware ranking (deterministic, logged) ----

/** One seller's history over THIS user's own intents. Counts only. */
export interface SellerStats {
  sellerDomain: string;
  /** Intents the seller was introduced to. */
  intents: number;
  quotes: number;
  /** Quotes the user accepted. */
  accepted: number;
  ordered: number;
  handoff: number;
  /** Accepts that ended "failed" (the store refused the cart, sold out, unreachable). "blocked" is the user's doing and is not counted. */
  failed: number;
}

/**
 * Integer weights 0–100 in the policy document (`ranking`). Both 0, or the section absent, means today's order:
 * pinned, size, preferences, budget, catalog order. outcomeRank = −(round(winRate·winRate) − round(failRate·failure)),
 * so sellers with equal history tie and catalog order still breaks the tie.
 */
export interface RankingWeights {
  winRate: number;
  failure: number;
}

/** What moved the order of one search (`ucp.rank` activity event). Ranks are the integer sort buckets, not scores. */
export interface RankStats {
  weights: RankingWeights;
  sellers: Array<{ sellerDomain: string; sizeRank: number; prefRank: number; outcomeRank: number; picked: boolean }>;
}
