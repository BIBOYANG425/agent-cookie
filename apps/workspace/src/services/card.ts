// Identity card: contributions → RulesApi.mergeCard. Recomputed on every read so time rules (180/365 days)
// follow the workspace clock; cached in SQLite and written through to CARD.md.
import {
  allowedBases, isField, isPrefField, purposeFields,
  type Basis, type Card, type Contribution, type ContributionEvidence, type Field, type MergeOptions,
} from "@agent-cookie/contract";
import type { IntentRow, StoredContribution } from "../db.js";
import { containsCardNumber, isTokenReference, prefValueProblem } from "../guards.js";
import { fail, type AuthedAgent } from "../http.js";
import { newId } from "../ids.js";
import { persist, persistStrict, writeMeta, type Ctx } from "./context.js";
import { forRepo, withoutModels } from "./provenance.js";

/** Fields an intent may override for its merchants ("intent 字段遮盖 card 字段"). Purpose fields never travel in an intent. */
const PURPOSE_ANYWHERE = new Set<Field>([...purposeFields("shoe"), "shipping_address", "payment_method"]);
export function overridable(field: string): field is Field {
  return isField(field) && !PURPOSE_ANYWHERE.has(field);
}

export class CardService {
  private mutation: Promise<unknown> = Promise.resolve();
  constructor(private ctx: Ctx) {}

  /** Serializes contribution writes and forget projection, including awaits in the Git write. */
  mutate<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.mutation.then(fn);
    this.mutation = run.catch(() => undefined);
    return run;
  }

  get(userId: string): Card {
    const card = this.compute(userId, this.ctx.clock.nowIso());
    this.ctx.store.saveCard(userId, card, this.ctx.clock.nowIso());
    return card;
  }

  /**
   * The card at `now` (Dreaming passes its own explicit time). Evidence travels with each contribution:
   * RulesApi.mergeCard counts learned sources per conversation / intent (lane C, B49) and applies the age rules; the
   * workspace does no source counting of its own.
   */
  compute(userId: string, now: string): Card {
    const all = this.ctx.store.contributionsForUser(userId).filter((c): c is Contribution => isField(c.field)).map(withoutModels);
    const merged = this.ctx.rules.mergeCard(all, { now, personalAgentIds: this.ctx.store.personalAgentIds() });
    // B20: any card value resting on Sample seed data makes the card "sample"; clients label it Sample.
    const seed = this.ctx.store.seedContributions(userId);
    const sample = merged.card.some((f) => seed.some((c) => c.field === f.field && c.value === f.value && f.sources.includes(c.agentId)));
    return { ...merged, source: sample ? "sample" : "live" };
  }

  /** Card values, overlaid with the public values of the intent (budget, deadline… never purpose fields). */
  values(userId: string, intentOrId?: string | IntentRow): Partial<Record<Field, string>> {
    const out: Partial<Record<Field, string>> = {};
    for (const f of this.get(userId).card) out[f.field] = f.value;
    if (intentOrId) {
      const intent = typeof intentOrId === "string" ? this.ctx.store.intent(intentOrId) : intentOrId;
      if (intent && intent.userId === userId) {
        for (const [k, v] of Object.entries(intent.public)) if (overridable(k) && typeof v === "string" && v !== "") out[k] = v;
        // A size, brand or color stated in this request is this intent's shoe_size / pref.brand / pref.color.
        for (const [k, f] of [["size", "shoe_size"], ["brand", "pref.brand"], ["color", "pref.color"]] as const) {
          const v = intent.public[k];
          if (typeof v === "string" && v !== "" && !intent.public[f]) out[f] = v;
        }
      }
    }
    return out;
  }

  /**
   * Record a contribution. Personal agents state facts. A merchant writing a field its category may not write,
   * an unknown field, or a basis it may not use, is stored as its own "inferred" record: never on the card,
   * never visible to anyone else (A11). Model-supplied basis/field are parameters, not authority.
   */
  record(agent: AuthedAgent, userId: string, input: { field: string; value: string; basis: Basis; evidence?: ContributionEvidence },
    opts: { regenerate?: boolean; canWrite?: () => boolean } = {}): Promise<{ stored: Basis; contribution: StoredContribution }> {
    return this.mutate(() => this.recordNow(agent, userId, input, opts));
  }
  private async recordNow(agent: AuthedAgent, userId: string, input: { field: string; value: string; basis: Basis; evidence?: ContributionEvidence },
    opts: { regenerate?: boolean; canWrite?: () => boolean } = {}): Promise<{ stored: Basis; contribution: StoredContribution }> {
    if (opts.canWrite && !opts.canWrite()) fail("SCOPE_DENIED", "Learning operation superseded");
    if (containsCardNumber(input.value)) fail("MISSING_FIELD", "card numbers are never stored");
    if (input.field === "payment_method" && !isTokenReference(input.value)) fail("MISSING_FIELD", "payment_method must be a provider token reference");
    if (isPrefField(input.field)) {
      const problem = prefValueProblem(input.value);
      if (problem) fail("MISSING_FIELD", problem);
    }
    let basis: Basis = input.basis;
    if (agent.role === "personal") {
      if (!isField(input.field)) fail("MISSING_FIELD", "unknown field");
    } else if (!isField(input.field) || !this.ctx.policy.canWrite(agent.category, input.field) || !(allowedBases(agent.category) as readonly Basis[]).includes(basis)) {
      basis = "inferred";
    }
    const c: StoredContribution = { id: newId("c"), userId, agentId: agent.agentId, field: input.field, value: input.value, basis, createdAt: this.ctx.clock.nowIso() };
    if (input.evidence && Object.keys(input.evidence).length > 0) c.evidence = input.evidence;
    // Git first: an HTTP success always means the record is in the memory repo (unknown field names stay SQLite-only, A11).
    if (isField(c.field)) {
      await persistStrict(this.ctx, "contribution", agent.agentId, (r) => { const line = forRepo(this.ctx.rules, c) as Contribution; return r.appendContribution(line, writeMeta(this.ctx, agent.agentId, line)); });
    }
    this.ctx.store.insertContribution(c);
    this.ctx.log({ event: "contribution.add", actor: agent.agentId, object: c.id, result: basis, reason: isField(c.field) ? c.field : "unknown_field" });
    if (isField(c.field) && opts.regenerate !== false) await this.regenerate(agent.agentId);
    return { stored: basis, contribution: c };
  }

  revoke(actor: string, userId: string, id: string): Promise<Card> {
    return this.mutate(() => this.revokeNow(actor, userId, id));
  }
  private async revokeNow(actor: string, userId: string, id: string): Promise<Card> {
    const c = this.ctx.store.contribution(id);
    if (!c || c.userId !== userId) fail("NOT_FOUND");
    const at = this.ctx.clock.nowIso();
    if (isField(c.field)) {
      await persistStrict(this.ctx, "contribution.revoke", actor, (r) => r.revokeContribution(id, at, writeMeta(this.ctx, actor, { id, at })));
    }
    this.ctx.store.revokeContribution(id, at);
    this.ctx.log({ event: "contribution.revoke", actor, object: id, result: "ok" });
    await this.regenerate(actor);
    return this.get(userId);
  }

  /**
   * Revoke several contributions as one act (forget, B49): one memory-repo commit that also rewrites CARD.md
   * (MemoryRepo.revokeContributions), then one SQLite transaction. Until lane C ships revokeContributions: one
   * revokeContribution per id, then one CARD.md regeneration. Git first, as for a single revoke.
   */
  revokeMany(actor: string, userId: string, ids: readonly string[]): Promise<void> {
    return this.mutate(() => this.revokeManyNow(actor, userId, ids));
  }
  private async revokeManyNow(actor: string, userId: string, ids: readonly string[]): Promise<void> {
    const mine = ids.map((id) => this.ctx.store.contribution(id)).filter((c): c is StoredContribution => !!c && c.userId === userId && !c.revokedAt);
    if (mine.length === 0) return;
    const at = this.ctx.clock.nowIso();
    const inRepo = mine.filter((c) => isField(c.field)).map((c) => c.id);
    let regenerated = false;
    if (inRepo.length > 0) {
      await persistStrict(this.ctx, "contribution.revoke", actor, async (r) => {
        const meta = writeMeta(this.ctx, actor, { ids: inRepo, at });
        if (r.revokeContributions) {
          await r.revokeContributions(inRepo, at, this.mergeOptions(), meta);
          regenerated = true;
        } else {
          for (const id of inRepo) await r.revokeContribution(id, at, meta);
        }
      });
    }
    this.ctx.store.tx(() => { for (const c of mine) this.ctx.store.revokeContribution(c.id, at); });
    this.ctx.log({ event: "contribution.revoke", actor, object: mine.length === 1 ? mine[0]!.id : "batch", result: "ok", reason: `revoked=${mine.length}` });
    if (!regenerated) await this.regenerate(actor);
  }

  /** Regenerate CARD.md once after a batch of records written with `regenerate: false`. */
  regenerateNow(actor: string): Promise<void> {
    return this.regenerate(actor);
  }

  private async regenerate(actor: string): Promise<void> {
    await persist(this.ctx, "card", actor, (r) => r.regenerateCard(this.mergeOptions(),
      writeMeta(this.ctx, "workspace", { regenerate: this.ctx.clock.nowIso() })));
  }

  private mergeOptions(): MergeOptions {
    return { now: this.ctx.clock.nowIso(), personalAgentIds: this.ctx.store.personalAgentIds() };
  }
}
