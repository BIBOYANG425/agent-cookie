// SQLite store: every piece of state the workspace serves. Long-term data (contributions, notes, receipts)
// is also written through to the user's git memory repo (MemoryRepo), but reads never go there.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type {
  ActivityEvent, Agent, Basis, Card, Category, Contribution, ContributionEvidence, DataSource, Field, Grant, Intent, Note, Quote, Receipt,
  Role, Session, AcceptResult,
} from "@agent-cookie/contract";

export interface UserRow { userId: string; name: string; secret: string; createdAt: string }
export interface KeyRow { keyHash: string; agentId: string; role: Role; createdAt: string }
/** Grant plus the intent it was issued under (purpose grounding needs it). */
export interface GrantRow extends Grant { intentId?: string; createdAt: string }
/** `kind` is the optional hint; `text` is absent only on legacy kind-only requests (see app.ts). */
export interface IntentRow extends Omit<Intent, "kind"> { kind?: string; agentId: string; text?: string; query?: string; createdAt: string }
export type Channel = "ucp" | "callback" | "tier0";
export interface IntentSessionRow { intentId: string; sessionId: string; agentId: string; channel: Channel }
export type QuoteStatus = "open" | "accepted" | AcceptResult["status"];
export interface QuoteRow extends Quote { sessionId: string; status: QuoteStatus; createdAt: string; acceptedAt?: string; result?: AcceptResult }
export interface NoteRow extends Note { sessionId: string }
export interface ReceiptRow extends Receipt { userId: string }
/** Contributions may carry an unknown field name when a merchant tried to write one (A11: stored inferred, never on the card). */
export type StoredContribution = Omit<Contribution, "field"> & { field: Field | string };
/** A conversation waiting to be learned from (learning.ts). Only counters and times: the text is in observation_turns. */
export interface ObservationBatchRow { agentId: string; conversationId: string; userId: string; channel: string; turnsSeen: number; firstAt: string; lastAt: string }
export interface ObservationTurnRow { text: string; at: string }

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (user_id TEXT PRIMARY KEY, name TEXT NOT NULL, secret TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agents (agent_id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, capabilities TEXT NOT NULL,
  callback_url TEXT, chat_endpoint TEXT, domain TEXT UNIQUE, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS keys (key_hash TEXT PRIMARY KEY, agent_id TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, agent_id TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE (user_id, agent_id));
CREATE TABLE IF NOT EXISTS grants (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, intent_id TEXT, fields TEXT NOT NULL, purpose TEXT NOT NULL,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT, seq INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS grants_session ON grants (session_id, seq);
CREATE TABLE IF NOT EXISTS intents (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, agent_id TEXT NOT NULL, kind TEXT NOT NULL, public TEXT NOT NULL,
  text TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, query TEXT);
CREATE TABLE IF NOT EXISTS intent_sessions (intent_id TEXT NOT NULL, session_id TEXT NOT NULL, agent_id TEXT NOT NULL, channel TEXT NOT NULL,
  PRIMARY KEY (intent_id, session_id));
CREATE TABLE IF NOT EXISTS quotes (id TEXT PRIMARY KEY, intent_id TEXT NOT NULL, agent_id TEXT NOT NULL, session_id TEXT NOT NULL, text TEXT NOT NULL,
  price INTEGER NOT NULL, currency TEXT NOT NULL, eta_date TEXT, eta_text TEXT, title TEXT, seller TEXT, variant_id TEXT, checkout_url TEXT,
  status TEXT NOT NULL, created_at TEXT NOT NULL, accepted_at TEXT, result TEXT, seq INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'live',
  size_note TEXT);
CREATE TABLE IF NOT EXISTS contributions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, agent_id TEXT NOT NULL, field TEXT NOT NULL, value TEXT NOT NULL,
  basis TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT, seq INTEGER NOT NULL, origin TEXT NOT NULL DEFAULT 'live', evidence TEXT);
CREATE TABLE IF NOT EXISTS settings (user_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (user_id, key));
CREATE TABLE IF NOT EXISTS observation_batches (agent_id TEXT NOT NULL, conversation_id TEXT NOT NULL, user_id TEXT NOT NULL, channel TEXT NOT NULL,
  turns_seen INTEGER NOT NULL, first_at TEXT NOT NULL, last_at TEXT NOT NULL, PRIMARY KEY (agent_id, conversation_id));
CREATE TABLE IF NOT EXISTS observation_turns (agent_id TEXT NOT NULL, conversation_id TEXT NOT NULL, seq INTEGER NOT NULL, text TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cards (user_id TEXT PRIMARY KEY, card TEXT NOT NULL, computed_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notes (agent_id TEXT NOT NULL, user_id TEXT NOT NULL, key TEXT NOT NULL, session_id TEXT NOT NULL, value TEXT NOT NULL,
  updated_at TEXT NOT NULL, expires_at TEXT NOT NULL, PRIMARY KEY (agent_id, user_id, key));
CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_id TEXT NOT NULL, agent_id TEXT NOT NULL, fields TEXT NOT NULL,
  purpose TEXT NOT NULL, amount INTEGER, created_at TEXT NOT NULL, seq INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, event TEXT NOT NULL, actor TEXT NOT NULL,
  object TEXT NOT NULL, result TEXT NOT NULL, reason TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS idempotency (scope TEXT NOT NULL, key TEXT NOT NULL, request_hash TEXT NOT NULL, status INTEGER NOT NULL,
  body TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (scope, key));
`;

/** Columns added after the first schema, applied to existing databases (CREATE TABLE IF NOT EXISTS never alters). */
const MIGRATIONS: ReadonlyArray<{ version: number; table: string; column: string; ddl: string }> = [
  { version: 2, table: "quotes", column: "source", ddl: "ALTER TABLE quotes ADD COLUMN source TEXT NOT NULL DEFAULT 'live'" },
  { version: 2, table: "contributions", column: "origin", ddl: "ALTER TABLE contributions ADD COLUMN origin TEXT NOT NULL DEFAULT 'live'" },
  { version: 3, table: "intents", column: "query", ddl: "ALTER TABLE intents ADD COLUMN query TEXT" },
  { version: 3, table: "quotes", column: "size_note", ddl: "ALTER TABLE quotes ADD COLUMN size_note TEXT" },
  { version: 4, table: "contributions", column: "evidence", ddl: "ALTER TABLE contributions ADD COLUMN evidence TEXT" },
];
export const SCHEMA_VERSION = 4;

const TABLES = ["users", "agents", "keys", "sessions", "grants", "intents", "intent_sessions", "quotes", "contributions", "cards", "notes",
  "receipts", "activity", "idempotency", "settings", "observation_batches", "observation_turns"] as const;

type Row = Record<string, unknown>;
const s = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : String(v));

function toAgent(r: Row): Agent {
  const a: Agent = { agentId: String(r.agent_id), name: String(r.name), category: r.category as Category,
    capabilities: JSON.parse(String(r.capabilities)) as string[], createdAt: String(r.created_at) };
  if (r.callback_url) a.callbackUrl = String(r.callback_url);
  if (r.chat_endpoint) a.chatEndpoint = String(r.chat_endpoint);
  if (r.domain) a.domain = String(r.domain);
  return a;
}
function toGrant(r: Row): GrantRow {
  const g: GrantRow = { id: String(r.id), sessionId: String(r.session_id), fields: JSON.parse(String(r.fields)) as Field[],
    purpose: String(r.purpose), expiresAt: String(r.expires_at), createdAt: String(r.created_at) };
  if (r.revoked_at) g.revokedAt = String(r.revoked_at);
  if (r.intent_id) g.intentId = String(r.intent_id);
  return g;
}
function toIntent(r: Row): IntentRow {
  const i: IntentRow = { id: String(r.id), userId: String(r.user_id), agentId: String(r.agent_id),
    public: JSON.parse(String(r.public)) as Record<string, string>, expiresAt: String(r.expires_at), createdAt: String(r.created_at) };
  if (r.kind) i.kind = String(r.kind);
  if (r.text) i.text = String(r.text);
  if (r.query) i.query = String(r.query);
  return i;
}
function toQuote(r: Row): QuoteRow {
  const q: QuoteRow = { id: String(r.id), intentId: String(r.intent_id), agentId: String(r.agent_id), sessionId: String(r.session_id),
    text: String(r.text), price: Number(r.price), currency: "USD", etaDate: s(r.eta_date) ?? null, status: r.status as QuoteStatus,
    createdAt: String(r.created_at), source: (s(r.source) ?? "live") as DataSource };
  for (const [k, col] of [["etaText", "eta_text"], ["title", "title"], ["seller", "seller"], ["variantId", "variant_id"],
    ["checkoutUrl", "checkout_url"], ["acceptedAt", "accepted_at"], ["sizeNote", "size_note"]] as const) {
    const v = s(r[col]);
    if (v !== undefined) (q as unknown as Record<string, string>)[k] = v;
  }
  if (r.result) q.result = JSON.parse(String(r.result)) as AcceptResult;
  return q;
}
function toBatch(r: Row): ObservationBatchRow {
  return { agentId: String(r.agent_id), conversationId: String(r.conversation_id), userId: String(r.user_id), channel: String(r.channel),
    turnsSeen: Number(r.turns_seen), firstAt: String(r.first_at), lastAt: String(r.last_at) };
}
function toContribution(r: Row): StoredContribution {
  const c: StoredContribution = { id: String(r.id), userId: String(r.user_id), agentId: String(r.agent_id), field: String(r.field),
    value: String(r.value), basis: r.basis as Basis, createdAt: String(r.created_at) };
  if (r.revoked_at) c.revokedAt = String(r.revoked_at);
  if (r.evidence) c.evidence = JSON.parse(String(r.evidence)) as ContributionEvidence;
  return c;
}
function toReceipt(r: Row): ReceiptRow {
  const x: ReceiptRow = { id: String(r.id), userId: String(r.user_id), sessionId: String(r.session_id), agentId: String(r.agent_id),
    fields: JSON.parse(String(r.fields)) as Field[], purpose: String(r.purpose), createdAt: String(r.created_at) };
  if (r.amount !== null && r.amount !== undefined) x.amount = Number(r.amount);
  return x;
}
function toNote(r: Row): NoteRow {
  return { agentId: String(r.agent_id), userId: String(r.user_id), key: String(r.key), sessionId: String(r.session_id), value: String(r.value),
    updatedAt: String(r.updated_at), expiresAt: String(r.expires_at) };
}

export class Store {
  readonly db: Database.Database;
  private seq = 0;

  /** Set by the workspace: throws when the calling request started before the last reset (gate.ts). */
  private guard: () => void = () => undefined;

  constructor(path: string, opts: { busyTimeoutMs?: number } = {}) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    // Another connection (a second process, a console tool, a backup) may hold the write lock briefly:
    // wait for it instead of failing with SQLITE_BUSY. WAL lets readers proceed during a write.
    this.db.pragma(`busy_timeout = ${opts.busyTimeoutMs ?? 5000}`);
    // Deleted rows are overwritten, not left in free pages: observed conversation text must be gone once processed.
    this.db.pragma("secure_delete = ON");
    if (path !== ":memory:") this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
    this.migrate();
    for (const t of ["grants", "quotes", "contributions", "receipts"]) {
      const m = this.db.prepare(`SELECT COALESCE(MAX(seq), 0) AS m FROM ${t}`).get() as { m: number };
      this.seq = Math.max(this.seq, m.m);
    }
  }

  /** Add columns that an older database lacks, then record the schema version. Idempotent. */
  private migrate(): void {
    const current = Number(this.db.pragma("user_version", { simple: true }));
    if (current >= SCHEMA_VERSION) return;
    this.db.transaction(() => {
      for (const m of MIGRATIONS) {
        const cols = (this.db.prepare(`PRAGMA table_info(${m.table})`).all() as Array<{ name: string }>).map((c) => c.name);
        if (!cols.includes(m.column)) this.db.exec(m.ddl);
      }
      // v3: UCP store proxies are "retail" (any product), no longer "shoe" with a fixed kind.
      if (current < 3) this.db.exec("UPDATE agents SET category = 'retail', capabilities = '[]' WHERE domain IS NOT NULL AND category = 'shoe'");
      this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
    })();
  }

  schemaVersion(): number {
    return Number(this.db.pragma("user_version", { simple: true }));
  }

  setWriteGuard(guard: () => void): void {
    this.guard = guard;
  }

  /** Every write goes through here so a stale request (started before a reset) can never write. */
  private exec(sql: string, ...params: unknown[]): Database.RunResult {
    this.guard();
    return this.db.prepare(sql).run(...params);
  }

  /** Monotonic insertion order (timestamps can tie, and the test clock can move backwards). */
  private next(): number {
    return ++this.seq;
  }

  tx<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  clearAll(): void {
    this.tx(() => { for (const t of TABLES) this.exec(`DELETE FROM ${t}`); });
  }

  close(): void {
    this.db.close();
  }

  // ---- settings (per user; learning.paused lives here)
  setting(userId: string, key: string): string | undefined {
    const r = this.db.prepare("SELECT value FROM settings WHERE user_id = ? AND key = ?").get(userId, key) as Row | undefined;
    return r ? String(r.value) : undefined;
  }
  setSetting(userId: string, key: string, value: string): void {
    this.exec("INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value", userId, key, value);
  }

  // ---- observation queue (learning.ts). Only the user's own turns are stored, and only until processed.
  /** Add `seen` turns to the conversation's batch (creating it), storing the given user texts. Returns the batch. */
  enqueueObservation(b: { agentId: string; conversationId: string; userId: string; channel: string }, seen: number,
    userTurns: ObservationTurnRow[], now: string): ObservationBatchRow {
    this.tx(() => {
      this.exec(`INSERT INTO observation_batches (agent_id, conversation_id, user_id, channel, turns_seen, first_at, last_at) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (agent_id, conversation_id) DO UPDATE SET turns_seen = turns_seen + excluded.turns_seen, last_at = excluded.last_at, channel = excluded.channel`,
        b.agentId, b.conversationId, b.userId, b.channel, seen, now, now);
      for (const t of userTurns) {
        this.exec("INSERT INTO observation_turns (agent_id, conversation_id, seq, text, at) VALUES (?, ?, ?, ?, ?)",
          b.agentId, b.conversationId, this.next(), t.text, t.at);
      }
    });
    return this.observationBatch(b.agentId, b.conversationId)!;
  }
  observationBatch(agentId: string, conversationId: string): ObservationBatchRow | undefined {
    const r = this.db.prepare("SELECT * FROM observation_batches WHERE agent_id = ? AND conversation_id = ?").get(agentId, conversationId) as Row | undefined;
    return r && toBatch(r);
  }
  /** Batches idle since `idleBefore` or holding at least `minTurns` turns. */
  dueObservationBatches(idleBefore: string, minTurns: number): ObservationBatchRow[] {
    return (this.db.prepare("SELECT * FROM observation_batches WHERE last_at <= ? OR turns_seen >= ? ORDER BY first_at")
      .all(idleBefore, minTurns) as Row[]).map(toBatch);
  }
  /** Read a batch's user turns and delete the batch and its text in one transaction (the text lives on only in memory). */
  takeObservationBatch(agentId: string, conversationId: string): { batch: ObservationBatchRow; turns: ObservationTurnRow[] } | undefined {
    return this.tx(() => {
      const batch = this.observationBatch(agentId, conversationId);
      if (!batch) return undefined;
      const turns = (this.db.prepare("SELECT text, at FROM observation_turns WHERE agent_id = ? AND conversation_id = ? ORDER BY seq")
        .all(agentId, conversationId) as Row[]).map((r) => ({ text: String(r.text), at: String(r.at) }));
      this.exec("DELETE FROM observation_turns WHERE agent_id = ? AND conversation_id = ?", agentId, conversationId);
      this.exec("DELETE FROM observation_batches WHERE agent_id = ? AND conversation_id = ?", agentId, conversationId);
      return { batch, turns };
    });
  }
  /** Drop every waiting conversation of the user (learning paused). Returns how many. */
  dropObservations(userId: string): number {
    return this.tx(() => {
      const batches = (this.db.prepare("SELECT agent_id, conversation_id FROM observation_batches WHERE user_id = ?").all(userId) as Row[]);
      for (const b of batches) {
        this.exec("DELETE FROM observation_turns WHERE agent_id = ? AND conversation_id = ?", String(b.agent_id), String(b.conversation_id));
      }
      this.exec("DELETE FROM observation_batches WHERE user_id = ?", userId);
      return batches.length;
    });
  }
  /** After deleting observed text: move the overwritten pages out of the WAL so no copy of the text stays on disk. */
  checkpoint(): void {
    try {
      this.db.pragma("wal_checkpoint(TRUNCATE)");
    } catch {
      // ":memory:" or a busy reader: the next checkpoint catches up
    }
  }

  /** The user's intents, newest first. */
  intentsForUser(userId: string): IntentRow[] {
    return (this.db.prepare("SELECT * FROM intents WHERE user_id = ? ORDER BY created_at DESC, rowid DESC").all(userId) as Row[]).map(toIntent);
  }

  // ---- users
  insertUser(u: UserRow): void {
    this.exec("INSERT OR REPLACE INTO users (user_id, name, secret, created_at) VALUES (?, ?, ?, ?)", u.userId, u.name, u.secret, u.createdAt);
  }
  user(userId: string): UserRow | undefined {
    const r = this.db.prepare("SELECT * FROM users WHERE user_id = ?").get(userId) as Row | undefined;
    return r && { userId: String(r.user_id), name: String(r.name), secret: String(r.secret), createdAt: String(r.created_at) };
  }
  firstUser(): UserRow | undefined {
    const r = this.db.prepare("SELECT * FROM users ORDER BY rowid LIMIT 1").get() as Row | undefined;
    return r && { userId: String(r.user_id), name: String(r.name), secret: String(r.secret), createdAt: String(r.created_at) };
  }

  // ---- agents
  insertAgent(a: Agent): void {
    this.exec(`INSERT OR REPLACE INTO agents (agent_id, name, category, capabilities, callback_url, chat_endpoint, domain, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, a.agentId, a.name, a.category, JSON.stringify(a.capabilities), a.callbackUrl ?? null,
      a.chatEndpoint ?? null, a.domain ?? null, a.createdAt);
  }
  agent(agentId: string): Agent | undefined {
    const r = this.db.prepare("SELECT * FROM agents WHERE agent_id = ?").get(agentId) as Row | undefined;
    return r && toAgent(r);
  }
  agentByDomain(domain: string): Agent | undefined {
    const r = this.db.prepare("SELECT * FROM agents WHERE domain = ?").get(domain) as Row | undefined;
    return r && toAgent(r);
  }
  agents(): Agent[] {
    return (this.db.prepare("SELECT * FROM agents ORDER BY rowid").all() as Row[]).map(toAgent);
  }
  personalAgentIds(): string[] {
    return (this.db.prepare("SELECT agent_id FROM agents WHERE category = 'personal' ORDER BY agent_id").all() as Row[]).map((r) => String(r.agent_id));
  }

  // ---- keys
  insertKey(k: KeyRow): void {
    this.exec("INSERT OR REPLACE INTO keys (key_hash, agent_id, role, created_at) VALUES (?, ?, ?, ?)", k.keyHash, k.agentId, k.role, k.createdAt);
  }
  keyByHash(keyHash: string): KeyRow | undefined {
    const r = this.db.prepare("SELECT * FROM keys WHERE key_hash = ?").get(keyHash) as Row | undefined;
    return r && { keyHash: String(r.key_hash), agentId: String(r.agent_id), role: r.role as Role, createdAt: String(r.created_at) };
  }
  deleteKey(keyHash: string): void {
    this.exec("DELETE FROM keys WHERE key_hash = ?", keyHash);
  }
  hasOwnerKey(): boolean {
    return this.db.prepare("SELECT 1 FROM keys WHERE role = 'owner' LIMIT 1").get() !== undefined;
  }

  // ---- sessions
  /** Idempotent per sessionId. Returns the stored row (which may predate this call). */
  upsertSession(sessionId: string, userId: string, agentId: string, now: string): Session {
    this.exec("INSERT OR IGNORE INTO sessions (session_id, user_id, agent_id, created_at) VALUES (?, ?, ?, ?)", sessionId, userId, agentId, now);
    return this.session(sessionId)!;
  }
  session(sessionId: string): Session | undefined {
    const r = this.db.prepare("SELECT * FROM sessions WHERE session_id = ?").get(sessionId) as Row | undefined;
    return r && { sessionId: String(r.session_id), userId: String(r.user_id), agentId: String(r.agent_id), createdAt: String(r.created_at) };
  }
  sessionFor(userId: string, agentId: string): Session | undefined {
    const r = this.db.prepare("SELECT * FROM sessions WHERE user_id = ? AND agent_id = ?").get(userId, agentId) as Row | undefined;
    return r && { sessionId: String(r.session_id), userId: String(r.user_id), agentId: String(r.agent_id), createdAt: String(r.created_at) };
  }

  // ---- grants
  insertGrant(g: GrantRow): void {
    this.exec(`INSERT INTO grants (id, session_id, intent_id, fields, purpose, created_at, expires_at, revoked_at, seq)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, g.id, g.sessionId, g.intentId ?? null, JSON.stringify(g.fields), g.purpose, g.createdAt,
      g.expiresAt, g.revokedAt ?? null, this.next());
  }
  grant(id: string): GrantRow | undefined {
    const r = this.db.prepare("SELECT * FROM grants WHERE id = ?").get(id) as Row | undefined;
    return r && toGrant(r);
  }
  newestGrant(sessionId: string): GrantRow | undefined {
    const r = this.db.prepare("SELECT * FROM grants WHERE session_id = ? ORDER BY seq DESC LIMIT 1").get(sessionId) as Row | undefined;
    return r && toGrant(r);
  }
  /** Every grant of the session, newest first. */
  grantsForSession(sessionId: string): GrantRow[] {
    return (this.db.prepare("SELECT * FROM grants WHERE session_id = ? ORDER BY seq DESC").all(sessionId) as Row[]).map(toGrant);
  }
  revokeGrant(id: string, at: string): void {
    this.exec("UPDATE grants SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", at, id);
  }
  /** Revokes every not-yet-revoked grant of the session. */
  revokeSessionGrants(sessionId: string, at: string): void {
    this.exec("UPDATE grants SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL", at, sessionId);
  }
  grantsForUser(userId: string, limit = 200): Array<GrantRow & { agentId: string }> {
    const rows = this.db.prepare(`SELECT g.*, s.agent_id AS s_agent FROM grants g JOIN sessions s ON s.session_id = g.session_id
      WHERE s.user_id = ? ORDER BY g.seq DESC LIMIT ?`).all(userId, limit) as Row[];
    return rows.map((r) => ({ ...toGrant(r), agentId: String(r.s_agent) }));
  }

  // ---- intents
  insertIntent(i: IntentRow): void {
    this.exec(`INSERT INTO intents (id, user_id, agent_id, kind, public, text, query, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      i.id, i.userId, i.agentId, i.kind ?? "", JSON.stringify(i.public), i.text ?? null, i.query ?? null, i.createdAt, i.expiresAt);
  }
  intent(id: string): IntentRow | undefined {
    const r = this.db.prepare("SELECT * FROM intents WHERE id = ?").get(id) as Row | undefined;
    return r && toIntent(r);
  }
  addIntentSession(x: IntentSessionRow): void {
    this.exec("INSERT OR IGNORE INTO intent_sessions (intent_id, session_id, agent_id, channel) VALUES (?, ?, ?, ?)", x.intentId, x.sessionId, x.agentId, x.channel);
  }
  intentSessions(intentId: string): IntentSessionRow[] {
    return (this.db.prepare("SELECT * FROM intent_sessions WHERE intent_id = ? ORDER BY rowid").all(intentId) as Row[]).map((r) => ({
      intentId: String(r.intent_id), sessionId: String(r.session_id), agentId: String(r.agent_id), channel: r.channel as Channel }));
  }
  intentSession(intentId: string, sessionId: string): IntentSessionRow | undefined {
    return this.intentSessions(intentId).find((x) => x.sessionId === sessionId);
  }

  // ---- quotes
  insertQuote(q: QuoteRow): void {
    this.exec(`INSERT INTO quotes (id, intent_id, agent_id, session_id, text, price, currency, eta_date, eta_text, title, seller, variant_id,
      checkout_url, status, created_at, accepted_at, result, seq, source, size_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, q.id, q.intentId, q.agentId, q.sessionId, q.text, q.price, q.currency, q.etaDate ?? null, q.etaText ?? null, q.title ?? null,
        q.seller ?? null, q.variantId ?? null, q.checkoutUrl ?? null, q.status, q.createdAt, q.acceptedAt ?? null,
        q.result ? JSON.stringify(q.result) : null, this.next(), q.source ?? "live", q.sizeNote ?? null);
  }
  quote(id: string): QuoteRow | undefined {
    const r = this.db.prepare("SELECT * FROM quotes WHERE id = ?").get(id) as Row | undefined;
    return r && toQuote(r);
  }
  quotesForIntent(intentId: string): QuoteRow[] {
    return (this.db.prepare("SELECT * FROM quotes WHERE intent_id = ? ORDER BY seq").all(intentId) as Row[]).map(toQuote);
  }
  markQuoteAccepted(id: string, at: string): void {
    this.exec("UPDATE quotes SET status = 'accepted', accepted_at = ? WHERE id = ? AND accepted_at IS NULL", at, id);
  }
  setQuoteResult(id: string, result: AcceptResult): void {
    this.exec("UPDATE quotes SET status = ?, result = ? WHERE id = ?", result.status, JSON.stringify(result), id);
  }
  /** Purpose grounding: has the user accepted a quote by this agent, on this session, under this intent? */
  hasAcceptedQuote(intentId: string, sessionId: string, agentId: string): boolean {
    return this.db.prepare(`SELECT 1 FROM quotes WHERE intent_id = ? AND session_id = ? AND agent_id = ? AND accepted_at IS NOT NULL LIMIT 1`)
      .get(intentId, sessionId, agentId) !== undefined;
  }
  acceptedQuote(intentId: string, sessionId: string, agentId: string): QuoteRow | undefined {
    const r = this.db.prepare(`SELECT * FROM quotes WHERE intent_id = ? AND session_id = ? AND agent_id = ? AND accepted_at IS NOT NULL
      ORDER BY seq DESC LIMIT 1`).get(intentId, sessionId, agentId) as Row | undefined;
    return r && toQuote(r);
  }

  // ---- contributions and the card cache
  insertContribution(c: StoredContribution, origin: "seed" | "live" = "live"): void {
    this.exec(`INSERT INTO contributions (id, user_id, agent_id, field, value, basis, created_at, revoked_at, seq, origin, evidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      c.id, c.userId, c.agentId, c.field, c.value, c.basis, c.createdAt, c.revokedAt ?? null, this.next(), origin, c.evidence ? JSON.stringify(c.evidence) : null);
  }
  markSeed(id: string): void {
    this.exec("UPDATE contributions SET origin = 'seed' WHERE id = ?", id);
  }
  /** Non-revoked Sample seed contributions of the user (card provenance, B20). */
  seedContributions(userId: string): StoredContribution[] {
    return (this.db.prepare("SELECT * FROM contributions WHERE user_id = ? AND origin = 'seed' AND revoked_at IS NULL ORDER BY seq").all(userId) as Row[]).map(toContribution);
  }
  contribution(id: string): StoredContribution | undefined {
    const r = this.db.prepare("SELECT * FROM contributions WHERE id = ?").get(id) as Row | undefined;
    return r && toContribution(r);
  }
  contributionsForUser(userId: string): StoredContribution[] {
    return (this.db.prepare("SELECT * FROM contributions WHERE user_id = ? ORDER BY seq").all(userId) as Row[]).map(toContribution);
  }
  revokeContribution(id: string, at: string): void {
    this.exec("UPDATE contributions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", at, id);
  }
  saveCard(userId: string, card: Card, at: string): void {
    this.exec("INSERT OR REPLACE INTO cards (user_id, card, computed_at) VALUES (?, ?, ?)", userId, JSON.stringify(card), at);
  }
  card(userId: string): Card | undefined {
    const r = this.db.prepare("SELECT card FROM cards WHERE user_id = ?").get(userId) as Row | undefined;
    return r && (JSON.parse(String(r.card)) as Card);
  }

  // ---- notes
  notesFor(agentId: string, userId: string): NoteRow[] {
    return (this.db.prepare("SELECT * FROM notes WHERE agent_id = ? AND user_id = ? ORDER BY key").all(agentId, userId) as Row[]).map(toNote);
  }
  upsertNote(n: NoteRow): void {
    this.exec(`INSERT OR REPLACE INTO notes (agent_id, user_id, key, session_id, value, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`, n.agentId, n.userId, n.key, n.sessionId, n.value, n.updatedAt, n.expiresAt);
  }
  touchNote(agentId: string, userId: string, key: string, expiresAt: string): void {
    this.exec("UPDATE notes SET expires_at = ? WHERE agent_id = ? AND user_id = ? AND key = ?", expiresAt, agentId, userId, key);
  }
  deleteExpiredNotes(now: string): number {
    return this.exec("DELETE FROM notes WHERE expires_at <= ?", now).changes;
  }

  // ---- receipts
  insertReceipt(r: ReceiptRow): void {
    this.exec(`INSERT INTO receipts (id, user_id, session_id, agent_id, fields, purpose, amount, created_at, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, r.id, r.userId, r.sessionId, r.agentId, JSON.stringify(r.fields), r.purpose, r.amount ?? null, r.createdAt, this.next());
  }
  receiptsForUser(userId: string, limit: number): ReceiptRow[] {
    return (this.db.prepare("SELECT * FROM receipts WHERE user_id = ? ORDER BY seq DESC LIMIT ?").all(userId, limit) as Row[]).map(toReceipt);
  }
  releasedPurposeFields(sessionId: string): Field[] {
    const rows = this.db.prepare("SELECT fields FROM receipts WHERE session_id = ? AND purpose NOT IN ('tier0')").all(sessionId) as Row[];
    return [...new Set(rows.flatMap((r) => JSON.parse(String(r.fields)) as Field[]))];
  }

  // ---- activity
  insertActivity(e: Omit<ActivityEvent, "id">): void {
    this.exec("INSERT INTO activity (at, event, actor, object, result, reason) VALUES (?, ?, ?, ?, ?, ?)", e.at, e.event, e.actor, e.object, e.result, e.reason);
  }
  activity(limit: number): ActivityEvent[] {
    return (this.db.prepare("SELECT * FROM activity ORDER BY id DESC LIMIT ?").all(limit) as Row[]).map((r) => ({
      id: String(r.id), at: String(r.at), event: String(r.event), actor: String(r.actor), object: String(r.object), result: String(r.result),
      reason: String(r.reason) }));
  }

  // ---- idempotency
  idempotent(scope: string, key: string): { requestHash: string; status: number; body: string } | undefined {
    const r = this.db.prepare("SELECT * FROM idempotency WHERE scope = ? AND key = ?").get(scope, key) as Row | undefined;
    return r && { requestHash: String(r.request_hash), status: Number(r.status), body: String(r.body) };
  }
  saveIdempotent(scope: string, key: string, requestHash: string, status: number, body: string, at: string): void {
    this.exec("INSERT OR REPLACE INTO idempotency (scope, key, request_hash, status, body, created_at) VALUES (?, ?, ?, ?, ?, ?)", scope, key, requestHash, status, body, at);
  }
}
