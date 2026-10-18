// Seller outcome history for ranking — docs/commerce-analytics-plan.md Phase 3. Counts over THIS user's own intents
// (the workspace serves one user): how often a store quoted, was chosen, and how the accept ended. The integer bucket
// below feeds the sort key in ucp-filter.ts between size and preferences; everything that moved the order is logged
// as counts (`ucp.rank`). Ranking is not authorization: it changes which eligible stores are introduced, never what
// any store may read. Deterministic; no model involved.
import type { RankingWeights, SellerStats } from "@agent-cookie/contract";
import type { Store } from "../db.js";

/**
 * Sort bucket for one seller: lower sorts earlier. No history (never quoted) → 0, the same as both weights at 0.
 * winRate = accepted / quotes; failRate = failed / accepted. Rounded to integers so equal histories tie and the
 * catalog order still breaks the tie.
 */
export function outcomeRank(s: SellerStats | undefined, w: RankingWeights): number {
  if (!s || s.quotes === 0) return 0;
  const winRate = s.accepted / s.quotes;
  const failRate = s.accepted === 0 ? 0 : s.failed / s.accepted;
  // `0 - score`, not `-score`: a zero score must be +0 (it is logged and compared).
  return 0 - (Math.round(winRate * w.winRate) - Math.round(failRate * w.failure));
}

export class SellerStatsService {
  constructor(private store: Store) {}

  /** History of the UCP proxies (`ucp:<domain>`) for these domains, keyed by domain. Sellers with no history are absent. */
  forSellers(domains: Iterable<string>): Map<string, SellerStats> {
    const out = new Map<string, SellerStats>();
    for (const d of new Set(domains)) {
      const s = this.store.sellerStats(`ucp:${d}`, d);
      if (s.intents > 0 || s.quotes > 0) out.set(d, s);
    }
    return out;
  }
}
