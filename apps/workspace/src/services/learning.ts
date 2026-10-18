import { createHmac } from "node:crypto";
// Dynamic memory (2026-10-17, human direction; lane B's LearnApi does the classifying; B49 rulings). Two ways in:
//   - POST /personal/observations: turns of a conversation. Only the user's own turns are kept, per (personal agent,
//     conversation), in process memory (observations.ts, bounded; SQLite mirrors only ids, counts and times).
//     Dreaming (dreaming.ts) takes every conversation that has been quiet for OBSERVATION_IDLE_MS or has
//     OBSERVATION_BATCH_TURNS turns out of the queue, hands it to LearnApi.extractFromConversation, and drops it —
//     nothing is learned on arrival. Agent/other turns are never kept or passed on; a replayed messageId is ignored.
//   - every intent, and every accept (with the chosen quote): LearnApi.extract.
// What comes back is a list of CANDIDATES. Each one is checked here, deterministically: pref.* fields only (the
// contract's whitelist), a value that passes the contract's format check (no contact/payment data), a snippet only if
// it is the user's own words, never a value the user revoked, never a second record of the same value from the same
// source (conversation / intent). Survivors are written through the normal contribution path (git first, then
// SQLite) with the basis the extractor gave — stated, observed or inferred — by the personal agent that did the
// operation (who heard the conversation, who made the request, who accepted the quote), and RulesApi.mergeCard
// decides what reaches the card: the user's statement at once, anything else with two independent sources.
// Paused → nothing is queued or learned. Forget revokes everything learned from one conversation or intent at once.
// Learning failures are logged and never affect the request that triggered them.
import {
  EVIDENCE_SNIPPET_MAX, isField, isPrefField, OBSERVATION_BATCH_TURNS, OBSERVATION_IDLE_MS,
  type ForgetLearningResult, type PrefField, type Basis, type ContributionCandidate, type ContributionEvidence, type ForgetRequest, type ForgetResult, type IntentHistoryEntry,
  type IntentRecord, type LearnApi, type LearnedEntry, type LearnedResponse, type LearningState, type Observation, type ObservationAck, type Quote,
} from "@agent-cookie/contract";
import type { IntentRow, QuoteRow, Store, StoredContribution } from "../db.js";
import { containsContactOrPayment, prefValueProblem } from "../guards.js";
import { fail, type AuthedAgent } from "../http.js";
import type { CardService } from "./card.js";
import { persist, writeMeta, type Ctx } from "./context.js";
import { ObservationQueue, type QueuedConversation } from "./observations.js";
import { evidenceModels } from "./provenance.js";
import { assistState } from "./sessions.js";

const PAUSED_KEY = "learning.paused";
/** Bumped on every pause: a learner answer that started before a pause is dropped even if learning was resumed since. */
const EPOCH_KEY = "learning.epoch";
const BASIS_RANK: Record<Basis, number> = { inferred: 0, observed: 1, stated: 2 };
const BASES: ReadonlySet<string> = new Set(["stated", "observed", "inferred"]);
type Source = Pick<ContributionEvidence, "intentId" | "conversationId">;
const sourceKey = (s: Source) => (s.conversationId !== undefined ? `conversation\u0000${s.conversationId}` : `intent\u0000${s.intentId ?? ""}`);

/** Collapse width, whitespace and case: "Brooks", " brooks ", "ＢＲＯＯＫＳ" are one value. */
const norm = (t: string) => t.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The person's intent and purchase history, newest first, as GET /personal/intents serves it (and, minus the user's
 * words, GET /assistant/history: services/assistant.ts). One builder for both. `q` matches text, query, kind and
 * public values. `accepted` is the most recent accepted quote with its merchant's agentId and result status.
 */
export function intentHistory(store: Pick<Store, "intentsForUser" | "quotesForIntent">, userId: string,
  opts: { q?: string | undefined; limit: number }): IntentHistoryEntry[] {
  const needle = opts.q ? norm(opts.q) : "";
  const out: IntentHistoryEntry[] = [];
  for (const i of store.intentsForUser(userId)) {
    if (out.length >= opts.limit) break;
    const hay = norm([i.text ?? "", i.query ?? "", i.kind ?? "", ...Object.values(i.public)].join(" \n "));
    if (needle && !hay.includes(needle)) continue;
    const e: IntentHistoryEntry = { id: i.id, agentId: i.agentId, public: i.public, createdAt: i.createdAt, expiresAt: i.expiresAt };
    if (i.text) e.text = i.text;
    if (i.query) e.query = i.query;
    if (i.kind) e.kind = i.kind;
    // The most recent choice, if the user accepted more than one quote for this request.
    const q = store.quotesForIntent(i.id).filter((x) => x.acceptedAt).sort((a, b) => (a.acceptedAt! < b.acceptedAt! ? 1 : -1))[0];
    if (q) {
      e.accepted = { quoteId: q.id, price: q.price, status: q.result?.status ?? q.status };
      if (q.title) e.accepted.title = q.title;
      if (q.seller) e.accepted.seller = q.seller;
      e.accepted.agentId = q.agentId;
    }
    out.push(e);
  }
  return out;
}

class LearnerTimeout extends Error {
  override name = "LearnerTimeout";
}

export class LearningService {
  private pending = new Set<Promise<unknown>>();
  private inflight = new Map<string, Promise<number>>();
  /** apply() and forget() run one at a time, so duplicate checks and forgets see every earlier write. */
  private applying: Promise<unknown> = Promise.resolve();
  readonly queue = new ObservationQueue();
  /** Forget counter, and the value it had when each source was last forgotten: older in-flight answers are dropped. */
  private forgets = 0;
  private forgotten = new Map<string, number>();

  constructor(private ctx: Ctx, private card: CardService, private learn: LearnApi) {
    // The text of conversations that were waiting did not survive the restart; their mirror rows go with it.
    const lost = ctx.store.dropObservations();
    if (lost > 0) ctx.log({ event: "observation.drop", actor: "workspace", result: "restart", reason: `conversations=${lost}` });
  }

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
      if (paused) { this.queue.dropUser(userId); this.ctx.store.dropObservations(userId); }
      return this.state(userId);
    });
  }

  private suppressedKey(userId: string, field: string, value: string): string {
    const secret = this.ctx.store.user(userId)!.secret;
    return 'learning.block.' + createHmac('sha256', secret).update(JSON.stringify([field, norm(value)])).digest('hex');
  }

  /** One serving-store transaction, followed by a recoverable current-files projection. */
  forgetField(actor: string, userId: string, field: PrefField): Promise<ForgetLearningResult> {
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
      this.queue.dropUser(userId); this.ctx.store.dropObservations(userId);
      this.card.get(userId);
      const complete = await this.projectForget(actor, userId, field);
      this.ctx.store.checkpoint();
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
      const now = this.ctx.clock.nowIso();
      await repo.forgetContributions(job.ids, { now, personalAgentIds: this.ctx.store.trustedStatedAgentIds(now) },
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
  observe(personal: AuthedAgent, userId: string, obs: Observation): ObservationAck {
    const nowMs = this.ctx.clock.now();
    const at = { agentId: personal.agentId, conversationId: obs.conversationId, userId, channel: obs.channel };
    if (this.state(userId).paused) {
      // Remember the message ids anyway: what was said while paused is not learned when it is replayed later.
      this.queue.unseen(personal.agentId, obs.turns, nowMs);
      this.ctx.log({ event: "observation.drop", actor: personal.agentId, result: "paused", reason: `turns=${obs.turns.length}` });
      return { queued: false, paused: true };
    }
    let unsafe = 0;
    // A card number or contact detail typed into a chat is never kept, not even until processing.
    const keep = (t: Observation["turns"][number]) => {
      if (t.role !== "user") return false;
      if (containsContactOrPayment(t.text)) { unsafe++; return false; }
      return true;
    };
    const r = this.queue.add(at, obs.turns, keep, nowMs);
    for (const old of r.droppedConversations) this.ctx.store.deleteObservationBatch(old.agentId, old.conversationId);
    if (r.droppedConversations.length > 0 || r.droppedTurns > 0) {
      this.ctx.log({ event: "observation.drop", actor: personal.agentId, result: "overflow",
        reason: [r.droppedConversations.length ? `conversations=${r.droppedConversations.length}` : "", r.droppedTurns ? `turns=${r.droppedTurns}` : ""].filter(Boolean).join(" ") });
    }
    if (r.fresh === 0) {
      this.ctx.log({ event: "observation.drop", actor: personal.agentId, result: "duplicate", reason: `turns=${r.duplicates}` });
      return { queued: false, duplicate: true };
    }
    this.ctx.store.mirrorObservation(mirror(r.batch));
    this.ctx.log({ event: "observation.queue", actor: personal.agentId, result: "ok",
      reason: [`turns=${obs.turns.length}`, `user=${obs.turns.filter((t) => t.role === "user").length - unsafe}`,
        unsafe ? `dropped=${unsafe}` : "", r.duplicates ? `duplicates=${r.duplicates}` : ""].filter(Boolean).join(" ") });
    // Learning happens in Dreaming only: a full conversation waits for the next run (still bounded by the queue).
    return { queued: true };
  }

  /** Drain due conversations; keep the original void-returning integration interface. */
  async flushDue(): Promise<void> {
    await this.flushDueStats();
  }

  /**
   * Dreaming step (a): learn from every conversation that, at `nowMs`, has been quiet for OBSERVATION_IDLE_MS or has
   * OBSERVATION_BATCH_TURNS turns. Returns how many conversations were taken and how many contributions written.
   */
  async flushDueStats(nowMs: number = this.ctx.clock.now()): Promise<{ conversations: number; learned: number }> {
    const idleBefore = nowMs - OBSERVATION_IDLE_MS;
    let conversations = 0;
    let learned = 0;
    for (const b of this.queue.due(idleBefore, OBSERVATION_BATCH_TURNS)) {
      // Re-check: while earlier ones were processed this one may have been taken and started again.
      const now = this.queue.get(b.agentId, b.conversationId);
      if (!now || (now.lastAt > idleBefore && now.turnsSeen < OBSERVATION_BATCH_TURNS)) continue;
      conversations++;
      learned += await this.process(b.agentId, b.conversationId);
    }
    return { conversations, learned };
  }

  /**
   * POST /personal/learned/forget: revoke every contribution learned from this conversation or intent — one SQLite
   * transaction, one memory-repo commit with CARD.md (CardService.revokeMany) — drop its waiting turns, and drop any
   * learner answer for it that is still in flight. Runs in line with apply(), so nothing it misses is written after.
   */
  forget(actor: string, userId: string, by: ForgetRequest): Promise<ForgetResult> {
    const source: Source = by.conversationId !== undefined ? { conversationId: by.conversationId } : { intentId: by.intentId! };
    this.forgotten.set(sourceKey(source), ++this.forgets);
    if (source.conversationId !== undefined) {
      for (const b of this.queue.dropConversation(userId, source.conversationId)) this.ctx.store.deleteObservationBatch(b.agentId, b.conversationId);
    }
    const run = this.applying.then(async () => {
      const ids = this.ctx.store.contributionsForUser(userId).filter((c) => !c.revokedAt && c.evidence
        && (source.conversationId !== undefined ? c.evidence.conversationId === source.conversationId : c.evidence.intentId === source.intentId))
        .map((c) => c.id);
      await this.card.revokeMany(actor, userId, ids);
      this.ctx.log({ event: "learning.forget", actor, object: source.conversationId !== undefined ? "conversation" : "intent", result: "ok",
        reason: `revoked=${ids.length}` });
      return { revoked: ids.length, contributionIds: ids };
    });
    this.applying = run.catch(() => undefined);
    return run;
  }

  /** POST /demo/reset: nothing queued before a reset is learned after it. */
  reset(): void {
    this.queue.clear();
    this.forgotten.clear();
  }

  /** Everything fired so far has finished (tests, shutdown). Learner calls are bounded by LEARN_TIMEOUT_MS. */
  async settle(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  /**
   * After an intent is created or a quote accepted: append the request to the user's intent history in the memory
   * repo, and (unless paused) learn from it. Both are written by `actor`, the agent that did this operation (B49:
   * the record's agentId, the git author and the contribution writer are the same agent — on an accept, the
   * accepting agent, even when another of the user's agents made the request); the request itself is named by
   * intentId (the record's id, the learned contributions' evidence.intentId), so the intent and its accept are one
   * source however many agents touch it. Fire and forget.
   */
  afterIntent(actor: AuthedAgent, userId: string, intent: IntentRow, chosen?: QuoteRow): void {
    this.track(this.ctx.hold(async () => {
      const epoch = this.epoch(userId);
      const started = this.forgets;
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
        const writer = this.ctx.store.agent(actor.agentId);
        if (!writer || writer.category !== "personal" || !this.stillOn(userId, epoch)) return;
        const candidates = await this.withTimeout(this.learn.extract({ intentId: intent.id, public: intent.public,
          ...(intent.text ? { text: intent.text } : {}), ...(intent.query ? { query: intent.query } : {}), ...(intent.kind ? { kind: intent.kind } : {}),
          ...(chosen ? { chosenQuote: publicQuote(chosen) } : {}) }));
        await this.applySerial({ ...writer, role: "personal" }, userId, candidates, { intentId: intent.id },
          [intent.text ?? "", intent.query ?? ""], epoch, started);
      } catch (err) {
        this.failed(actor.agentId, chosen ? "accept" : "intent", err);
      }
    }));
  }

  /**
   * GET /personal/learned: pref.* on the card and pref.* candidates the user's own agents (and linked assistants, whose
   * observed conversations Dreaming learns from too) produced, with evidence.
   */
  learned(userId: string): LearnedResponse {
    const card = this.card.get(userId);
    const learners = new Set([...this.ctx.store.personalAgentIds(),
      ...this.ctx.store.agents().filter((a) => a.category === "assistant").map((a) => a.agentId)]);
    const mine = this.ctx.store.contributionsForUser(userId).filter((c) => !c.revokedAt && isPrefField(c.field) && learners.has(c.agentId));
    const evidenceFor = (field: string, value: string) => mine.filter((c) => c.field === field && c.value === value)
      .map((c) => ({ contributionId: c.id, agentId: c.agentId, basis: c.basis, createdAt: c.createdAt, ...(c.evidence ?? {}) }));
    const learned: LearnedEntry[] = [];
    const add = (field: string, value: string, status: LearnedEntry["status"], sources: string[]) => {
      if (!isPrefField(field)) return;
      const evidence = evidenceFor(field, value);
      // Merchants cannot write pref.* (their attempts are kept as their own inferred records): not "learned".
      if (evidence.length === 0) return;
      learned.push({ field, value, status, sources: sources.filter((s) => learners.has(s)), evidence });
    };
    for (const f of card.card) add(f.field, f.value, "card", f.sources);
    for (const c of card.candidates) add(c.field, c.value, "candidate", c.sources);
    return { paused: this.state(userId).paused, learned };
  }

  /** GET /personal/intents?q=: the user's own requests, newest first; `q` matches text, query, kind and public values. */
  history(userId: string, q: string | undefined, limit: number): IntentHistoryEntry[] {
    return intentHistory(this.ctx.store, userId, { q, limit });
  }

  // ---- internals

  private track(p: Promise<unknown>): void {
    const safe = p.catch(() => undefined);
    this.pending.add(safe);
    void safe.finally(() => this.pending.delete(safe));
  }

  /** A learner that never answers must not hold a conversation, the reset gate or shutdown hostage. */
  private withTimeout<T>(p: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const t = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new LearnerTimeout()), this.ctx.config.learnTimeoutMs); });
    return Promise.race([p, t]).finally(() => clearTimeout(timer));
  }

  /** One conversation, at most once at a time. The text leaves the queue before LearnApi sees it. Returns contributions written. */
  private process(agentId: string, conversationId: string): Promise<number> {
    const key = `${agentId}\u0000${conversationId}`;
    const running = this.inflight.get(key);
    if (running) return running;
    if (this.inflight.size >= 4) return Promise.resolve(0);
    const run = this.processNow(agentId, conversationId).finally(() => this.inflight.delete(key));
    this.inflight.set(key, run);
    return run;
  }

  private async processNow(agentId: string, conversationId: string): Promise<number> {
    const batch = this.queue.take(agentId, conversationId);
    if (!batch) return 0;
    const { turns } = batch;
    const started = this.forgets;
    try {
      this.ctx.store.deleteObservationBatch(agentId, conversationId);
    } catch (err) {
      this.failed(agentId, "conversation", err);
      return 0;
    }
    const epoch = this.epoch(batch.userId);
    const writer = this.ctx.store.agent(agentId);
    // The user's own agents write as themselves. A company assistant writes as itself too, through write.assistant and
    // only while its consent grant is live (an owner who revoked it is not learned from afterwards).
    const role = writer?.category === "personal" ? "personal" as const
      : writer?.category === "assistant" && this.linked(batch.userId, agentId) ? "assistant" as const : undefined;
    if (!writer || !role || this.state(batch.userId).paused) {
      this.ctx.log({ event: "learn.conversation", actor: agentId, result: "dropped",
        reason: !writer ? "unknown agent" : !role ? (writer.category === "assistant" ? "not linked" : "not a learner") : "paused" });
      return 0;
    }
    if (turns.length === 0) return 0;
    try {
      const userTurns = turns.map((t) => ({ role: "user" as const, text: t.text, at: t.at }));
      const candidates = await this.withTimeout(this.learn.extractFromConversation(userTurns, { conversationId, channel: batch.channel }));
      return await this.applySerial({ ...writer, role }, batch.userId, candidates, { conversationId }, turns.map((t) => t.text), epoch, started);
    } catch (err) {
      this.failed(agentId, "conversation", err);
      return 0;
    }
  }

  /** A company assistant's consent is live (sessions.ts assistState). */
  private linked(userId: string, agentId: string): boolean {
    return !("code" in assistState(this.ctx.store, this.ctx.clock.now(), userId, agentId));
  }

  private applySerial(...args: Parameters<LearningService["apply"]>): Promise<number> {
    const run = this.applying.then(() => this.apply(...args));
    this.applying = run.catch(() => undefined);
    return run;
  }

  /** The source was forgotten after this work started (`started`: the forget counter then). */
  private forgottenSince(source: Source, started: number): boolean {
    return (this.forgotten.get(sourceKey(source)) ?? 0) > started;
  }

  /**
   * Check each candidate and write the survivors as `personal` (a personal agent, or a linked assistant: then the
   * extractor's "stated" is written "observed", since only the user's own agents state facts, and the record goes
   * through write.assistant). `said` is what the user said: a snippet must quote it and name the value. Nothing is
   * written if learning was paused since `epoch` (even if resumed again), the source was forgotten since `started`, or
   * an assistant's consent ended. Returns how many were written. CARD.md is regenerated once at the end.
   */
  private async apply(personal: AuthedAgent, userId: string, raw: unknown, source: Source,
    said: readonly string[], epoch: string, started: number): Promise<number> {
    const live = () => this.stillOn(userId, epoch) && !this.forgottenSince(source, started)
      && (personal.role !== "assistant" || this.linked(userId, personal.agentId));
    if (!live()) {
      this.ctx.log({ event: "learn.apply", actor: personal.agentId, object: source.intentId ?? "conversation", result: "dropped",
        reason: !this.stillOn(userId, epoch) ? "paused" : this.forgottenSince(source, started) ? "forgotten" : "not linked" });
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
      if (this.ctx.store.setting(userId, this.suppressedKey(userId, field, value))) { skip("forgotten"); continue; }
      const same = (x: StoredContribution) => x.field === field && norm(x.value) === norm(value);
      // One spelling per value: a later "brooks" joins the existing "Brooks", so sources add up.
      value = existing.find((x) => same(x) && !x.revokedAt)?.value ?? value;
      // B49: the extractor's basis is kept (stated reaches the card on its own); anything unknown is "observed".
      const extracted: Basis = typeof c.basis === "string" && BASES.has(c.basis) ? c.basis : "observed";
      const basis: Basis = personal.role !== "personal" && extracted === "stated" ? "observed" : extracted;
      if (existing.some((x) => same(x) && x.revokedAt)) { skip("revoked"); continue; }
      // One record per value per source: the same conversation (or intent) repeating itself is one source, whoever
      // wrote it; a different conversation is new evidence, however recent the last one.
      const sameSource = (x: StoredContribution) => (x.evidence?.conversationId ?? "") === (source.conversationId ?? "")
        && (x.evidence?.intentId ?? "") === (source.intentId ?? "");
      if (existing.some((x) => same(x) && !x.revokedAt && sameSource(x) && BASIS_RANK[x.basis] >= BASIS_RANK[basis])) { skip("duplicate"); continue; }
      const evidence: ContributionEvidence = { ...source };
      // B60: which models produced it (gate, extractor), when the learner says and the ids are well-formed.
      const models = evidenceModels(c.evidence?.models);
      if (models) evidence.models = models;
      const snippet = typeof c.evidence?.snippet === "string" ? [...c.evidence.snippet.trim()].slice(0, EVIDENCE_SNIPPET_MAX).join("") : "";
      // A snippet is kept only if the user said it, it names the value, and it carries no contact or payment data.
      if (snippet && heard.includes(norm(snippet)) && norm(snippet).includes(norm(value)) && !containsContactOrPayment(snippet)) {
        evidence.snippet = snippet;
      }
      if (!live()) break;
      const { contribution } = await this.card.record(personal, userId, { field, value, basis, evidence }, { regenerate: false, canWrite: live });
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
  const { sessionId: _s, status: _st, createdAt: _c, acceptedAt: _a, result: _r, seq: _q, ...quote } = q;
  return quote;
}

/** What SQLite keeps of a waiting conversation: ids, count and times, never the text. */
function mirror(b: QueuedConversation) {
  return { agentId: b.agentId, conversationId: b.conversationId, userId: b.userId, channel: b.channel, turnsSeen: b.turnsSeen,
    firstAt: new Date(b.firstAt).toISOString(), lastAt: new Date(b.lastAt).toISOString() };
}
