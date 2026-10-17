// GET /agent/fields. Policy (readDecision) → purpose grounding → values → receipt. All-or-nothing; denials never
// name fields (A05). The declared purpose is a parameter: a purpose field is released only when the user has
// accepted this merchant's quote under the intent this grant was issued for.
import { isField, readDecision, readMode, type Field, type Receipt } from "@agent-cookie/contract";
import { fail, type AuthedAgent } from "../http.js";
import { newId } from "../ids.js";
import type { CardService } from "./card.js";
import { persistStrict, writeMeta, type Ctx } from "./context.js";
import type { SessionService } from "./sessions.js";

export interface FieldRead { sessionId: string; purpose: string; fields: Partial<Record<Field, string>>; receipt?: Receipt }

export class FieldService {
  constructor(private ctx: Ctx, private sessions: SessionService, private card: CardService) {}

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

    const decisions = fields.map((f) => readDecision(agent.category, f, purpose));
    if (decisions.includes("SCOPE_DENIED")) deny("SCOPE_DENIED");
    if (decisions.includes("PURPOSE_MISMATCH")) deny("PURPOSE_MISMATCH");
    // Auto fields must be inside a live grant (they are, by construction; checked anyway).
    const autoOnes = fields.filter((f) => readMode(agent.category, f) === "auto");
    const purposeOnes = fields.filter((f) => readMode(agent.category, f) === "purpose");
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

    let receipt: Receipt | undefined;
    const released = purposeOnes.filter((f) => out[f] !== undefined);
    if (released.length > 0) {
      receipt = { id: newId("r"), sessionId, agentId: agent.agentId, fields: released, purpose: purpose!, createdAt: this.ctx.clock.nowIso() };
      // "每次放行写回执": no durable receipt, no release. Git first, then SQLite, then the values.
      const r0 = receipt;
      await persistStrict(this.ctx, "receipt", agent.agentId, (r) => r.appendReceipt(r0, writeMeta(this.ctx, "workspace", r0)));
      this.ctx.store.insertReceipt({ ...receipt, userId: session.userId });
    }
    this.ctx.log({ event: "fields.read", actor: agent.agentId, object: sessionId, result: "allow",
      reason: `${fields.join(",")} purpose=${purpose ?? ""}` });
    return { sessionId, purpose: purpose ?? "", fields: out, ...(receipt ? { receipt } : {}) };
  }
}
