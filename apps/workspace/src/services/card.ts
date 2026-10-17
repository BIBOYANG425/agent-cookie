// Identity card: contributions → RulesApi.mergeCard. Recomputed on every read so time rules (180/365 days)
// follow the workspace clock; cached in SQLite and written through to CARD.md.
import {
  allowedBases, canWrite, isField, purposeFields, type Basis, type Card, type Contribution, type Field,
} from "@agent-cookie/contract";
import type { StoredContribution } from "../db.js";
import { fail, type AuthedAgent } from "../http.js";
import { newId } from "../ids.js";
import { persist, writeMeta, type Ctx } from "./context.js";

/** Fields an intent may override for its merchants ("intent 字段遮盖 card 字段"). Purpose fields never travel in an intent. */
const PURPOSE_ANYWHERE = new Set<Field>([...purposeFields("shoe"), "shipping_address", "payment_method"]);
export function overridable(field: string): field is Field {
  return isField(field) && !PURPOSE_ANYWHERE.has(field);
}

export class CardService {
  constructor(private ctx: Ctx) {}

  get(userId: string): Card {
    const all = this.ctx.store.contributionsForUser(userId).filter((c): c is Contribution => isField(c.field));
    const card = this.ctx.rules.mergeCard(all, { now: this.ctx.clock.nowIso(), personalAgentIds: this.ctx.store.personalAgentIds() });
    this.ctx.store.saveCard(userId, card, this.ctx.clock.nowIso());
    return card;
  }

  /** Card values, overlaid with the public values of `intentId` (budget, deadline… never purpose fields). */
  values(userId: string, intentId?: string): Partial<Record<Field, string>> {
    const out: Partial<Record<Field, string>> = {};
    for (const f of this.get(userId).card) out[f.field] = f.value;
    if (intentId) {
      const intent = this.ctx.store.intent(intentId);
      if (intent && intent.userId === userId) {
        for (const [k, v] of Object.entries(intent.public)) if (overridable(k) && typeof v === "string" && v !== "") out[k] = v;
      }
    }
    return out;
  }

  /**
   * Record a contribution. Personal agents state facts. A merchant writing a field its category may not write,
   * an unknown field, or a basis it may not use, is stored as its own "inferred" record: never on the card,
   * never visible to anyone else (A11). Model-supplied basis/field are parameters, not authority.
   */
  async record(agent: AuthedAgent, userId: string, input: { field: string; value: string; basis: Basis }): Promise<{ stored: Basis; contribution: StoredContribution }> {
    let basis: Basis = input.basis;
    if (agent.role === "personal") {
      if (!isField(input.field)) fail("MISSING_FIELD", "unknown field");
    } else if (!isField(input.field) || !canWrite(agent.category, input.field) || !(allowedBases(agent.category) as readonly Basis[]).includes(basis)) {
      basis = "inferred";
    }
    const c: StoredContribution = { id: newId("c"), userId, agentId: agent.agentId, field: input.field, value: input.value, basis, createdAt: this.ctx.clock.nowIso() };
    this.ctx.store.insertContribution(c);
    this.ctx.log({ event: "contribution.add", actor: agent.agentId, object: c.id, result: basis, reason: isField(c.field) ? c.field : "unknown_field" });
    if (isField(c.field)) {
      await persist(this.ctx, "contribution", agent.agentId, (r) => r.appendContribution(c as Contribution, writeMeta(this.ctx, agent.agentId, c)));
      await this.regenerate(agent.agentId);
    }
    return { stored: basis, contribution: c };
  }

  async revoke(actor: string, userId: string, id: string): Promise<Card> {
    const c = this.ctx.store.contribution(id);
    if (!c || c.userId !== userId) fail("NOT_FOUND");
    const at = this.ctx.clock.nowIso();
    this.ctx.store.revokeContribution(id, at);
    this.ctx.log({ event: "contribution.revoke", actor, object: id, result: "ok" });
    await persist(this.ctx, "contribution.revoke", actor, (r) => r.revokeContribution(id, at, writeMeta(this.ctx, actor, { id, at })));
    await this.regenerate(actor);
    return this.get(userId);
  }

  private async regenerate(actor: string): Promise<void> {
    await persist(this.ctx, "card", actor, (r) => r.regenerateCard(
      { now: this.ctx.clock.nowIso(), personalAgentIds: this.ctx.store.personalAgentIds() },
      writeMeta(this.ctx, "workspace", { regenerate: this.ctx.clock.nowIso() })));
  }
}
