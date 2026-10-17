// A merchant's own cookie note, isolated by (agentId, userId, key). Anyone else, or a missing key, gets the
// same 404 (A08). ≤ 2 KB per merchant; a key unused for 12 months expires.
import { NOTE_MAX_BYTES, NOTE_TTL_DAYS, type Note } from "@agent-cookie/contract";
import type { NoteRow } from "../db.js";
import { containsCardNumber } from "../guards.js";
import { fail, type AuthedAgent } from "../http.js";
import { persist, writeMeta, type Ctx } from "./context.js";
import type { SessionService } from "./sessions.js";

const KEY = /^[A-Za-z0-9_.-]{1,64}$/;
const TTL_MS = NOTE_TTL_DAYS * 86_400_000;

export class NoteService {
  constructor(private ctx: Ctx, private sessions: SessionService) {}

  async write(agent: AuthedAgent, sessionId: string, key: string, value: string): Promise<Note> {
    if (!KEY.test(key)) fail("MISSING_FIELD", "invalid note key");
    if (containsCardNumber(value)) fail("MISSING_FIELD", "card numbers are never stored");
    const { session } = this.sessions.access(agent, sessionId);
    const now = this.ctx.clock.nowIso();
    this.ctx.store.deleteExpiredNotes(now);
    const others = this.ctx.store.notesFor(agent.agentId, session.userId).filter((n) => n.key !== key);
    const bytes = Buffer.byteLength(JSON.stringify([...others.map((n) => [n.key, n.value]), [key, value]]), "utf8");
    if (bytes > NOTE_MAX_BYTES) fail("MISSING_FIELD", "note too large");
    const row: NoteRow = { agentId: agent.agentId, userId: session.userId, key, value, sessionId, updatedAt: now, expiresAt: this.ctx.clock.isoIn(TTL_MS) };
    this.ctx.store.upsertNote(row);
    this.ctx.log({ event: "note.write", actor: agent.agentId, object: sessionId, result: "ok", reason: key });
    const { sessionId: _s, ...note } = row;
    await persist(this.ctx, "note", agent.agentId, (r) => r.writeNote(sessionId, note, writeMeta(this.ctx, agent.agentId, { sessionId, key, value })));
    return note;
  }

  read(agent: AuthedAgent, sessionId: string, key: string): Note {
    const { session } = this.sessions.access(agent, sessionId);
    const now = this.ctx.clock.nowIso();
    this.ctx.store.deleteExpiredNotes(now);
    const row = this.ctx.store.notesFor(agent.agentId, session.userId).find((n) => n.key === key);
    if (!row) fail("NOT_FOUND");
    const expiresAt = this.ctx.clock.isoIn(TTL_MS);
    this.ctx.store.touchNote(agent.agentId, session.userId, key, expiresAt);
    const { sessionId: _s, ...note } = row;
    return { ...note, expiresAt };
  }
}
