// Consent links (bring-your-own-agent plan §3, decision D5). A company assistant asks for a link; the OWNER approves or
// declines it (console, CLI, or a gateway after a passkey tap, all through /owner/links). Approval is the only way an
// assistant gets a pairwise session and its assist grant (SessionService.assist); nothing approves automatically. A
// link is single use: once decided, or LINK_TTL_MS after it was asked for, it can no longer be decided (409
// LINK_NOT_PENDING). "expired" is computed against the workspace clock, never stored.
import { LINK_TTL_MS, type Link, type LinkStatus, type LinkView } from "@agent-cookie/contract";
import type { LinkRow } from "../db.js";
import { fail, type AuthedAgent } from "../http.js";
import { newId } from "../ids.js";
import type { Ctx } from "./context.js";
import type { SessionService } from "./sessions.js";

export class LinkService {
  constructor(private ctx: Ctx, private sessions: SessionService) {}

  private status(l: LinkRow): LinkStatus {
    return l.status === "pending" && Date.parse(l.expiresAt) <= this.ctx.clock.now() ? "expired" : l.status;
  }

  /** The assistant's view: the state of its own link, and where the owner decides. Never anything about the user. */
  private toView(l: LinkRow): LinkView {
    const v: LinkView = { id: l.id, status: this.status(l), url: `${this.ctx.config.jarUrl}/owner/links/${encodeURIComponent(l.id)}`, expiresAt: l.expiresAt };
    if (l.status === "approved" && l.sessionId) v.sessionId = l.sessionId;
    return v;
  }

  private toLink(l: LinkRow): Link {
    const out: Link = { id: l.id, agentId: l.agentId, agentName: this.ctx.store.agent(l.agentId)?.name ?? l.agentId, status: this.status(l),
      createdAt: l.createdAt, expiresAt: l.expiresAt };
    if (l.decidedAt) out.decidedAt = l.decidedAt;
    if (l.sessionId) out.sessionId = l.sessionId;
    return out;
  }

  /** POST /assistant/link: the agent's pending, unexpired link if it has one (created false), else a new one. */
  request(agent: AuthedAgent): { link: LinkView; created: boolean } {
    const open = this.ctx.store.linksForAgent(agent.agentId).find((l) => this.status(l) === "pending");
    if (open) return { link: this.toView(open), created: false };
    const row: LinkRow = { id: newId("lk"), agentId: agent.agentId, status: "pending", createdAt: this.ctx.clock.nowIso(), expiresAt: this.ctx.clock.isoIn(LINK_TTL_MS) };
    this.ctx.store.insertLink(row);
    this.ctx.log({ event: "link.request", actor: agent.agentId, object: row.id, result: "pending" });
    return { link: this.toView(row), created: true };
  }

  /** GET /assistant/link/:id: its own link only; anyone else's, or none, is the same 404. */
  view(agent: AuthedAgent, id: string): LinkView {
    const l = this.ctx.store.link(id);
    if (!l || l.agentId !== agent.agentId) fail("NOT_FOUND");
    return this.toView(l);
  }

  /** GET /owner/links: newest first. */
  list(limit: number): Link[] {
    return this.ctx.store.links(limit).map((l) => this.toLink(l));
  }

  /** The link, still pending and unexpired, and its assistant; 404 unknown, 409 LINK_NOT_PENDING otherwise. */
  private pending(id: string): LinkRow {
    const l = this.ctx.store.link(id);
    if (!l) fail("NOT_FOUND");
    if (this.status(l) !== "pending") fail("LINK_NOT_PENDING");
    return l;
  }

  /**
   * POST /owner/links/:id/approve (owner key only). One transaction: the assistant's pairwise session and its assist
   * grant (SessionService.assist), the link marked approved with the session; `link.approve` logged.
   */
  approve(actor: string, userId: string, id: string): Link {
    const out = this.ctx.store.tx(() => {
      const l = this.pending(id);
      const agent = this.ctx.store.agent(l.agentId);
      if (!agent || agent.category !== "assistant") fail("NOT_FOUND");
      const { session, grant } = this.sessions.assist(userId, agent);
      const at = this.ctx.clock.nowIso();
      if (!this.ctx.store.decideLink(l.id, "approved", at, session.sessionId)) fail("LINK_NOT_PENDING");
      this.ctx.log({ event: "link.approve", actor, object: l.id, result: "ok", reason: `${agent.agentId} session=${session.sessionId} grant=${grant.id}` });
      return this.ctx.store.link(l.id)!;
    });
    return this.toLink(out);
  }

  /** POST /owner/links/:id/decline (owner key only). The assistant sees "declined" and may ask again later. */
  decline(actor: string, id: string): Link {
    const out = this.ctx.store.tx(() => {
      const l = this.pending(id);
      if (!this.ctx.store.decideLink(l.id, "declined", this.ctx.clock.nowIso())) fail("LINK_NOT_PENDING");
      this.ctx.log({ event: "link.decline", actor, object: l.id, result: "ok", reason: l.agentId });
      return this.ctx.store.link(l.id)!;
    });
    return this.toLink(out);
  }
}
