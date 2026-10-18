// Gateway SQLite (<dataDir>/gateway.sqlite): persons, passkey credentials, global agents, gateway-level links and
// browser sessions. Keys and session ids are stored hashed. The one secret kept readable is the per-person instance
// key an approved link hands its assistant: encrypted at rest (crypto.ts) and purged LINK_TTL_MS after the approval. No card
// field value ever reaches this database: the person's data lives in their own instance's directory.
import Database from "better-sqlite3";
import type { Category, Role } from "@agent-cookie/contract";

export interface PersonRow {
  userId: string;
  createdAt: number;
  dataDir: string;
  /** The running instance's loopback port; null while stopped. */
  port: number | null;
  /** sha256 of the instance's owner key as last read from owner.key (the key itself stays in memory only). */
  ownerKeyHash: string | null;
}

export interface CredentialRow {
  credentialId: string;
  userId: string;
  /** base64url of the COSE public key. */
  publicKey: string;
  counter: number;
  transports: string[];
  createdAt: number;
}

export interface AgentRow {
  agentId: string;
  name: string;
  category: Category;
  role: Role;
  keyHash: string;
  createdAt: number;
}

export type StoredLinkStatus = "pending" | "approved" | "declined";

export interface LinkRow {
  id: string;
  agentId: string;
  status: StoredLinkStatus;
  createdAt: number;
  expiresAt: number;
  decidedAt: number | null;
  userId: string | null;
  instanceLinkId: string | null;
  /** The assistant's agent id inside the person's instance (receipts and grants name it). */
  instanceAgentId: string | null;
  /** The pairwise session the instance created on approval (LinkView.sessionId). */
  instanceSessionId: string | null;
  jarUrl: string | null;
  jarKeyCiphertext: string | null;
}

export interface ApprovedLink {
  decidedAt: number;
  userId: string;
  instanceLinkId: string;
  instanceAgentId: string;
  instanceSessionId: string;
  jarUrl: string;
  jarKeyCiphertext: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS persons (
  user_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  data_dir TEXT NOT NULL,
  port INTEGER,
  owner_key_hash TEXT
);
CREATE TABLE IF NOT EXISTS credentials (
  credential_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES persons(user_id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL,
  transports TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS credentials_user ON credentials(user_id);
CREATE TABLE IF NOT EXISTS agents (
  agent_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  role TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(agent_id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'declined')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  decided_at INTEGER,
  user_id TEXT,
  instance_link_id TEXT,
  instance_agent_id TEXT,
  instance_session_id TEXT,
  jar_url TEXT,
  jar_key_ciphertext TEXT
);
CREATE INDEX IF NOT EXISTS links_agent ON links(agent_id, status);
CREATE INDEX IF NOT EXISTS links_user ON links(user_id);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES persons(user_id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
`;

type Row = Record<string, unknown>;

const person = (r: Row): PersonRow => ({
  userId: r.user_id as string, createdAt: r.created_at as number, dataDir: r.data_dir as string,
  port: (r.port as number | null) ?? null, ownerKeyHash: (r.owner_key_hash as string | null) ?? null,
});
const credential = (r: Row): CredentialRow => ({
  credentialId: r.credential_id as string, userId: r.user_id as string, publicKey: r.public_key as string,
  counter: r.counter as number, transports: JSON.parse(r.transports as string) as string[], createdAt: r.created_at as number,
});
const agent = (r: Row): AgentRow => ({
  agentId: r.agent_id as string, name: r.name as string, category: r.category as Category, role: r.role as Role,
  keyHash: r.key_hash as string, createdAt: r.created_at as number,
});
const link = (r: Row): LinkRow => ({
  id: r.id as string, agentId: r.agent_id as string, status: r.status as StoredLinkStatus, createdAt: r.created_at as number,
  expiresAt: r.expires_at as number, decidedAt: (r.decided_at as number | null) ?? null, userId: (r.user_id as string | null) ?? null,
  instanceLinkId: (r.instance_link_id as string | null) ?? null, instanceAgentId: (r.instance_agent_id as string | null) ?? null,
  instanceSessionId: (r.instance_session_id as string | null) ?? null, jarUrl: (r.jar_url as string | null) ?? null,
  jarKeyCiphertext: (r.jar_key_ciphertext as string | null) ?? null,
});

export class GatewayStore {
  private db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(SCHEMA);
    // No instance survives a gateway restart: whatever port a previous run recorded is stale.
    this.db.prepare("UPDATE persons SET port = NULL").run();
  }

  close(): void {
    this.db.close();
  }

  tx<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  // ---- persons
  insertPerson(p: { userId: string; createdAt: number; dataDir: string }): void {
    this.db.prepare("INSERT INTO persons (user_id, created_at, data_dir) VALUES (?, ?, ?)").run(p.userId, p.createdAt, p.dataDir);
  }
  person(userId: string): PersonRow | undefined {
    const r = this.db.prepare("SELECT * FROM persons WHERE user_id = ?").get(userId) as Row | undefined;
    return r ? person(r) : undefined;
  }
  countPersons(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM persons").get() as { n: number }).n;
  }
  setPort(userId: string, port: number | null): void {
    this.db.prepare("UPDATE persons SET port = ? WHERE user_id = ?").run(port, userId);
  }
  setOwnerKeyHash(userId: string, hash: string): void {
    this.db.prepare("UPDATE persons SET owner_key_hash = ? WHERE user_id = ?").run(hash, userId);
  }
  /** The person, their credentials and sessions (cascade) and every link they decided (with any jar key it held). */
  deletePerson(userId: string): void {
    this.tx(() => {
      this.db.prepare("DELETE FROM links WHERE user_id = ?").run(userId);
      this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
      this.db.prepare("DELETE FROM credentials WHERE user_id = ?").run(userId);
      this.db.prepare("DELETE FROM persons WHERE user_id = ?").run(userId);
    });
  }

  // ---- credentials
  insertCredential(c: CredentialRow): void {
    this.db.prepare("INSERT INTO credentials (credential_id, user_id, public_key, counter, transports, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(c.credentialId, c.userId, c.publicKey, c.counter, JSON.stringify(c.transports), c.createdAt);
  }
  credential(credentialId: string): CredentialRow | undefined {
    const r = this.db.prepare("SELECT * FROM credentials WHERE credential_id = ?").get(credentialId) as Row | undefined;
    return r ? credential(r) : undefined;
  }
  updateCounter(credentialId: string, counter: number): void {
    this.db.prepare("UPDATE credentials SET counter = ? WHERE credential_id = ?").run(counter, credentialId);
  }

  // ---- agents
  insertAgent(a: AgentRow): void {
    this.db.prepare("INSERT INTO agents (agent_id, name, category, role, key_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(a.agentId, a.name, a.category, a.role, a.keyHash, a.createdAt);
  }
  agent(agentId: string): AgentRow | undefined {
    const r = this.db.prepare("SELECT * FROM agents WHERE agent_id = ?").get(agentId) as Row | undefined;
    return r ? agent(r) : undefined;
  }
  agentByKeyHash(keyHash: string): AgentRow | undefined {
    const r = this.db.prepare("SELECT * FROM agents WHERE key_hash = ?").get(keyHash) as Row | undefined;
    return r ? agent(r) : undefined;
  }

  // ---- links
  insertLink(l: Pick<LinkRow, "id" | "agentId" | "createdAt" | "expiresAt">): void {
    this.db.prepare("INSERT INTO links (id, agent_id, status, created_at, expires_at) VALUES (?, ?, 'pending', ?, ?)")
      .run(l.id, l.agentId, l.createdAt, l.expiresAt);
  }
  link(id: string): LinkRow | undefined {
    const r = this.db.prepare("SELECT * FROM links WHERE id = ?").get(id) as Row | undefined;
    return r ? link(r) : undefined;
  }
  /** The agent's pending link that has not expired yet, if any (newest first). */
  openLinkForAgent(agentId: string, now: number): LinkRow | undefined {
    const r = this.db.prepare("SELECT * FROM links WHERE agent_id = ? AND status = 'pending' AND expires_at > ? ORDER BY created_at DESC LIMIT 1")
      .get(agentId, now) as Row | undefined;
    return r ? link(r) : undefined;
  }
  /** Links this person decided, newest first. */
  linksForUser(userId: string): LinkRow[] {
    return (this.db.prepare("SELECT * FROM links WHERE user_id = ? ORDER BY created_at DESC").all(userId) as Row[]).map(link);
  }
  /** Pending and unexpired → approved with the instance mapping; false when someone decided it first or it expired. */
  approveLink(id: string, a: ApprovedLink, now: number): boolean {
    return this.db.prepare(`UPDATE links SET status = 'approved', decided_at = ?, user_id = ?, instance_link_id = ?, instance_agent_id = ?,
      instance_session_id = ?, jar_url = ?, jar_key_ciphertext = ? WHERE id = ? AND status = 'pending' AND expires_at > ?`)
      .run(a.decidedAt, a.userId, a.instanceLinkId, a.instanceAgentId, a.instanceSessionId, a.jarUrl, a.jarKeyCiphertext, id, now).changes === 1;
  }
  declineLink(id: string, userId: string, now: number): boolean {
    return this.db.prepare("UPDATE links SET status = 'declined', decided_at = ?, user_id = ? WHERE id = ? AND status = 'pending' AND expires_at > ?")
      .run(now, userId, id, now).changes === 1;
  }
  /**
   * Drops the instance key of every link decided at or before `cutoff` (the caller passes now − LINK_TTL_MS: the key is
   * readable for LINK_TTL_MS after the approval). Returns how many were purged.
   */
  purgeJarKeysDecidedBefore(cutoff: number): number {
    return this.db.prepare("UPDATE links SET jar_key_ciphertext = NULL WHERE jar_key_ciphertext IS NOT NULL AND (decided_at IS NULL OR decided_at <= ?)")
      .run(cutoff).changes;
  }

  // ---- sessions
  insertSession(s: { idHash: string; userId: string; createdAt: number; expiresAt: number }): void {
    this.db.prepare("INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(s.idHash, s.userId, s.createdAt, s.expiresAt);
  }
  /** The live session's person, else undefined. */
  sessionUser(idHash: string, now: number): string | undefined {
    const r = this.db.prepare("SELECT user_id FROM sessions WHERE id_hash = ? AND expires_at > ?").get(idHash, now) as { user_id: string } | undefined;
    return r?.user_id;
  }
  deleteSession(idHash: string): void {
    this.db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(idHash);
  }
  purgeExpiredSessions(now: number): number {
    return this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now).changes;
  }
}
