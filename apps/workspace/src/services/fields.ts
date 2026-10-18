// GET /agent/fields. Policy (readDecision) → purpose grounding → receipts → values. All-or-nothing; denials never
// name fields (A05); payment_method is never released here (A21). The declared purpose is a parameter: a purpose field
// is released only when the user has accepted this merchant's quote under the intent this grant was issued for.
// Every release is receipted (owner decision 2026-10-18): purpose fields under the declared purpose, auto fields under
// "handshake" with the de-duplication rule of services/receipts.ts, so a store polling on every message does not
// commit to git each time.
import { isField, type Field, type Receipt } from "@agent-cookie/contract";
import { fail, type AuthedAgent } from "../http.js";
import { newId } from "../ids.js";
import type { CardService } from "./card.js";
import type { Ctx } from "./context.js";
import { HANDSHAKE_PURPOSE, ReceiptWriter } from "./receipts.js";
import type { SessionService } from "./sessions.js";

/** `receipt`: the purpose release's receipt, for AcceptResult.receipts; the route never sends it to the merchant. */
export interface FieldRead { sessionId: string; purpose: string; fields: Partial<Record<Field, string>>; receipt?: Receipt }

export class FieldService {
  /** Receipt decisions run one at a time, so two reads at once cannot both decide "no recent receipt". */
  private readonly receipts: ReceiptWriter;

  constructor(private ctx: Ctx, private sessions: SessionService, private card: CardService) {
    this.receipts = new ReceiptWriter(ctx);
  }

  async read(agent: AuthedAgent, sessionId: string, names: string[], purpose?: string): Promise<FieldRead> {
    const { session, grant, live } = this.sessions.access(agent, sessionId);
    const wanted = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
    if (wanted.length === 0) fail("MISSING_FIELD", "missing fields");
    if (wanted.length > 32) fail("MISSING_FIELD", "too many fields");
    const deny = (code: "SCOPE_DENIED" | "PURPOSE_MISMATCH"): never => {
      this.ctx.log({ event: "fields.read", actor: agent.agentId, object: sessionId, result: code, reason: `purpose=${purpose ?? ""}` });
      fail(code);
    };
    // A name outside the field table is outside the policy: same answer as any other unlisted combination.
    if (!wanted.every(isField)) deny("SCOPE_DENIED");
    const fields = wanted as Field[];
    // The token never reaches a merchant, whatever grants exist (A21). Purpose "payment" exists so the WORKSPACE reads the
    // token on the user's behalf (payments.ts reads the card directly, never through here) and so the payment stage's
    // grant and receipt name it; the merchant only ever sees the authorization result. Same generic denial as any other.
    if (fields.includes("payment_method")) deny("SCOPE_DENIED");

    // The INSTALLED policy document decides, at read time: a field granted under an earlier document but no longer
    // readable is refused like any other unlisted combination.
    const policy = this.ctx.policy;
    const decisions = fields.map((f) => policy.readDecision(agent.category, f, purpose));
    if (decisions.includes("SCOPE_DENIED")) deny("SCOPE_DENIED");
    if (decisions.includes("PURPOSE_MISMATCH")) deny("PURPOSE_MISMATCH");
    // Auto fields must be inside a live grant (they are, by construction; checked anyway).
    const autoOnes = fields.filter((f) => policy.readMode(agent.category, f) === "auto");
    const purposeOnes = fields.filter((f) => policy.readMode(agent.category, f) === "purpose");
    if (autoOnes.some((f) => !live.some((g) => g.fields.includes(f)))) deny("SCOPE_DENIED");
    // Policy is necessary, not sufficient: a purpose field needs a live grant widened for exactly this purpose,
    // which only exists after the user accepted this merchant's quote (CommerceService.accept).
    let source = grant;
    if (purposeOnes.length > 0) {
      const widened = live.find((g) => g.purpose === purpose && purposeOnes.every((f) => g.fields.includes(f)));
      if (!widened) deny("PURPOSE_MISMATCH");
      source = widened!;
    }

    const values = this.card.values(session.userId, source.intentId);
    const out: Partial<Record<Field, string>> = {};
    for (const f of fields) if (values[f] !== undefined) out[f] = values[f];

    // "每次放行写回执": no durable receipt, no release. Git first, then SQLite, then the values. Both receipts carry the
    // intent whose grant authorized the read, so the funnel attributes them (questionsSkipped).
    const stamp = { sessionId, agentId: agent.agentId, createdAt: this.ctx.clock.nowIso(),
      ...(source.intentId ? { intentId: source.intentId } : {}), policyId: policy.id() };
    let receipt: Receipt | undefined;
    const released = purposeOnes.filter((f) => out[f] !== undefined);
    if (released.length > 0) {
      receipt = { id: newId("r"), ...stamp, fields: released, purpose: purpose! };
      await this.receipts.write(receipt, session.userId, agent.agentId, { dedupe: false });
    }
    // Auto fields are receipted whatever purpose the merchant declared: a declared purpose is a parameter, and naming one
    // must not take a read of the handshake fields out of the receipts.
    const autoReleased = autoOnes.filter((f) => out[f] !== undefined);
    const handshake = await this.receipts.write({ id: newId("r"), ...stamp, fields: autoReleased, purpose: HANDSHAKE_PURPOSE },
      session.userId, agent.agentId, { dedupe: true });
    // Every read is logged, receipted or not: field NAMES and counts, never a value. `intent=` attributes the read to the
    // intent whose grant authorized it (funnel: fields read vs granted); the first token stays the field list.
    const written = (receipt ? 1 : 0) + (handshake === "written" ? 1 : 0);
    this.ctx.log({ event: "fields.read", actor: agent.agentId, object: sessionId, result: "allow",
      reason: `${fields.join(",")} purpose=${purpose ?? ""} intent=${source.intentId ?? ""} receipts=${written} deduped=${handshake === "deduped" ? 1 : 0}` });
    return { sessionId, purpose: purpose ?? "", fields: out, ...(receipt ? { receipt } : {}) };
  }
}
