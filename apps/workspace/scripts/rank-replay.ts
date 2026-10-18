// Offline ranking evaluation — docs/commerce-analytics-plan.md Phase 3 gate. Replays this workspace's past intents
// against the recorded catalog (fixture mode: the same offers every time) and reports whether the seller the user
// actually accepted would have ranked FIRST, with and without outcome ranking (hit@1 and mean reciprocal rank).
// Reads a COPY of the owner's SQLite file directly — an offline script on the owner's own machine, not a product
// path (products go through the SDK) — and writes nothing but the report. Prints counts and seller domains only.
// Usage: pnpm --filter @agent-cookie/workspace exec tsx scripts/rank-replay.ts --sqlite <copy.sqlite> [--fixtures <dir>] [--weights 10,10] [--out report.json]
// Exit 0 = report written (n may be 0); 2 = could not run.
import Database from "better-sqlite3";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RankingWeights, SellerStats, UcpOffer } from "@agent-cookie/contract";
import { createUcp } from "@agent-cookie/ucp";
import { outcomeRank } from "../src/services/seller-stats.js";
import { parseBudgetCents, pickSellers, type SearchConditions } from "../src/ucp-filter.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

interface IntentRow { id: string; created_at: string; text: string | null; query: string | null; kind: string | null; public: string }
interface QuoteRow { intent_id: string; agent_id: string; seller: string | null; accepted_at: string | null; status: string; created_at: string }
interface IntroRow { agent_id: string; intent_id: string; created_at: string }

async function main(): Promise<void> {
  const sqlite = arg("--sqlite");
  if (!sqlite) {
    console.error("--sqlite <path to a copy of the workspace database> is required");
    process.exit(2);
  }
  const fixturesDir = arg("--fixtures") ?? resolve(process.cwd(), "../../fixtures/ucp");
  const [w0, w1] = (arg("--weights") ?? "10,10").split(",").map((x) => Number(x));
  const weights: RankingWeights = { winRate: Number.isInteger(w0) ? w0! : 10, failure: Number.isInteger(w1) ? w1! : 10 };
  const out = arg("--out");

  const db = new Database(sqlite, { readonly: true });
  const intents = db.prepare("SELECT id, created_at, text, query, kind, public FROM intents ORDER BY created_at ASC, rowid ASC").all() as IntentRow[];
  const quotes = db.prepare("SELECT intent_id, agent_id, seller, accepted_at, status, created_at FROM quotes").all() as QuoteRow[];
  const intros = db.prepare("SELECT s.agent_id, s.intent_id, n.created_at FROM intent_sessions s JOIN intents n ON n.id = s.intent_id").all() as IntroRow[];
  db.close();

  // History strictly before the intent being replayed: no leakage from the outcome we are predicting.
  const historyBefore = (domain: string, before: string): SellerStats => {
    const agentId = `ucp:${domain}`;
    const qs = quotes.filter((q) => q.agent_id === agentId && q.created_at < before);
    return { sellerDomain: domain, intents: intros.filter((x) => x.agent_id === agentId && x.created_at < before).length, quotes: qs.length,
      accepted: qs.filter((q) => q.accepted_at !== null).length, ordered: qs.filter((q) => q.status === "ordered").length,
      handoff: qs.filter((q) => q.status === "handoff").length, failed: qs.filter((q) => q.status === "failed").length };
  };

  const ucp = createUcp({ mode: "fixture", fixturesDir });
  const arms = { baseline: { hits: 0, rr: 0 }, ranked: { hits: 0, rr: 0 } };
  let n = 0;
  let skipped = 0;
  for (const intent of intents) {
    const accepted = quotes.find((q) => q.intent_id === intent.id && q.accepted_at !== null && q.seller);
    const query = intent.query ?? intent.text ?? intent.kind?.replace(/_/g, " ");
    if (!accepted?.seller || !query) continue;
    let offers: UcpOffer[];
    try {
      offers = await ucp.searchOffers({ query, shipsTo: "US", limit: 50 });
    } catch {
      skipped++;
      continue;
    }
    const pub = JSON.parse(intent.public) as Record<string, string>;
    const maxPriceCents = parseBudgetCents(pub.budget);
    const base: SearchConditions = { shipsTo: "US", ...(maxPriceCents !== undefined ? { maxPriceCents } : {}), ...(pub.size ? { size: pub.size } : {}) };
    const domains = [...new Set(offers.map((o) => o.sellerDomain))];
    const outcome = Object.fromEntries(domains.map((d) => [d, outcomeRank(historyBefore(d, intent.created_at), weights)]));
    n++;
    for (const [arm, q] of [["baseline", base], ["ranked", { ...base, outcome }]] as const) {
      const order = pickSellers(offers, q, Math.max(1, domains.length)).map((p) => p.offer.sellerDomain);
      const pos = order.indexOf(accepted.seller);
      if (pos === 0) arms[arm].hits++;
      if (pos >= 0) arms[arm].rr += 1 / (pos + 1);
    }
  }
  const score = (a: { hits: number; rr: number }) => ({ hitAt1: n ? a.hits / n : null, mrr: n ? a.rr / n : null });
  const report = {
    n, skipped, weights, fixturesDir,
    baseline: score(arms.baseline), ranked: score(arms.ranked),
    approximations: [
      "card values at the time are not stored: only the intent's own budget and size drive the conditions",
      "history for each intent uses intents strictly before it",
      "fixture catalog: the same offers for every intent, as recorded",
    ],
  };
  const text = JSON.stringify(report, null, 2);
  console.log(text);
  if (out) writeFileSync(out, text);
}

void main();
