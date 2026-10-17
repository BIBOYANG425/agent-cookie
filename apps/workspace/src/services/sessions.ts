// Sessions and grants. One pairwise session per (user, merchantKey) — stable across resets and personal agents
// (A03, A22). A new 10-minute grant per introduction; every merchant read checks it against the server clock.
import {
  autoFields, GRANT_TTL_MS, merchantKeyFor, purposeFields,
  type Agent, type Field, type Handshake, type Session,
} from "@agent-cookie/contract";
import type { Channel, GrantRow, IntentRow } from "../db.js";
import { fail, type AuthedAgent } from "../http.js";
import { newId } from "../ids.js";
import { laneD } from "../laneD.js";
import type { CardService } from "./card.js";
import type { Ctx } from "./context.js";

export interface GrantView {
  id: string; sessionId: string; agentId: string; agentName: string; fields: Field[]; purpose: string;
  createdAt: string; expiresAt: string; remainingMs: number; revokedAt?: string; status: "live" | "expired" | "revoked";
}

const STYLE: Field[] = ["lang", "tone", "length"];

export class SessionService {
  constructor(private ctx: Ctx, private card: CardService) {}

  async introduce(userId: string, agent: Agent, intent: IntentRow | undefined, channel: Channel): Promise<{ session: Session; grant: GrantRow; handshake: Handshake }> {
    const { store, clock, rules } = this.ctx;
    const user = store.user(userId);
    if (!user) fail("NOT_FOUND");
    const sessionId = rules.deriveSessionId(user.secret, merchantKeyFor(agent));
    const session = store.upsertSession(sessionId, userId, agent.agentId, clock.nowIso());
    if (session.agentId !== agent.agentId || session.userId !== userId) throw new Error("session id collision between merchants");
    const grant: GrantRow = { id: newId("g"), sessionId, fields: autoFields(agent.category), purpose: "handshake",
      createdAt: clock.nowIso(), expiresAt: clock.isoIn(GRANT_TTL_MS) };
    if (intent) grant.intentId = intent.id;
    store.insertGrant(grant);
    if (intent) store.addIntentSession({ intentId: intent.id, sessionId, agentId: agent.agentId, channel });
    this.ctx.log({ event: "introduce", actor: "workspace", object: sessionId, result: "ok", reason: `${agent.agentId} via ${channel}` });
    return { session, grant, handshake: await this.handshake(session, grant, agent) };
  }

  /** The caller must own the session (else 404, existence not revealed) and hold a live grant. */
  access(agent: AuthedAgent, sessionId: string): { session: Session; grant: GrantRow } {
    const session = this.ctx.store.session(sessionId);
    if (!session || session.agentId !== agent.agentId) fail("NOT_FOUND");
    const grant = this.ctx.store.newestGrant(sessionId);
    if (!grant) fail("NOT_FOUND");
    if (grant.revokedAt) fail("GRANT_REVOKED");
    if (Date.parse(grant.expiresAt) <= this.ctx.clock.now()) fail("GRANT_EXPIRED");
    return { session, grant };
  }

  /** Field NAMES only; lang/tone/length are the three style values (A04). */
  async handshake(session: Session, grant: GrantRow, agent: Agent): Promise<Handshake> {
    const values = this.card.values(session.userId, grant.intentId);
    const has = (f: Field) => STYLE.includes(f) || (values[f] !== undefined && values[f] !== "");
    const available = [...autoFields(agent.category), ...purposeFields(agent.category)]
      .filter((f, i, all) => all.indexOf(f) === i && has(f) && f !== "payment_method");
    const h: Handshake = { v: 1, sessionId: session.sessionId, jar: this.ctx.config.jarUrl, lang: values.lang ?? "", tone: values.tone ?? "",
      length: values.length ?? "", available, expiresAt: grant.expiresAt };
    if (laneD.signHandshake) {
      const { sig, kid } = await laneD.signHandshake(h);
      h.sig = sig;
      h.kid = kid;
    }
    return h;
  }

  revoke(actor: string, userId: string, grantId: string): { revokedAt: string } {
    const g = this.ctx.store.grant(grantId);
    const session = g && this.ctx.store.session(g.sessionId);
    if (!g || !session || session.userId !== userId) fail("NOT_FOUND");
    const at = this.ctx.clock.nowIso();
    this.ctx.store.revokeSessionGrants(g.sessionId, at);
    this.ctx.log({ event: "grant.revoke", actor, object: grantId, result: "ok", reason: session.agentId });
    return { revokedAt: this.ctx.store.grant(grantId)!.revokedAt ?? at };
  }

  list(userId: string): GrantView[] {
    const now = this.ctx.clock.now();
    return this.ctx.store.grantsForUser(userId).map((g) => {
      const exp = Date.parse(g.expiresAt);
      const status: GrantView["status"] = g.revokedAt ? "revoked" : exp <= now ? "expired" : "live";
      const v: GrantView = { id: g.id, sessionId: g.sessionId, agentId: g.agentId, agentName: this.ctx.store.agent(g.agentId)?.name ?? g.agentId,
        fields: g.fields, purpose: g.purpose, createdAt: g.createdAt, expiresAt: g.expiresAt,
        remainingMs: status === "live" ? exp - now : 0, status };
      if (g.revokedAt) v.revokedAt = g.revokedAt;
      return v;
    });
  }
}
