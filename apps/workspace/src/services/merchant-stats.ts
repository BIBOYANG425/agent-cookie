// Merchant-side stats — docs/commerce-analytics-plan.md Phase 5. A merchant sees its OWN history only: every count is
// keyed by the caller's agent_id (from its key, never from a parameter), and the body carries counts, never a session
// id, a field name or a value, and nothing about any other merchant. Pairwise stays pairwise.
import type { MerchantStats } from "@agent-cookie/contract";
import { elapsedMs, median } from "./analytics.js";
import type { Ctx } from "./context.js";

export class MerchantStatsService {
  constructor(private ctx: Ctx) {}

  /** GET /agent/stats for the authenticated merchant `agentId`. */
  forAgent(agentId: string): MerchantStats {
    const c = this.ctx.store.merchantCounts(agentId);
    const out: MerchantStats = { sessions: c.sessions, returningSessions: c.returningSessions, quotes: c.quotes, accepted: c.accepted,
      winRate: c.quotes === 0 ? 0 : c.accepted / c.quotes };
    const m = median(c.quoteTimes.flatMap((t) => { const ms = elapsedMs(t.intentAt, t.quoteAt); return ms === undefined ? [] : [ms]; }));
    if (m !== undefined) out.medianQuoteMs = m;
    return out;
  }
}
