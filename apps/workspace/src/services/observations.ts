// The observation queue (B49): what the user said waits here, in process memory only, until learning.ts takes it.
// Bounded: OBSERVATION_MAX_CONVERSATIONS conversations per user × OBSERVATION_MAX_QUEUED_TURNS user turns each; past
// either bound the oldest is dropped and counted. Message ids a personal agent posted are remembered for
// OBSERVATION_MESSAGE_TTL_MS so a replayed message is not a second sighting. Nothing here is ever written to disk;
// SQLite mirrors only the conversation's id, turn count and times (db.ts observation_batches), and a restart loses
// what was waiting.
import {
  OBSERVATION_MAX_CONVERSATIONS, OBSERVATION_MAX_QUEUED_TURNS, OBSERVATION_MESSAGE_TTL_MS,
  type ObservationTurn,
} from "@agent-cookie/contract";

export interface QueuedTurn { text: string; at: string }
export interface QueuedConversation {
  agentId: string;
  conversationId: string;
  userId: string;
  channel: string;
  /** Turns of every role seen since the batch started (the batching threshold counts them all). */
  turnsSeen: number;
  firstAt: number;
  lastAt: number;
  /** The user's own turns only, oldest first, at most OBSERVATION_MAX_QUEUED_TURNS. */
  turns: QueuedTurn[];
}
export interface Enqueued { batch: QueuedConversation; fresh: number; duplicates: number; droppedTurns: number; droppedConversations: QueuedConversation[] }

/** Remembered message ids across all agents; past it the oldest are forgotten first. */
const MAX_MESSAGE_IDS = 10_000;
const key = (agentId: string, conversationId: string) => `${agentId}\u0000${conversationId}`;

export class ObservationQueue {
  /** Insertion order is age order: a conversation keeps its place until it is taken or dropped. */
  private batches = new Map<string, QueuedConversation>();
  /** `${agentId}\0${messageId}` → expiry (workspace clock ms). */
  private messages = new Map<string, number>();

  /**
   * Add one observation's turns. `turns` are all of them (to count and de-duplicate); `keep` picks the user turns
   * whose text is queued. Returns what happened, including conversations dropped to stay within bounds.
   */
  add(b: { agentId: string; conversationId: string; userId: string; channel: string }, turns: readonly ObservationTurn[],
    keep: (t: ObservationTurn) => boolean, nowMs: number): Enqueued {
    const { fresh, duplicates } = this.unseen(b.agentId, turns, nowMs);
    const k = key(b.agentId, b.conversationId);
    let batch = this.batches.get(k);
    const droppedConversations: QueuedConversation[] = [];
    if (!batch) {
      if (fresh.length === 0) return { batch: { ...b, turnsSeen: 0, firstAt: nowMs, lastAt: nowMs, turns: [] }, fresh: 0, duplicates, droppedTurns: 0, droppedConversations };
      batch = { ...b, turnsSeen: 0, firstAt: nowMs, lastAt: nowMs, turns: [] };
      this.batches.set(k, batch);
      for (const old of this.forUser(b.userId)) {
        if (this.count(b.userId) <= OBSERVATION_MAX_CONVERSATIONS) break;
        if (old === batch) continue;
        this.batches.delete(key(old.agentId, old.conversationId));
        droppedConversations.push(old);
      }
    }
    if (fresh.length > 0) {
      batch.turnsSeen += fresh.length;
      batch.lastAt = nowMs;
      batch.channel = b.channel;
      for (const t of fresh) if (keep(t)) batch.turns.push({ text: t.text, at: t.at });
    }
    const droppedTurns = Math.max(0, batch.turns.length - OBSERVATION_MAX_QUEUED_TURNS);
    if (droppedTurns > 0) batch.turns.splice(0, droppedTurns);
    return { batch, fresh: fresh.length, duplicates, droppedTurns, droppedConversations };
  }

  /** The turns whose messageId this agent has not posted within the TTL (turns without one always count); remembers them. */
  unseen(agentId: string, turns: readonly ObservationTurn[], nowMs: number): { fresh: ObservationTurn[]; duplicates: number } {
    this.expire(nowMs);
    let duplicates = 0;
    const fresh = turns.filter((t) => {
      if (t.messageId === undefined) return true;
      const id = `${agentId}\u0000${t.messageId}`;
      if ((this.messages.get(id) ?? 0) > nowMs) { duplicates++; return false; }
      this.messages.delete(id);
      this.messages.set(id, nowMs + OBSERVATION_MESSAGE_TTL_MS);
      return true;
    });
    while (this.messages.size > MAX_MESSAGE_IDS) this.messages.delete(this.messages.keys().next().value!);
    return { fresh, duplicates };
  }

  get(agentId: string, conversationId: string): QueuedConversation | undefined {
    return this.batches.get(key(agentId, conversationId));
  }

  /** Conversations quiet since `idleBefore` (ms) or holding at least `minTurns` turns, oldest first. */
  due(idleBefore: number, minTurns: number): QueuedConversation[] {
    return [...this.batches.values()].filter((b) => b.lastAt <= idleBefore || b.turnsSeen >= minTurns);
  }

  /** Remove and return a conversation's batch: from here on its text exists only in the caller's hands. */
  take(agentId: string, conversationId: string): QueuedConversation | undefined {
    const k = key(agentId, conversationId);
    const b = this.batches.get(k);
    this.batches.delete(k);
    return b;
  }

  /** Drop every waiting conversation of the user (learning paused). Returns them. */
  dropUser(userId: string): QueuedConversation[] {
    const out = this.forUser(userId);
    for (const b of out) this.batches.delete(key(b.agentId, b.conversationId));
    return out;
  }

  /** Drop one conversation of the user, whichever personal agent posted it (forget). Returns them. */
  dropConversation(userId: string, conversationId: string): QueuedConversation[] {
    const out = this.forUser(userId).filter((b) => b.conversationId === conversationId);
    for (const b of out) this.batches.delete(key(b.agentId, b.conversationId));
    return out;
  }

  count(userId: string): number {
    return this.forUser(userId).length;
  }

  /** POST /demo/reset: nothing that was said before a reset survives it. */
  clear(): void {
    this.batches.clear();
    this.messages.clear();
  }

  private forUser(userId: string): QueuedConversation[] {
    return [...this.batches.values()].filter((b) => b.userId === userId);
  }

  private expire(nowMs: number): void {
    for (const [id, until] of this.messages) if (until <= nowMs) this.messages.delete(id);
  }
}
