// Dynamic memory (2026-10-17, human direction; lane B's LearnApi does the classifying). Three ways in:
//   - POST /personal/observations: turns of a conversation. Only the user's own turns are kept, per (personal agent,
//     conversation), until the conversation has been quiet for OBSERVATION_IDLE_MS or OBSERVATION_BATCH_TURNS turns
//     have arrived; then the text is taken out of SQLite (deleted in the same transaction), handed to
//     LearnApi.extractFromConversation, and dropped. Agent/other turns are never stored or passed on.
//   - every intent, and every accept (with the chosen quote): LearnApi.extract.
// What comes back is a list of CANDIDATES. Each one is checked here, deterministically: pref.* fields only (the
// contract's whitelist), no contact/payment data, a snippet only if it is the user's own words, never "stated",
// never a value the user revoked, never a duplicate of the same agent's live record. Survivors are written as the
// personal agent through the normal contribution path (git first, then SQLite), and RulesApi.mergeCard decides what
// reaches the card: two distinct sources. Paused → nothing is queued or learned. Learning failures are logged and
// never affect the request that triggered them.
import {
  EVIDENCE_SNIPPET_MAX, isField, isPrefField, OBSERVATION_BATCH_TURNS, OBSERVATION_IDLE_MS,
  type Basis, type ContributionCandidate, type ContributionEvidence, type IntentHistoryEntry, type IntentRecord, type LearnApi,
  type LearnedEntry, type LearnedResponse, type LearningState, type Observation, type Quote,
} from "@agent-cookie/contract";
import type { IntentRow, QuoteRow } from "../db.js";
import { containsContactOrPayment } from "../guards.js";
import type { AuthedAgent } from "../http.js";
import type { CardService } from "./card.js";
import { persist, writeMeta, type Ctx } from "./context.js";

const PAUSED_KEY = "learning.paused";
const VALUE_MAX = 200;

/** Collapse whitespace and case so a snippet can be checked against what the user said. */
const norm = (t: string) => t.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

export class LearningService {
  private pending = new Set<Promise<unknown>>();
  private inflight = new Map<string, Promise<void>>();

  constructor(private ctx: Ctx, private card: CardService, private learn: LearnApi) {}

  state(userId: string): LearningState {
    return { paused: this.ctx.store.setting(userId, PAUSED_KEY) === "1" };
  }

  /** Pausing also drops every conversation still waiting: nothing observed before the pause is learned after it. */
  setPaused(actor: string, userId: string, paused: boolean): LearningState {
    this.ctx.store.tx(() => {
      this.ctx.store.setSetting(userId, PAUSED_KEY, paused ? "1" : "0");
      const dropped = paused ? this.ctx.store.dropObservations(userId) : 0;
      this.ctx.log({ event: "learning.set", actor, result: paused ? "paused" : "on", reason: dropped ? `dropped=${dropped}` : "" });
    });
    if (paused) this.ctx.store.checkpoint();
    return this.state(userId);
  }

  /** Queue the user's turns of an observation (already validated by app.ts). Never blocks on learning. */
  observe(personal: AuthedAgent, userId: string, obs: Observation): { queued: boolean; paused?: true } {
    if (this.state(userId).paused) {
      this.ctx.log({ event: "observation.drop", actor: personal.agentId, result: "paused", reason: `turns=${obs.turns.length}` });
      return { queued: false, paused: true };
    }
    const user = obs.turns.filter((t) => t.role === "user");
    // A card number or contact detail typed into a chat is never stored, not even until processing.
    const kept = user.filter((t) => !containsContactOrPayment(t.text));
    const batch = this.ctx.store.enqueueObservation({ agentId: personal.agentId, conversationId: obs.conversationId, userId, channel: obs.channel },
      obs.turns.length, kept.map((t) => ({ text: t.text, at: t.at })), this.ctx.clock.nowIso());
    this.ctx.log({ event: "observation.queue", actor: personal.agentId, result: "ok",
      reason: `turns=${obs.turns.length} user=${kept.length}${kept.length < user.length ? ` dropped=${user.length - kept.length}` : ""}` });
    if (batch.turnsSeen >= OBSERVATION_BATCH_TURNS) this.track(this.ctx.hold(() => this.process(batch.agentId, batch.conversationId)));
    return { queued: true };
  }

  /** Process every conversation that has been quiet long enough or is full (timer in deps.ts; tests call it directly). */
  async flushDue(): Promise<void> {
    const idleBefore = new Date(this.ctx.clock.now() - OBSERVATION_IDLE_MS).toISOString();
    for (const b of this.ctx.store.dueObservationBatches(idleBefore, OBSERVATION_BATCH_TURNS)) {
      await this.process(b.agentId, b.conversationId);
    }
  }

  /** Everything fired so far has finished (tests, shutdown). */
  async settle(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  /**
   * After an intent is created or a quote accepted: append the request to the user's intent history in the memory
   * repo, and (unless paused) learn from it. Fire and forget; counted by the reset gate as part of the request.
   */
  afterIntent(personal: AuthedAgent, userId: string, intent: IntentRow, chosen?: QuoteRow): void {
    this.track(this.ctx.hold(async () => {
      try {
        const record: IntentRecord = { id: intent.id, userId, agentId: personal.agentId, public: intent.public, createdAt: intent.createdAt };
        if (intent.text) record.text = intent.text;
        if (intent.query) record.query = intent.query;
        if (intent.kind) record.kind = intent.kind;
        if (chosen) {
          record.chosenQuote = { id: chosen.id, price: chosen.price, currency: "USD" };
          if (chosen.title) record.chosenQuote.title = chosen.title;
          if (chosen.seller) record.chosenQuote.seller = chosen.seller;
        }
        await persist(this.ctx, "intent", personal.agentId, async (repo) => {
          if (repo.appendIntent) await repo.appendIntent(record, writeMeta(this.ctx, personal.agentId, record));
        });
        if (this.state(userId).paused) return;
        const candidates = await this.learn.extract({ intentId: intent.id, public: intent.public,
          ...(intent.text ? { text: intent.text } : {}), ...(intent.query ? { query: intent.query } : {}), ...(intent.kind ? { kind: intent.kind } : {}),
          ...(chosen ? { chosenQuote: publicQuote(chosen) } : {}) });
        await this.apply(personal, userId, candidates, { intentId: intent.id }, [intent.text ?? "", intent.query ?? ""]);
      } catch (err) {
        this.failed(personal.agentId, chosen ? "accept" : "intent", err);
      }
    }));
  }

  /** GET /personal/learned: pref.* on the card and pref.* candidates, with sources and evidence. */
  learned(userId: string): LearnedResponse {
    const card = this.card.get(userId);
    const contributions = this.ctx.store.contributionsForUser(userId).filter((c) => !c.revokedAt && isPrefField(c.field));
    const evidenceFor = (field: string, value: string) => contributions.filter((c) => c.field === field && c.value === value)
      .map((c) => ({ contributionId: c.id, agentId: c.agentId, basis: c.basis, createdAt: c.createdAt, ...(c.evidence ?? {}) }));
    const learned: LearnedEntry[] = [];
    for (const f of card.card) {
      if (isPrefField(f.field)) learned.push({ field: f.field, value: f.value, status: "card", sources: f.sources, evidence: evidenceFor(f.field, f.value) });
    }
    for (const c of card.candidates) {
      if (isPrefField(c.field)) learned.push({ field: c.field, value: c.value, status: "candidate", sources: c.sources, evidence: evidenceFor(c.field, c.value) });
    }
    return { paused: this.state(userId).paused, learned };
  }

  /** GET /personal/intents?q=: the user's own requests, newest first; `q` matches text, query, kind and public values. */
  history(userId: string, q: string | undefined, limit: number): IntentHistoryEntry[] {
    const needle = q ? norm(q) : "";
    const out: IntentHistoryEntry[] = [];
    for (const i of this.ctx.store.intentsForUser(userId)) {
      if (out.length >= limit) break;
      const hay = norm([i.text ?? "", i.query ?? "", i.kind ?? "", ...Object.values(i.public)].join(" \n "));
      if (needle && !hay.includes(needle)) continue;
      const e: IntentHistoryEntry = { id: i.id, agentId: i.agentId, public: i.public, createdAt: i.createdAt, expiresAt: i.expiresAt };
      if (i.text) e.text = i.text;
      if (i.query) e.query = i.query;
      if (i.kind) e.kind = i.kind;
      const q = this.ctx.store.quotesForIntent(i.id).find((x) => x.acceptedAt);
      if (q) {
        e.accepted = { quoteId: q.id, price: q.price, status: q.result?.status ?? q.status };
        if (q.title) e.accepted.title = q.title;
        if (q.seller) e.accepted.seller = q.seller;
      }
      out.push(e);
    }
    return out;
  }

  // ---- internals

  private track(p: Promise<unknown>): void {
    const safe = p.catch(() => undefined);
    this.pending.add(safe);
    void safe.finally(() => this.pending.delete(safe));
  }

  /** One conversation, at most once at a time. The text leaves SQLite before LearnApi sees it. */
  private process(agentId: string, conversationId: string): Promise<void> {
    const key = `${agentId}\u0000${conversationId}`;
    const running = this.inflight.get(key);
    if (running) return running;
    const run = this.processNow(agentId, conversationId).finally(() => this.inflight.delete(key));
    this.inflight.set(key, run);
    return run;
  }

  private async processNow(agentId: string, conversationId: string): Promise<void> {
    let taken: ReturnType<Ctx["store"]["takeObservationBatch"]>;
    try {
      taken = this.ctx.store.takeObservationBatch(agentId, conversationId);
      this.ctx.store.checkpoint();
    } catch (err) {
      this.failed(agentId, "conversation", err);
      return;
    }
    if (!taken) return;
    const { batch, turns } = taken;
    const personal = this.ctx.store.agent(agentId);
    if (!personal || personal.category !== "personal" || this.state(batch.userId).paused) {
      this.ctx.log({ event: "learn.conversation", actor: agentId, result: "dropped", reason: personal ? "paused" : "unknown agent" });
      return;
    }
    if (turns.length === 0) return;
    try {
      const userTurns = turns.map((t) => ({ role: "user" as const, text: t.text, at: t.at }));
      const candidates = await this.learn.extractFromConversation(userTurns, { conversationId, channel: batch.channel });
      // Paused while the learner was running: its answer is dropped too.
      if (this.state(batch.userId).paused) return;
      await this.apply({ ...personal, role: "personal" }, batch.userId, candidates, { conversationId }, turns.map((t) => t.text));
    } catch (err) {
      this.failed(agentId, "conversation", err);
    }
  }

  /**
   * Check each candidate and write the survivors as `personal`. `said` is what the user said (the only text a
   * snippet may quote). Returns how many were written. CARD.md is regenerated once at the end.
   */
  private async apply(personal: AuthedAgent, userId: string, candidates: readonly ContributionCandidate[],
    source: Pick<ContributionEvidence, "intentId" | "conversationId">, said: readonly string[]): Promise<number> {
    if (!Array.isArray(candidates) || candidates.length === 0) return 0;
    const heard = norm(said.join(" \n "));
    const existing = this.ctx.store.contributionsForUser(userId);
    const written: string[] = [];
    const skipped: Record<string, number> = {};
    const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1; };
    for (const c of candidates.slice(0, 50)) {
      if (!c || typeof c.field !== "string" || typeof c.value !== "string") { skip("malformed"); continue; }
      // Learning only fills the pref.* whitelist; core facts (size, address, payment…) come from the user's own statements.
      if (!isField(c.field) || !isPrefField(c.field)) { skip("field"); continue; }
      const value = c.value.normalize("NFKC").replace(/\s+/g, " ").trim();
      if (!value || [...value].length > VALUE_MAX || containsContactOrPayment(value)) { skip("value"); continue; }
      const basis: Basis = c.basis === "inferred" ? "inferred" : "observed";
      if (existing.some((x) => x.revokedAt && x.field === c.field && x.value === value)) { skip("revoked"); continue; }
      if (existing.some((x) => !x.revokedAt && x.agentId === personal.agentId && x.field === c.field && x.value === value)) { skip("duplicate"); continue; }
      const evidence: ContributionEvidence = { ...source };
      const snippet = typeof c.evidence?.snippet === "string" ? [...c.evidence.snippet.trim()].slice(0, EVIDENCE_SNIPPET_MAX).join("") : "";
      // A snippet is kept only if the user actually said it (and it carries no contact or payment data).
      if (snippet && heard.includes(norm(snippet)) && !containsContactOrPayment(snippet)) evidence.snippet = snippet;
      const { contribution } = await this.card.record(personal, userId, { field: c.field, value, basis, evidence }, { regenerate: false });
      existing.push(contribution);
      written.push(c.field);
    }
    if (written.length > 0) await this.card.regenerateNow(personal.agentId);
    const why = Object.entries(skipped).map(([k, n]) => `${k}=${n}`).join(" ");
    this.ctx.log({ event: "learn.apply", actor: personal.agentId, object: source.intentId ?? "conversation", result: `written=${written.length}`,
      reason: [written.length ? `fields=${[...new Set(written)].join(",")}` : "", why].filter(Boolean).join(" ") });
    return written.length;
  }

  private failed(actor: string, what: string, err: unknown): void {
    if (this.ctx.stale()) return;
    this.ctx.log({ event: `learn.${what}`, actor, result: "failed", reason: err instanceof Error ? err.name : "error" });
  }
}

/** The quote as the personal agent saw it (no internal fields). */
function publicQuote(q: QuoteRow): Quote {
  const { sessionId: _s, status: _st, createdAt: _c, acceptedAt: _a, result: _r, ...quote } = q;
  return quote;
}
