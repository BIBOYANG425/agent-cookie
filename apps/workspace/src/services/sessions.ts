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

export interface Introduction { agent: Agent; channel: Channel; session: Session; grant: GrantRow; handshake: Handshake }

export interface GrantView {
  id: string; sessionId: string; agentId: string; agentName: string; fields: Field[]; purpose: string;
  createdAt: string; expiresAt: string; remainingMs: number; revokedAt?: string; status: "live" | "expired" | "revoked";
}

const STYLE: Field[] = ["lang", "tone", "length"];

export class SessionService {
  constructor(private ctx: Ctx, private card: CardService) {}

  /**
   * Plan one introduction without writing anything (handshake signing may fail, e.g. lane D's JAR_LOCKED);
   * `commit` writes it inside the caller's transaction. Session id = deriveSessionId(secret, merchantKey).
   */
  async prepare(userId: string, agent: Agent, intent: IntentRow, channel: Channel): Promise<Introduction> {
    const { store, clock, rules } = this.ctx;
    const user = store.user(userId);
    if (!user) fail("NOT_FOUND");
    const sessionId = rules.deriveSessionId(user.secret, merchantKeyFor(agent));
    const existing = store.session(sessionId);
    if (existing && (existing.agentId !== agent.agentId || existing.userId !== userId)) throw new Error("session id collision between merchants");
    const session: Session = existing ?? { sessionId, userId, agentId: agent.agentId, createdAt: clock.nowIso() };
    const grant: GrantRow = { id: newId("g"), sessionId, intentId: intent.id, fields: autoFields(agent.category), purpose: "handshake",
      createdAt: clock.nowIso(), expiresAt: clock.isoIn(GRANT_TTL_MS) };
    const handshake = await this.handshake(session, grant, agent, intent);
    return { agent, channel, session, grant, handshake };
  }

  commit(x: Introduction, intent: IntentRow): void {
    const { store } = this.ctx;
    store.upsertSession(x.session.sessionId, x.session.userId, x.agent.agentId, x.session.createdAt);
    store.insertGrant(x.grant);
    store.addIntentSession({ intentId: intent.id, sessionId: x.session.sessionId, agentId: x.agent.agentId, channel: x.channel });
    this.ctx.log({ event: "introduce", actor: "workspace", object: x.session.sessionId, result: "ok", reason: `${x.agent.agentId} via ${x.channel}` });
  }

  /**
   * The caller must own the session (else 404, existence not revealed) and hold a live grant — for `intentId`
   * when given. Picks the live grant that lasts longest; with none live, the newest relevant grant explains why
   * (revoked → GRANT_REVOKED, else GRANT_EXPIRED). Never trusts the order grants were written in.
   */
  access(agent: AuthedAgent, sessionId: string, opts: { intentId?: string } = {}): { session: Session; grant: GrantRow; live: GrantRow[] } {
    const session = this.ctx.store.session(sessionId);
    if (!session || session.agentId !== agent.agentId) fail("NOT_FOUND");
    const all = this.ctx.store.grantsForSession(sessionId).filter((g) => opts.intentId === undefined || g.intentId === opts.intentId);
    if (all.length === 0) fail("NOT_FOUND");
    const now = this.ctx.clock.now();
    const live = all.filter((g) => !g.revokedAt && Date.parse(g.expiresAt) > now)
      .sort((a, b) => Date.parse(b.expiresAt) - Date.parse(a.expiresAt));
    if (live.length === 0) fail(all[0]!.revokedAt ? "GRANT_REVOKED" : "GRANT_EXPIRED");
    return { session, grant: live[0]!, live };
  }

  /**
   * "按用途自动扩大": when the user accepts a merchant's quote, the grant for that intent widens to the purpose
   * fields the accepted step needs (shipping_address for checkout), for one more TTL. Only accept calls this.
   */
  widen(session: Session, intentId: string, fields: Field[], purpose: string): GrantRow {
    const grant: GrantRow = { id: newId("g"), sessionId: session.sessionId, intentId, fields, purpose,
      createdAt: this.ctx.clock.nowIso(), expiresAt: this.ctx.clock.isoIn(GRANT_TTL_MS) };
    this.ctx.store.insertGrant(grant);
    this.ctx.log({ event: "grant.widen", actor: "workspace", object: session.sessionId, result: "ok", reason: `${fields.join(",")} purpose=${purpose}` });
    return grant;
  }

  withdraw(grantId: string): void {
    this.ctx.store.revokeGrant(grantId, this.ctx.clock.nowIso());
  }

  /** Field NAMES only; lang/tone/length are the three style values (A04). */
  async handshake(session: Session, grant: GrantRow, agent: Agent, intent?: IntentRow): Promise<Handshake> {
    const values = this.card.values(session.userId, intent ?? grant.intentId);
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
