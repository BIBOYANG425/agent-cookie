// Dreaming (2026-10-18, human direction; plan §规模与时间规则 "Dreaming 定期把其余移到 archive/"). One periodic job,
// outside every request path, that does the work writes do not:
//   a) learn — every observed conversation that is due (quiet OBSERVATION_IDLE_MS or OBSERVATION_BATCH_TURNS turns)
//      goes to LearnApi.extractFromConversation; the result is written as the personal agent (learning.ts);
//   b) regenerate — the card at an explicit `now` (age decay: 180 days → medium, 365 → off), CARD.md with it;
//   c) compact — per field the current value plus the DREAMING_KEEP_SUPERSEDED most recent superseded values stay in
//      contributions/, older ones move to archive/<YYYY-MM>.md (MemoryRepo.compact, lane C); SQLite mirrors the move;
//   d) log — one activity event, kind "dreaming", with counts only.
// A failing step is logged and the next step still runs; nothing here ever fails a request. It reads no stored
// conversation text (there is none: (a) takes what waits in memory, B49), does not touch merchants' notes, grants or
// sessions, and writes still regenerate the card at once on their own. Runs never overlap; memory-repo writes go
// through the repo's own per-repository queue, the same one every contribution write uses, so a run and concurrent
// writes never commit at the same time.
import {
  DREAMING_AUTHOR, DREAMING_KEEP_SUPERSEDED, FIELDS, isField,
  type Card, type Contribution, type DreamingRun, type DreamingStats, type DreamingStepName, type Field,
} from "@agent-cookie/contract";
import type { CardService } from "./services/card.js";
import { writeMeta, type Ctx } from "./services/context.js";
import type { LearningService } from "./services/learning.js";

const DAY_MS = 86_400_000;

export class Dreaming {
  private running: Promise<DreamingRun> | undefined;
  private pending = new Set<Promise<unknown>>();

  constructor(private ctx: Ctx, private card: CardService, private learning: LearningService) {}

  /** One run at `now` (default: the workspace clock). A call while a run is in flight gets that run. */
  run(now?: string): Promise<DreamingRun> {
    if (this.running) return this.running;
    const run = this.runNow(now ?? this.ctx.clock.nowIso()).finally(() => { this.running = undefined; });
    this.running = run;
    return run;
  }

  /** The scheduler's entry point (deps.ts): one run through `runner` (the reset gate), counted by settle(). */
  tick(runner: (fn: () => Promise<DreamingRun>) => Promise<DreamingRun>): void {
    const p = runner(() => this.run()).catch(() => undefined);
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p));
  }

  /** Every scheduled run has finished (shutdown, tests). */
  async settle(): Promise<void> {
    while (this.pending.size > 0 || this.running) await Promise.allSettled([...this.pending, ...(this.running ? [this.running] : [])]);
  }

  private async runNow(now: string): Promise<DreamingRun> {
    const user = this.ctx.store.firstUser();
    const stats: DreamingStats = { learned: 0, promoted: 0, decayed: 0, archived: 0 };
    const steps: DreamingRun["steps"] = [];
    let decayedFields: Field[] = [];
    const step = async (name: DreamingStepName, fn: () => Promise<"ok" | "skipped" | { skipped: string }>) => {
      try {
        const r = await fn();
        steps.push(typeof r === "string" ? { step: name, result: r } : { step: name, result: "skipped", reason: r.skipped });
      } catch (err) {
        const reason = err instanceof Error ? err.name : "error";
        steps.push({ step: name, result: "failed", reason });
        if (!this.ctx.stale()) this.ctx.log({ event: "dreaming.step", actor: DREAMING_AUTHOR, object: name, result: "failed", reason, kind: "dreaming" });
      }
    };
    if (!user) return { at: now, stats, decayedFields, steps };
    const userId = user.userId;
    const opts = () => ({ now, personalAgentIds: this.ctx.store.personalAgentIds() });
    const entries = (c: Card) => new Set(c.card.map((f) => `${f.field}\u0000${f.value}`));
    let before: Set<string> | undefined;
    try {
      before = entries(this.card.compute(userId, now));
    } catch {
      before = undefined;
    }

    await step("learn", async () => {
      stats.learned = (await this.learning.flushDue(Date.parse(now))).learned;
      return "ok";
    });

    await step("regenerate", async () => {
      const card = this.card.compute(userId, now);
      if (before) stats.promoted = [...entries(card)].filter((e) => !before!.has(e)).length;
      decayedFields = card.decayed ?? this.decayedFallback(userId, card, now);
      stats.decayed = decayedFields.length;
      this.ctx.store.saveCard(userId, card, now);
      await this.ctx.repo().regenerateCard(opts(), writeMeta(this.ctx, DREAMING_AUTHOR, { dreaming: now, step: "regenerate" }));
      return "ok";
    });

    await step("compact", async () => {
      const repo = this.ctx.repo();
      if (!repo.compact) return { skipped: "memory repo has no compact yet" };
      const r = await repo.compact({ ...opts(), keepSuperseded: DREAMING_KEEP_SUPERSEDED },
        writeMeta(this.ctx, DREAMING_AUTHOR, { dreaming: now, step: "compact" }));
      stats.archived = r.archived;
      if (r.archivedIds.length > 0) this.ctx.store.markArchived(r.archivedIds, now);
      return "ok";
    });

    await step("log", async () => {
      const failed = steps.filter((s) => s.result === "failed").map((s) => s.step);
      const skipped = steps.filter((s) => s.result === "skipped").map((s) => s.step);
      if (this.ctx.stale()) return "skipped";
      this.ctx.log({ event: "dreaming", actor: DREAMING_AUTHOR, result: failed.length ? "partial" : "ok", kind: "dreaming", stats: { ...stats },
        reason: [failed.length ? `failed=${failed.join(",")}` : "", skipped.length ? `skipped=${skipped.join(",")}` : "",
          decayedFields.length ? `decayed=${decayedFields.join(",")}` : ""].filter(Boolean).join(" ") });
      return "ok";
    });
    return { at: now, stats, decayedFields, steps };
  }

  /**
   * Card.decayed until RulesApi.mergeCard fills it (lane C): ask the same rules at the moment the field was last
   * supported. A field that was high then and is medium now, or that was on the card then and is gone now, is held
   * back by age alone (nothing newer superseded it, so only time changed).
   */
  private decayedFallback(userId: string, card: Card, now: string): Field[] {
    const all = this.ctx.store.contributionsForUser(userId).filter((c): c is Contribution => isField(c.field) && !c.revokedAt);
    const personalAgentIds = this.ctx.store.personalAgentIds();
    const nowMs = Date.parse(now);
    const at = new Map<string, Card>();
    const cardAt = (iso: string) => {
      if (!at.has(iso)) at.set(iso, this.ctx.rules.mergeCard(all, { now: iso, personalAgentIds }));
      return at.get(iso)!;
    };
    const out: Field[] = [];
    for (const field of FIELDS) {
      const current = card.card.find((f) => f.field === field);
      if (current) {
        if (current.confidence === "medium" && nowMs - Date.parse(current.lastSupportedAt) > 180 * DAY_MS
          && cardAt(current.lastSupportedAt).card.find((f) => f.field === field && f.value === current.value)?.confidence === "high") out.push(field);
        continue;
      }
      const support = all.filter((c) => c.field === field && c.basis !== "inferred").map((c) => c.createdAt).sort();
      const last = support.at(-1);
      if (last && nowMs - Date.parse(last) > 365 * DAY_MS && cardAt(last).card.some((f) => f.field === field)) out.push(field);
    }
    return out;
  }
}
