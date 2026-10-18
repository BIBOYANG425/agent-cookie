import { createHmac } from "node:crypto";
// Dynamic memory (2026-10-17, human direction; lane B's LearnApi does the classifying). Three ways in:
//   - POST /personal/observations: turns of a conversation. Only the user's own turns are kept, per (personal agent,
//     conversation), until the conversation has been quiet for OBSERVATION_IDLE_MS or OBSERVATION_BATCH_TURNS turns
//     have arrived; then text is removed from the bounded volatile queue, handed to
//     LearnApi.extractFromConversation, and dropped. Agent/other turns are never stored or passed on.
//   - every intent, and every accept (with the chosen quote): LearnApi.extract.
// What comes back is a list of CANDIDATES. Each one is checked here, deterministically: pref.* fields only (the
// contract's whitelist), no contact/payment data, a snippet only if it is the user's own words, stated preserved,
// never a value the user revoked, never duplicate support from the same evidence source. Survivors are written as the
// personal agent through the normal contribution path (git first, then SQLite), and RulesApi.mergeCard decides what
// reaches the card: a personal statement or two distinct conversation/intent sources. Paused → nothing is queued or learned. Learning failures are logged and
// never affect the request that triggered them.
import {
  EVIDENCE_SNIPPET_MAX, isField, isPrefField, OBSERVATION_BATCH_TURNS, OBSERVATION_IDLE_MS,
  type ForgetLearningResult, type PrefField, type Basis, type ContributionCandidate, type ContributionEvidence, type IntentHistoryEntry, type IntentRecord, type LearnApi,
  type LearnedEntry, type LearnedResponse, type LearningState, type Observation, type Quote,
} from "@agent-cookie/contract";
import type { IntentRow, QuoteRow, StoredContribution } from "../db.js";
import { containsContactOrPayment, prefValueProblem } from "../guards.js";
import { fail, type AuthedAgent } from "../http.js";
import type { CardService } from "./card.js";
import { persist, writeMeta, type Ctx } from "./context.js";

const PAUSED_KEY = "learning.paused";
/** Bumped on every pause: a learner answer that started before a pause is dropped even if learning was resumed since. */
const EPOCH_KEY = "learning.epoch";
/** Same-source stronger statements may supersede weaker evidence. */
const BASIS_RANK: Record<Basis, number> = { inferred: 0, observed: 1, stated: 2 };

/** Collapse width, whitespace and case: "Brooks", " brooks ", "ＢＲＯＯＫＳ" are one value. */
const norm = (t: string) => t.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

class LearnerTimeout extends Error {
  override name = "LearnerTimeout";
}

export class LearningService {
  private pending = new Set<Promise<unknown>>();
  private inflight = new Map<string, Promise<void>>();
  /** apply() runs one at a time, so duplicate checks see every earlier write. */
  private applying: Promise<unknown> = Promise.resolve();
  private checkpointOwed = false;

  constructor(private ctx: Ctx, private card: CardService, private learn: LearnApi) {}

  state(userId: string): LearningState {
    return { paused: this.ctx.store.setting(userId, PAUSED_KEY) === "1" };
  }

  private epoch(userId: string): string {
    return this.ctx.store.setting(userId, EPOCH_KEY) ?? "0";
  }

  /** Learning may still write for this user: not paused, and no pause happened since `epoch` was read. */
  private stillOn(userId: string, epoch: string): boolean {
    return !this.state(userId).paused && this.epoch(userId) === epoch;
  }

  /** Pausing also drops every conversation still waiting: nothing observed before the pause is learned after it. */
  setPaused(actor: string, userId: string, paused: boolean): Promise<LearningState> {
    return this.card.mutate(async () => {
      if (!paused && this.ctx.store.pendingForgets(userId).length) fail("UPSTREAM_ERROR", "Forget projection is pending");
      this.ctx.store.tx(() => {
        this.ctx.store.setSetting(userId, PAUSED_KEY, paused ? "1" : "0");
        if (paused) this.ctx.store.setSetting(userId, EPOCH_KEY, String(Number(this.epoch(userId)) + 1));
        this.ctx.log({ event: "learning.set", actor, result: paused ? "paused" : "on" });
      });
      if (paused) this.ctx.store.dropObservations(userId);
      return this.state(userId);
    });
  }

  private suppressedKey(userId: string, field: string, value: string): string {
    const secret = this.ctx.store.user(userId)!.secret;
    return 'learning.block.' + createHmac('sha256', secret).update(JSON.stringify([field, norm(value)])).digest('hex');
  }

  /** One serving-store transaction, followed by a recoverable current-files projection. */
  forget(actor: string, userId: string, field: PrefField): Promise<ForgetLearningResult> {
    const run = this.applying.then(() => this.card.mutate(async () => {
      const removed = this.ctx.store.tx(() => {
        const rows = this.ctx.store.contributionsForUser(userId).filter(c => c.field === field);
        this.ctx.store.setSetting(userId, PAUSED_KEY, '1');
        this.ctx.store.setSetting(userId, EPOCH_KEY, String(Number(this.epoch(userId)) + 1));
        const oldIds = this.ctx.store.pendingForgets(userId).find(job => job.field === field)?.ids ?? [];
        const ids = [...new Set([...oldIds, ...rows.map(c => c.id)])];
        for (const row of rows) this.ctx.store.setSetting(userId, this.suppressedKey(userId, field, row.value), '1');
        this.ctx.store.deletePreference(userId, field);
        this.ctx.store.setSetting(userId, `learning.forget.${field}`, JSON.stringify(ids));
        this.ctx.log({ event: 'learning.forget', actor, object: field, result: 'removed', reason: `count=${rows.length}` });
        return rows.length;
      });
      this.ctx.store.dropObservations(userId);
      this.card.get(userId);
      const complete = await this.projectForget(actor, userId, field);
      this.checkpoint();
      return { field, paused: true as const, removed, projection: complete ? 'complete' as const : 'pending' as const, historyErased: false as const };
    }));
    this.applying = run.catch(() => undefined);
    return run;
  }

  private async projectForget(actor: string, userId: string, field: string): Promise<boolean> {
    const job = this.ctx.store.pendingForgets(userId).find(row => row.field === field);
    if (!job) return true;
    try {
      const repo = this.ctx.repo();
      if (!repo.forgetContributions) throw new Error('Projection unavailable');
      await repo.forgetContributions(job.ids, { now: this.ctx.clock.nowIso(), personalAgentIds: this.ctx.store.personalAgentIds() },
        writeMeta(this.ctx, actor, { field, ids: job.ids }));
      this.ctx.store.completeForget(userId, field);
      return true;
    } catch {
      this.ctx.log({ event: 'learning.forget', actor, object: field, result: 'pending', reason: 'projection unavailable' });
      return false;
    }
  }

  /** Replay only opaque IDs after a crash; never enqueue original conversation text. */
  async recoverForgets(): Promise<boolean> {
    const user = this.ctx.store.firstUser();
    if (!user) return true;
    let complete = true;
    for (const job of this.ctx.store.pendingForgets(user.userId)) {
      if (!await this.projectForget('workspace', user.userId, job.field)) complete = false;
    }
    return complete;
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
    if (batch.turnsSeen >= OBSERVATION_BATCH_TURNS && this.pending.size < 4) this.track(this.ctx.hold(() => this.process(batch.agentId, batch.conversationId)));
    return { queued: true };
  }

  /** Process every conversation that has been quiet long enough or is full. */
  async flushDue(): Promise<void> {
    const idleBefore = () => new Date(this.ctx.clock.now() - OBSERVATION_IDLE_MS).toISOString();
    for (const b of this.ctx.store.dueObservationBatches(idleBefore(), OBSERVATION_BATCH_TURNS)) {
      // Re-read: while earlier ones were processed this one may have been taken and started again.
      const now = this.ctx.store.observationBatch(b.agentId, b.conversationId);
      if (!now || (now.lastAt > idleBefore() && now.turnsSeen < OBSERVATION_BATCH_TURNS)) continue;
      await this.process(b.agentId, b.conversationId);
    }
    if (this.checkpointOwed) this.checkpoint();
  }

  /** The timer's entry point (deps.ts): one flush, run by `runner` (the reset gate), counted by settle(). */
  tick(runner: (fn: () => Promise<void>) => Promise<void>): void {
    this.track(runner(() => this.flushDue()));
  }

  /** Everything fired so far has finished (tests, shutdown). Learner calls are bounded by LEARN_TIMEOUT_MS. */
  async settle(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  /**
   * After an intent is created or a quote accepted: append the request to the user's intent history in the memory
   * repo, and (unless paused) learn from it. What the user said belongs to the personal agent they said it to (the
   * intent's), so another agent accepting the quote does not count as a second source. Fire and forget.
   */
  afterIntent(actor: AuthedAgent, userId: string, intent: IntentRow, chosen?: QuoteRow): void {
    this.track(this.ctx.hold(async () => {
      const epoch = this.epoch(userId);
      try {
        const record: IntentRecord = { id: intent.id, userId, agentId: actor.agentId, evidence: { intentId: intent.id }, public: intent.public, createdAt: intent.createdAt };
        if (intent.text) record.text = intent.text;
        if (intent.query) record.query = intent.query;
        if (intent.kind) record.kind = intent.kind;
        if (chosen) {
          record.chosenQuote = { id: chosen.id, price: chosen.price, currency: "USD" };
          if (chosen.title) record.chosenQuote.title = chosen.title;
          if (chosen.seller) record.chosenQuote.seller = chosen.seller;
        }
        await persist(this.ctx, "intent", actor.agentId, async (repo) => {
          if (repo.appendIntent) await repo.appendIntent(record, writeMeta(this.ctx, actor.agentId, record));
        });
        const heardBy = this.ctx.store.agent(intent.agentId);
        if (!heardBy || heardBy.category !== "personal" || !this.stillOn(userId, epoch)) return;
        const candidates = await this.withTimeout(this.learn.extract({ intentId: intent.id, public: intent.public,
          ...(intent.text ? { text: intent.text } : {}), ...(intent.query ? { query: intent.query } : {}), ...(intent.kind ? { kind: intent.kind } : {}),
          ...(chosen ? { chosenQuote: publicQuote(chosen) } : {}) }));
        await this.applySerial({ ...heardBy, role: "personal" }, userId, candidates, { intentId: intent.id },
          [intent.text ?? "", intent.query ?? ""], epoch);
      } catch (err) {
        this.failed(actor.agentId, chosen ? "accept" : "intent", err);
      }
    }));
  }

  /** GET /personal/learned: pref.* on the card and pref.* candidates the user's own agents produced, with evidence. */
  learned(userId: string): LearnedResponse {
    const card = this.card.get(userId);
    const personal = new Set(this.ctx.store.personalAgentIds());
    const mine = this.ctx.store.contributionsForUser(userId).filter((c) => !c.revokedAt && isPrefField(c.field) && personal.has(c.agentId));
    const evidenceFor = (field: string, value: string) => mine.filter((c) => c.field === field && c.value === value)
      .map((c) => ({ contributionId: c.id, agentId: c.agentId, basis: c.basis, createdAt: c.createdAt, ...(c.evidence ?? {}) }));
    const learned: LearnedEntry[] = [];
    const add = (field: string, value: string, status: LearnedEntry["status"], sources: string[]) => {
      if (!isPrefField(field)) return;
      const evidence = evidenceFor(field, value);
      // Merchants cannot write pref.* (their attempts are kept as their own inferred records): not "learned".
      if (evidence.length === 0) return;
      learned.push({ field, value, status, sources: sources.filter((s) => personal.has(s)), evidence });
    };
    for (const f of card.card) add(f.field, f.value, "card", f.sources);
    for (const c of card.candidates) add(c.field, c.value, "candidate", c.sources);
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
      // The most recent choice, if the user accepted more than one quote for this request.
      const q = this.ctx.store.quotesForIntent(i.id).filter((x) => x.acceptedAt).sort((a, b) => (a.acceptedAt! < b.acceptedAt! ? 1 : -1))[0];
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

  private checkpoint(): void {
    this.checkpointOwed = !this.ctx.store.checkpoint();
  }

  /** A learner that never answers must not hold a conversation, the reset gate or shutdown hostage. */
  private withTimeout<T>(p: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const t = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new LearnerTimeout()), this.ctx.config.learnTimeoutMs); });
    return Promise.race([p, t]).finally(() => clearTimeout(timer));
  }

  /** One conversation, at most once at a time. The text leaves SQLite before LearnApi sees it. */
  private process(agentId: string, conversationId: string): Promise<void> {
    const key = `${agentId}\u0000${conversationId}`;
    const running = this.inflight.get(key);
    if (running) return running;
    if (this.inflight.size >= 4) return Promise.resolve(); // leave the bounded batch for the next tick
    const run = this.processNow(agentId, conversationId).finally(() => this.inflight.delete(key));
    this.inflight.set(key, run);
    return run;
  }

  private async processNow(agentId: string, conversationId: string): Promise<void> {
    let taken: ReturnType<Ctx["store"]["takeObservationBatch"]>;
    try {
      taken = this.ctx.store.takeObservationBatch(agentId, conversationId);
      this.checkpoint();
    } catch (err) {
      this.failed(agentId, "conversation", err);
      return;
    }
    if (!taken) return;
    const { batch, turns } = taken;
    const epoch = this.epoch(batch.userId);
    const personal = this.ctx.store.agent(agentId);
    if (!personal || personal.category !== "personal" || this.state(batch.userId).paused) {
      this.ctx.log({ event: "learn.conversation", actor: agentId, result: "dropped", reason: personal ? "paused" : "unknown agent" });
      return;
    }
    if (turns.length === 0) return;
    try {
      const userTurns = turns.map((t) => ({ role: "user" as const, text: t.text, at: t.at }));
      const candidates = await this.withTimeout(this.learn.extractFromConversation(userTurns, { conversationId, channel: batch.channel }));
      await this.applySerial({ ...personal, role: "personal" }, batch.userId, candidates, { conversationId }, turns.map((t) => t.text), epoch);
    } catch (err) {
      this.failed(agentId, "conversation", err);
    }
  }

  private applySerial(...args: Parameters<LearningService["apply"]>): Promise<number> {
    const run = this.applying.then(() => this.apply(...args));
    this.applying = run.catch(() => undefined);
    return run;
  }

  /**
   * Check each candidate and write the survivors as `personal`. `said` is what the user said: a snippet must quote it
   * and name the value. Nothing is written if learning was paused since `epoch` (even if resumed again). Returns how
   * many were written. CARD.md is regenerated once at the end.
   */
  private async apply(personal: AuthedAgent, userId: string, raw: unknown, source: Pick<ContributionEvidence, "intentId" | "conversationId">,
    said: readonly string[], epoch: string): Promise<number> {
    if (!this.stillOn(userId, epoch)) {
      this.ctx.log({ event: "learn.apply", actor: personal.agentId, object: source.intentId ?? "conversation", result: "dropped", reason: "paused" });
      return 0;
    }
    // The learner's answer is data: copy it once (no getters re-read later), keep plain candidate objects only.
    let candidates: ContributionCandidate[];
    try {
      candidates = Array.isArray(raw) ? (JSON.parse(JSON.stringify(raw.slice(0, 50))) as ContributionCandidate[]) : [];
    } catch {
      candidates = [];
    }
    if (candidates.length === 0) return 0;
    const heard = norm(said.join(" \n "));
    const existing: StoredContribution[] = this.ctx.store.contributionsForUser(userId);
    const written: string[] = [];
    const skipped: Record<string, number> = {};
    const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1; };
    for (const c of candidates) {
      if (!c || typeof c.field !== "string" || typeof c.value !== "string") { skip("malformed"); continue; }
      const field = c.field;
      // Learning only fills the pref.* whitelist; core facts (size, address, payment…) come from the user's own statements.
      if (!isField(field) || !isPrefField(field)) { skip("field"); continue; }
      let value = c.value.normalize("NFKC").replace(/\s+/g, " ").trim();
      if (prefValueProblem(value)) { skip("value"); continue; }
      const same = (x: StoredContribution) => x.field === field && norm(x.value) === norm(value);
      // One spelling per value: a later "brooks" joins the existing "Brooks", so sources add up.
      value = existing.find((x) => same(x) && !x.revokedAt)?.value ?? value;
      const basis: Basis = c.basis === "stated" ? "stated" : c.basis === "inferred" ? "inferred" : "observed";
      if (this.ctx.store.setting(userId, this.suppressedKey(userId, field, value)) === "1") { skip("forgotten"); continue; }
      if (existing.some((x) => same(x) && x.revokedAt)) { skip("revoked"); continue; }
      // Retry of the same evidence is not another source. A different conversation is,
      // even if the same personal agent heard both. Intent handoffs retain the original source.
      const sameSource = (x: StoredContribution) =>
        (source.conversationId !== undefined && x.evidence?.conversationId === source.conversationId) ||
        (source.intentId !== undefined && x.evidence?.intentId === source.intentId);
      if (existing.some((x) => same(x) && !x.revokedAt && sameSource(x) && BASIS_RANK[x.basis] >= BASIS_RANK[basis])) {
        skip("duplicate"); continue;
      }
      const evidence: ContributionEvidence = { ...source };
      const snippet = typeof c.evidence?.snippet === "string" ? [...c.evidence.snippet.trim()].slice(0, EVIDENCE_SNIPPET_MAX).join("") : "";
      // A snippet is kept only if the user said it, it names the value, and it carries no contact or payment data.
      if (snippet && heard.includes(norm(snippet)) && norm(snippet).includes(norm(value)) && !containsContactOrPayment(snippet)) {
        evidence.snippet = snippet;
      }
      if (!this.stillOn(userId, epoch)) break;
      const { contribution } = await this.card.record(personal, userId, { field, value, basis, evidence }, { regenerate: false, canWrite: () => this.stillOn(userId, epoch) });
      existing.push(contribution);
      written.push(field);
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
