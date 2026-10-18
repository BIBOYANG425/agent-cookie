// Company assistants (bring-your-own-agent plan; contract types.ts Category "assistant"). A Manus, Dots or Muse acts
// for the user through a pairwise session the OWNER approved (services/links.ts). What it may know is decided here,
// in code: the installed document's auto.assistant fields that its live assist grant covers, as values, without
// provenance, and NEVER shipping_address or payment_method, whatever any document says (the hard refusal below; the
// contract floor says the same, this does not rely on it). The workspace hands those two to the merchant at checkout
// and payment, with receipts, as it does for the user's own agents; the assistant orchestrates and never carries them.
import {
  EVIDENCE_SNIPPET_MAX,
  type AssistantContext, type AssistantContributionInput, type AssistantHistoryResponse, type AssistantStats, type Basis, type Field, type Receipt,
} from "@agent-cookie/contract";
import type { StoredContribution } from "../db.js";
import { containsContactOrPayment, looksLikeContactHandle } from "../guards.js";
import { fail, type AuthedAgent } from "../http.js";
import { newId } from "../ids.js";
import { questionsSkipped } from "./analytics.js";
import type { CardService } from "./card.js";
import type { Ctx } from "./context.js";
import { intentHistory } from "./learning.js";
import { RECEIPT_DEDUPE_MS, ReceiptWriter, type ReceiptOutcome } from "./receipts.js";
import type { SessionService } from "./sessions.js";

/** The purpose of an assistant's consent grant and of the receipts its context reads write. */
export const ASSIST_PURPOSE = "assist";

/** Never read, listed or written by an assistant, independent of the installed document (mirrors fields.ts for the token). */
export const ASSISTANT_NEVER: ReadonlySet<string> = new Set<Field>(["shipping_address", "payment_method"]);

export function assistantSafe(fields: readonly Field[]): Field[] {
  return fields.filter((f) => !ASSISTANT_NEVER.has(f));
}

/**
 * Receipt de-duplication for GET /assistant/context (services/receipts.ts, the rule merchants' auto reads follow too). A
 * chat reads its context on every message and every receipt is a git commit, so: a read writes NO new receipt when the
 * newest assist receipt of the same session named exactly the same field set, under the same policy document, less
 * than ASSIST_RECEIPT_DEDUPE_MS ago (workspace clock); any other read writes one. A read that serves no value writes
 * none (nothing was released). The `assist.context` activity event (counts only) is written on every read,
 * deduplicated or not.
 */
export const ASSIST_RECEIPT_DEDUPE_MS = RECEIPT_DEDUPE_MS;

/**
 * The purpose of the receipt an assistant's read of the intent history writes (GET /assistant/history). It names no
 * field (fields []) and no intent, so it counts toward no FunnelRow and never changes questionsSkipped. De-duplicated
 * like the context read: none when the newest history receipt of the same session is under the same policy document
 * and less than RECEIPT_DEDUPE_MS old.
 */
export const HISTORY_PURPOSE = "history";

export type AssistantEvidence = NonNullable<AssistantContributionInput["evidence"]>;

/**
 * The `evidence` of POST /assistant/contributions, or 422: exactly { conversationId, snippet }. conversationId is opaque
 * (at most 128 bytes, never a phone number or email, as for observations); snippet is the user's own words, 1 to
 * EVIDENCE_SNIPPET_MAX characters after trimming, without contact or payment data (the rule learned evidence follows).
 */
export function assistantEvidence(raw: unknown): AssistantEvidence | undefined {
  if (raw === undefined || raw === null) return undefined;
  const bad = (why: string): never => fail("MISSING_FIELD", `evidence ${why}`);
  if (typeof raw !== "object" || Array.isArray(raw)) bad("must be { conversationId, snippet }");
  const e = raw as Record<string, unknown>;
  if (Object.keys(e).some((k) => k !== "conversationId" && k !== "snippet")) bad("takes conversationId and snippet only");
  const { conversationId, snippet } = e;
  if (typeof conversationId !== "string" || conversationId.trim() === "" || Buffer.byteLength(conversationId, "utf8") > 128) {
    bad("needs a conversationId of at most 128 bytes");
  }
  if (looksLikeContactHandle(conversationId as string)) bad("conversationId must be opaque, not a phone number or email");
  const words = typeof snippet === "string" ? snippet.trim() : "";
  const n = [...words].length;
  if (n < 1 || n > EVIDENCE_SNIPPET_MAX) bad(`needs a snippet of 1–${EVIDENCE_SNIPPET_MAX} characters`);
  if (containsContactOrPayment(words)) bad("snippet may not carry contact or payment data");
  return { conversationId: conversationId as string, snippet: words };
}

export class AssistantService {
  /** Receipt decisions run one at a time, so two reads at once cannot both decide "no recent receipt". */
  private readonly receipts: ReceiptWriter;

  constructor(private ctx: Ctx, private sessions: SessionService, private card: CardService) {
    this.receipts = new ReceiptWriter(ctx);
  }

  /**
   * GET /assistant/context. Needs a live assist grant (SessionService.assistAccess): the grant proves the owner linked
   * this assistant, and its expiry or revocation gates access. What is served is decided at read time by the INSTALLED
   * document, not by the grant's stored field list: `fields` = values of auto.assistant (minus the two never-fields)
   * that the card has, `unknown` = the rest of that list, `writable` = write.assistant. A field the owner adds to
   * auto.assistant is served on the next read; a removed one stops at once. Card values only: no intent overlay, no
   * provenance, and candidates are never served.
   */
  async context(agent: AuthedAgent, userId: string): Promise<AssistantContext> {
    const { session, grant } = this.sessions.assistAccess(agent, userId);
    const policy = this.ctx.policy;
    const readable = assistantSafe(policy.autoFields("assistant"));
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

  /**
   * GET /assistant/history: the person's intent and purchase history (every intent, whoever created it), newest first,
   * as GET /personal/intents builds it, minus the user's own words (`text`, `query`). No card value is added. Needs the
   * live assist grant, then the INSTALLED document's history.assistant, decided at read time (else 403 SCOPE_DENIED).
   * Every allowed read is receipted (purpose history, fields []), at most once per session per hour and policy
   * document; the entries are released only after the receipt resolved. Logged as counts only.
   */
  async history(agent: AuthedAgent, userId: string, limit: number): Promise<AssistantHistoryResponse> {
    const { session } = this.sessions.assistAccess(agent, userId);
    if (!this.ctx.policy.history("assistant")) {
      this.ctx.log({ event: "assist.history", actor: agent.agentId, object: session.sessionId, result: "SCOPE_DENIED", reason: `policy=${this.ctx.policy.id()}` });
      fail("SCOPE_DENIED");
    }
    const intents = intentHistory(this.ctx.store, userId, { limit }).map(({ text: _t, query: _q, ...e }) => e);
    const r: Receipt = { id: newId("r"), sessionId: session.sessionId, agentId: agent.agentId, fields: [], purpose: HISTORY_PURPOSE,
      createdAt: this.ctx.clock.nowIso(), policyId: this.ctx.policy.id() };
    const receipt = await this.receipts.write(r, userId, agent.agentId, { dedupe: true, allowEmpty: true });
    this.ctx.log({ event: "assist.history", actor: agent.agentId, object: session.sessionId, result: "ok",
      reason: `intents=${intents.length} receipt=${receipt}` });
    return { intents };
  }

  /** "每次放行写回执" with the de-duplication rule above. Git first, then SQLite: no durable receipt, no values. */
  private receipt(agent: AuthedAgent, userId: string, sessionId: string, served: Field[]): Promise<ReceiptOutcome> {
    const r: Receipt = { id: newId("r"), sessionId, agentId: agent.agentId, fields: served, purpose: ASSIST_PURPOSE,
      createdAt: this.ctx.clock.nowIso(), policyId: this.ctx.policy.id() };
    return this.receipts.write(r, userId, agent.agentId, { dedupe: true });
  }

  /**
   * POST /assistant/contributions (contract AssistantContributionInput): the merchant write path (CardService.record)
   * evaluated for category "assistant" against write.assistant of the installed document.
   *  - "stated" needs evidence (conversationId + the user's own words), else 422; it is stored as stated with that
   *    evidence, and the merge trusts it on a single source while this assistant's grant is live (trustedStatedAgentIds).
   *  - "observed" is stored as observed (a candidate until a second independent source); "inferred" stays its own record.
   *  - a field outside write.assistant, or unknown, is kept as its own "inferred" record, never on the card (A11).
   *  - shipping_address and payment_method are refused outright (403 SCOPE_DENIED), whatever the document says.
   */
  async contribute(agent: AuthedAgent, userId: string, input: { field: string; value: string; basis: Basis; evidence?: AssistantEvidence },
    sessionId?: string): Promise<{ stored: Basis; contribution: StoredContribution }> {
    const { session } = this.sessions.assistAccess(agent, userId);
    if (sessionId !== undefined && sessionId !== session.sessionId) fail("NOT_FOUND");
    if (ASSISTANT_NEVER.has(input.field)) {
      this.ctx.log({ event: "assist.contribution", actor: agent.agentId, object: session.sessionId, result: "SCOPE_DENIED", reason: input.field });
      fail("SCOPE_DENIED");
    }
    if (input.basis === "stated" && !input.evidence) fail("MISSING_FIELD", "basis stated needs evidence { conversationId, snippet }");
    const { evidence, ...rest } = input;
    return this.card.record({ ...agent, category: "assistant", role: "assistant" }, userId, { ...rest, ...(evidence ? { evidence: { ...evidence } } : {}) });
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
