// In-memory stub of MemoryRepoApi until packages/memory-repo (lane C) lands. No git: it keeps the same records
// in arrays so the workspace's write-through calls are exercised, and resetToSeed restores the seed.
import {
  NOTE_MAX_BYTES, WorkspaceError,
  type Card, type CommitRef, type Contribution, type MemoryRepo, type MemoryRepoApi, type MergeOptions, type Note,
  type OpenMemoryRepoOptions, type Receipt, type RulesApi, type WriteMeta,
} from "@agent-cookie/contract";

export interface StubCommit { sha: string; author: string; sig: string; at: string; message: string }

export class InMemoryRepo implements MemoryRepo {
  readonly commits: StubCommit[] = [];
  private contributions: Contribution[] = [];
  private notes = new Map<string, Note[]>();
  private receipts: Receipt[] = [];
  private card: Card = { card: [], candidates: [], superseded: [] };
  private n = 0;

  constructor(private rules: RulesApi, private seed: Contribution[]) {
    this.contributions = structuredClone(seed);
  }

  private commit(message: string, meta: WriteMeta): CommitRef {
    const sha = `stub${(++this.n).toString(16).padStart(8, "0")}`;
    this.commits.push({ sha, author: meta.author, sig: meta.sig, at: meta.at, message });
    return { sha };
  }

  async appendContribution(c: Contribution, meta: WriteMeta): Promise<CommitRef> {
    this.contributions.push(structuredClone(c));
    return this.commit(`contribute ${c.field} by ${c.agentId}`, meta);
  }
  async revokeContribution(id: string, revokedAt: string, meta: WriteMeta): Promise<CommitRef> {
    const c = this.contributions.find((x) => x.id === id);
    if (!c || c.revokedAt) return { sha: "" };
    c.revokedAt = revokedAt;
    return this.commit(`revoke ${id}`, meta);
  }
  async regenerateCard(merge: MergeOptions, meta: WriteMeta): Promise<{ card: Card; commit: CommitRef }> {
    this.card = this.rules.mergeCard(this.contributions, merge);
    return { card: structuredClone(this.card), commit: this.commit("regenerate CARD.md", meta) };
  }
  async writeNote(sessionId: string, note: Note, meta: WriteMeta): Promise<CommitRef> {
    const list = (this.notes.get(sessionId) ?? []).filter((x) => !(x.agentId === note.agentId && x.key === note.key));
    list.push(structuredClone(note));
    const bytes = Buffer.byteLength(JSON.stringify(list.filter((x) => x.agentId === note.agentId).map((x) => [x.key, x.value])), "utf8");
    if (bytes > NOTE_MAX_BYTES) throw new WorkspaceError("MISSING_FIELD", "note too large");
    this.notes.set(sessionId, list);
    return this.commit(`note ${note.key} by ${note.agentId}`, meta);
  }
  async readNote(sessionId: string, agentId: string, key: string, now: string): Promise<Note | undefined> {
    const n = (this.notes.get(sessionId) ?? []).find((x) => x.agentId === agentId && x.key === key);
    return n && n.expiresAt > now ? structuredClone(n) : undefined;
  }
  async deleteNote(sessionId: string, agentId: string, key: string, meta: WriteMeta): Promise<CommitRef> {
    const list = this.notes.get(sessionId) ?? [];
    this.notes.set(sessionId, list.filter((x) => !(x.agentId === agentId && x.key === key)));
    return this.commit(`delete note ${key} by ${agentId}`, meta);
  }
  async appendReceipt(r: Receipt, meta: WriteMeta): Promise<CommitRef> {
    this.receipts.push(structuredClone(r));
    return this.commit(`receipt ${r.id}`, meta);
  }
  async resetToSeed(): Promise<void> {
    this.contributions = structuredClone(this.seed);
    this.notes.clear();
    this.receipts = [];
    this.card = { card: [], candidates: [], superseded: [] };
    this.commits.length = 0;
  }
  async listContributions(): Promise<Contribution[]> {
    return structuredClone(this.contributions);
  }
}

/** The stub cannot read lane C's markdown seed, so the workspace hands it the seed contributions directly. */
export function stubMemoryRepoApi(seedContributions: () => Contribution[]): MemoryRepoApi {
  return {
    async openMemoryRepo(opts: OpenMemoryRepoOptions): Promise<MemoryRepo> {
      return new InMemoryRepo(opts.rules, seedContributions());
    },
  };
}
