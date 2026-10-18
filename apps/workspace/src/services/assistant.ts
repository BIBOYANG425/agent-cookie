// Company assistants (bring-your-own-agent plan; contract types.ts Category "assistant"). A Manus, Dots or Muse acts
// for the user through a pairwise session the OWNER approved (services/links.ts). What it may know is decided here,
// in code: the installed document's auto.assistant fields that its live assist grant covers, as values, without
// provenance, and NEVER shipping_address or payment_method, whatever any document says (the hard refusal below; the
// contract floor says the same, this does not rely on it). The workspace hands those two to the merchant at checkout
// and payment, with receipts, as it does for the user's own agents; the assistant orchestrates and never carries them.
import type { AssistantContext, AssistantStats, Basis, Field, Receipt } from "@agent-cookie/contract";
import type { StoredContribution } from "../db.js";
import { fail, type AuthedAgent } from "../http.js";
import { newId } from "../ids.js";
import { questionsSkipped } from "./analytics.js";
import type { CardService } from "./card.js";
import { persistStrict, writeMeta, type Ctx } from "./context.js";
import type { SessionService } from "./sessions.js";

/** The purpose of an assistant's consent grant and of the receipts its context reads write. */
export const ASSIST_PURPOSE = "assist";

/** Never read, listed or written by an assistant, independent of the installed document (mirrors fields.ts for the token). */
export const ASSISTANT_NEVER: ReadonlySet<string> = new Set<Field>(["shipping_address", "payment_method"]);

export function assistantSafe(fields: readonly Field[]): Field[] {
  return fields.filter((f) => !ASSISTANT_NEVER.has(f));
}

/**
 * Receipt de-duplication for GET /assistant/context. A chat reads its context on every message and every receipt is a
 * git commit, so: a read writes NO new receipt when the newest assist receipt of the same session named exactly the
 * same field set, under the same policy document, less than ASSIST_RECEIPT_DEDUPE_MS ago (workspace clock); any other
 * read writes one. A read that serves no value writes none (nothing was released). The `assist.context` activity event
 * (counts only) is written on every read, deduplicated or not.
 */
export const ASSIST_RECEIPT_DEDUPE_MS = 60 * 60 * 1000;

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

export class AssistantService {
  /** Receipt decisions run one at a time, so two reads at once cannot both decide "no recent receipt". */
  private serial: Promise<unknown> = Promise.resolve();

  constructor(private ctx: Ctx, private sessions: SessionService, private card: CardService) {}

  /**
   * GET /assistant/context. Needs a live assist grant (SessionService.assistAccess). `fields` = values of the installed
   * document's auto.assistant fields that the live grant covers and the card has; `unknown` = the rest of that list;
   * `writable` = write.assistant. A field the document gained after approval needs a new link (the grant is the
   * consent); a field it lost is not served at once. Card values only: no intent overlay, no provenance.
   */
  async context(agent: AuthedAgent, userId: string): Promise<AssistantContext> {
    const { session, grant, live } = this.sessions.assistAccess(agent, userId);
    const policy = this.ctx.policy;
    const granted = new Set(live.flatMap((g) => g.fields));
    const readable = assistantSafe(policy.autoFields("assistant")).filter((f) => granted.has(f));
    const values = this.card.values(userId);
    const fields: Partial<Record<Field, string>> = {};
    const unknown: Field[] = [];
    for (const f of readable) {
      const v = values[f];
      if (v !== undefined && v !== "") fields[f] = v;
      else unknown.push(f);
    }
    const served = Object.keys(fields) as Field[];
    const receipt = await this.receipt(agent, userId, session.sessionId, served);
    this.ctx.log({ event: "assist.context", actor: agent.agentId, object: session.sessionId, result: "ok",
      reason: `served=${served.length} unknown=${unknown.length} receipt=${receipt}` });
    return { v: 1, sessionId: session.sessionId, policyId: policy.id(), fields, unknown, writable: assistantSafe(policy.writeFields("assistant")),
      expiresAt: grant.expiresAt };
  }

  /** "每次放行写回执" with the de-duplication rule above. Git first, then SQLite: no durable receipt, no values. */
  private receipt(agent: AuthedAgent, userId: string, sessionId: string, served: Field[]): Promise<"written" | "deduped" | "none"> {
    const run = this.serial.then(async () => {
      if (served.length === 0) return "none" as const;
      const policyId = this.ctx.policy.id();
      const last = this.ctx.store.lastReceipt(sessionId, ASSIST_PURPOSE);
      if (last && last.policyId === policyId && sameSet(last.fields, served)) {
        const age = this.ctx.clock.now() - Date.parse(last.createdAt);
        if (age >= 0 && age < ASSIST_RECEIPT_DEDUPE_MS) return "deduped" as const;
      }
      const r: Receipt = { id: newId("r"), sessionId, agentId: agent.agentId, fields: served, purpose: ASSIST_PURPOSE,
        createdAt: this.ctx.clock.nowIso(), policyId };
      await persistStrict(this.ctx, "receipt", agent.agentId, (repo) => repo.appendReceipt(r, writeMeta(this.ctx, "workspace", r)));
      this.ctx.store.insertReceipt({ ...r, userId });
      return "written" as const;
    });
    this.serial = run.catch(() => undefined);
    return run;
  }

  /**
   * POST /assistant/contributions: the merchant write path (CardService.record) evaluated for category "assistant"
   * (write.assistant of the installed document, observed basis only): a field it may not write, an unknown field or
   * another basis is kept as its own "inferred" record, never on the card (A11). shipping_address and payment_method
   * are refused outright (403 SCOPE_DENIED), whatever the document says: an assistant never carries them.
   */
  async contribute(agent: AuthedAgent, userId: string, input: { field: string; value: string; basis: Basis }, sessionId?: string):
    Promise<{ stored: Basis; contribution: StoredContribution }> {
    const { session } = this.sessions.assistAccess(agent, userId);
    if (sessionId !== undefined && sessionId !== session.sessionId) fail("NOT_FOUND");
    if (ASSISTANT_NEVER.has(input.field)) {
      this.ctx.log({ event: "assist.contribution", actor: agent.agentId, object: session.sessionId, result: "SCOPE_DENIED", reason: input.field });
      fail("SCOPE_DENIED");
    }
    return this.card.record({ ...agent, category: "assistant", role: "assistant" }, userId, input);
  }

  /** GET /assistant/stats: counts over the intents this assistant created, nothing else. */
  stats(agentId: string, userId: string): AssistantStats {
    const s = { intents: 0, quoted: 0, accepted: 0, completed: 0, questionsSkipped: 0 };
    for (const i of this.ctx.store.intentsCreatedBy(userId, agentId)) {
      s.intents++;
      const quotes = this.ctx.store.quotesForIntent(i.id);
      if (quotes.length > 0) s.quoted++;
      // An accept the gate blocked (expired offer, revoked merchant) never marks the quote accepted: not an accept.
      const chosen = quotes.filter((q) => q.acceptedAt !== undefined);
      if (chosen.length > 0) s.accepted++;
      if (chosen.some((q) => q.result?.status === "ordered" || q.result?.status === "handoff")) s.completed++;
      s.questionsSkipped += questionsSkipped(this.ctx.store.receiptsForIntent(i.id));
    }
    return { ...s, generatedAt: this.ctx.clock.nowIso() };
  }
}
