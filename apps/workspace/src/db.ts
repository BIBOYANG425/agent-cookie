// SQLite store: every piece of state the workspace serves. Long-term data (contributions, notes, receipts)
// is also written through to the user's git memory repo (MemoryRepo), but reads never go there.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type {
  ActivityEvent, Agent, Basis, Card, Category, Contribution, ContributionEvidence, DataSource, Field, Grant, Intent, Note, PaymentAuthorization,
  Quote, Receipt, Role, Session, AcceptResult,
} from "@agent-cookie/contract";
import { isExperimentArm, isFunnelStage, type ExperimentArm, type SearchStats, type SellerStats } from "@agent-cookie/contract";

export interface UserRow { userId: string; name: string; secret: string; createdAt: string }
/** `label` is set only on keys the owner minted (POST /owner/keys); `revokedAt` once POST /owner/keys/:agentId/revoke revoked it. */
export interface KeyRow { keyHash: string; agentId: string; role: Role; createdAt: string; label?: string; revokedAt?: string }
/** Grant plus the intent it was issued under (purpose grounding needs it). */
export interface GrantRow extends Grant { intentId?: string; createdAt: string }
/** `kind` is the optional hint; `text` is absent only on legacy kind-only requests (see app.ts). */
export interface IntentRow extends Omit<Intent, "kind"> { kind?: string; agentId: string; text?: string; query?: string; createdAt: string }
export type Channel = "ucp" | "callback" | "tier0";
export interface IntentSessionRow { intentId: string; sessionId: string; agentId: string; channel: Channel }
export type QuoteStatus = "open" | "accepted" | AcceptResult["status"];
/**
 * `seq`: the store's monotonic insertion sequence (shared with grants, contributions and receipts), set on every row
 * read back and by insertQuote. Internal: the events stream sends it as the SSE id; it is never part of a Quote body.
 */
export interface QuoteRow extends Quote { sessionId: string; status: QuoteStatus; createdAt: string; acceptedAt?: string; result?: AcceptResult; seq?: number }
export interface NoteRow extends Note { sessionId: string }
export interface ReceiptRow extends Receipt { userId: string }
/** Contributions may carry an unknown field name when a merchant tried to write one (A11: stored inferred, never on the card). */
export type StoredContribution = Omit<Contribution, "field"> & { field: Field | string };
/**
 * A conversation waiting to be learned from: only its id, turn count and times (B49). The text never reaches SQLite;
 * it waits in process memory (services/observations.ts).
 */
export interface ObservationBatchRow { agentId: string; conversationId: string; userId: string; channel: string; turnsSeen: number; firstAt: string; lastAt: string }
/** Phase 5 merchant stats: counts over one agent_id, plus the (intent created, quote created) pairs for the median. */
export interface MerchantCounts { sessions: number; returningSessions: number; quotes: number; accepted: number; quoteTimes: Array<{ intentAt: string; quoteAt: string }> }
/** Phase 4 experiment: one intent that carries an arm, with its first accept time if it has one. */
export interface ArmRow { intentId: string; arm: ExperimentArm; createdAt: string; acceptedAt?: string }
/**
 * A consent link (bring-your-own-agent): an assistant asked the owner for a pairwise session. `status` is what was
 * decided; "expired" is never stored, it is computed against the clock (LinkService). `sessionId` is set on approval.
 */
export interface LinkRow { id: string; agentId: string; status: "pending" | "approved" | "declined"; createdAt: string; expiresAt: string; decidedAt?: string; sessionId?: string }
/**
 * Lane D payment (A21): an authorization with the two references that never leave the workspace — the provider's
 * (capture) and the card's payment_method token reference. Same shape as @agent-cookie/pay's InternalAuthorization.
 */
export interface PaymentAuthorizationRow extends PaymentAuthorization {
  providerRef: string; paymentMethodRef: string; agentId: string;
  /** v12: integer cents the provider's response authorized (what a reversal releases); absent on older rows. */
  authorizedAmount?: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (user_id TEXT PRIMARY KEY, name TEXT NOT NULL, secret TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agents (agent_id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, capabilities TEXT NOT NULL,
  callback_url TEXT, chat_endpoint TEXT, domain TEXT UNIQUE, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS keys (key_hash TEXT PRIMARY KEY, agent_id TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL, label TEXT, revoked_at TEXT);
CREATE TABLE IF NOT EXISTS sessions (session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, agent_id TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE (user_id, agent_id));
CREATE TABLE IF NOT EXISTS grants (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, intent_id TEXT, fields TEXT NOT NULL, purpose TEXT NOT NULL,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT, seq INTEGER NOT NULL, policy_id TEXT, stage TEXT);
CREATE INDEX IF NOT EXISTS grants_session ON grants (session_id, seq);
CREATE TABLE IF NOT EXISTS intents (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, agent_id TEXT NOT NULL, kind TEXT NOT NULL, public TEXT NOT NULL,
  text TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, query TEXT, arm TEXT);
CREATE TABLE IF NOT EXISTS intent_sessions (intent_id TEXT NOT NULL, session_id TEXT NOT NULL, agent_id TEXT NOT NULL, channel TEXT NOT NULL,
  PRIMARY KEY (intent_id, session_id));
CREATE TABLE IF NOT EXISTS quotes (id TEXT PRIMARY KEY, intent_id TEXT NOT NULL, agent_id TEXT NOT NULL, session_id TEXT NOT NULL, text TEXT NOT NULL,
  price INTEGER NOT NULL, currency TEXT NOT NULL, eta_date TEXT, eta_text TEXT, title TEXT, seller TEXT, variant_id TEXT, checkout_url TEXT,
  status TEXT NOT NULL, created_at TEXT NOT NULL, accepted_at TEXT, result TEXT, seq INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'live',
  size_note TEXT);
CREATE TABLE IF NOT EXISTS contributions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, agent_id TEXT NOT NULL, field TEXT NOT NULL, value TEXT NOT NULL,
  basis TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT, seq INTEGER NOT NULL, origin TEXT NOT NULL DEFAULT 'live', evidence TEXT,
  archived_at TEXT);
CREATE TABLE IF NOT EXISTS settings (user_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (user_id, key));
CREATE TABLE IF NOT EXISTS observation_batches (agent_id TEXT NOT NULL, conversation_id TEXT NOT NULL, user_id TEXT NOT NULL, channel TEXT NOT NULL,
  turns_seen INTEGER NOT NULL, first_at TEXT NOT NULL, last_at TEXT NOT NULL, PRIMARY KEY (agent_id, conversation_id));
CREATE INDEX IF NOT EXISTS observation_batches_user ON observation_batches (user_id, first_at);
CREATE TABLE IF NOT EXISTS cards (user_id TEXT PRIMARY KEY, card TEXT NOT NULL, computed_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notes (agent_id TEXT NOT NULL, user_id TEXT NOT NULL, key TEXT NOT NULL, session_id TEXT NOT NULL, value TEXT NOT NULL,
  updated_at TEXT NOT NULL, expires_at TEXT NOT NULL, PRIMARY KEY (agent_id, user_id, key));
CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, session_id TEXT NOT NULL, agent_id TEXT NOT NULL, fields TEXT NOT NULL,
  purpose TEXT NOT NULL, amount INTEGER, created_at TEXT NOT NULL, seq INTEGER NOT NULL, intent_id TEXT, policy_id TEXT);
CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, event TEXT NOT NULL, actor TEXT NOT NULL,
  object TEXT NOT NULL, result TEXT NOT NULL, reason TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS idempotency (scope TEXT NOT NULL, key TEXT NOT NULL, request_hash TEXT NOT NULL, status INTEGER NOT NULL,
  body TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (scope, key));
CREATE TABLE IF NOT EXISTS payment_authorizations (id TEXT PRIMARY KEY, quote_id TEXT NOT NULL UNIQUE, session_id TEXT, amount INTEGER,
  currency TEXT, status TEXT NOT NULL, provider_ref TEXT, payment_method_ref TEXT, agent_id TEXT, created_at TEXT, reserved_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS links (id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  decided_at TEXT, session_id TEXT);
CREATE INDEX IF NOT EXISTS links_agent ON links (agent_id, created_at);
`;

/** Columns added after the first schema, applied to existing databases (CREATE TABLE IF NOT EXISTS never alters). */
const MIGRATIONS: ReadonlyArray<{ version: number; table: string; column: string; ddl: string }> = [
  { version: 2, table: "quotes", column: "source", ddl: "ALTER TABLE quotes ADD COLUMN source TEXT NOT NULL DEFAULT 'live'" },
  { version: 2, table: "contributions", column: "origin", ddl: "ALTER TABLE contributions ADD COLUMN origin TEXT NOT NULL DEFAULT 'live'" },
  { version: 3, table: "intents", column: "query", ddl: "ALTER TABLE intents ADD COLUMN query TEXT" },
  { version: 3, table: "quotes", column: "size_note", ddl: "ALTER TABLE quotes ADD COLUMN size_note TEXT" },
  { version: 4, table: "contributions", column: "evidence", ddl: "ALTER TABLE contributions ADD COLUMN evidence TEXT" },
  { version: 6, table: "contributions", column: "archived_at", ddl: "ALTER TABLE contributions ADD COLUMN archived_at TEXT" },
  { version: 6, table: "activity", column: "kind", ddl: "ALTER TABLE activity ADD COLUMN kind TEXT" },
  { version: 6, table: "activity", column: "stats", ddl: "ALTER TABLE activity ADD COLUMN stats TEXT" },
  { version: 7, table: "receipts", column: "intent_id", ddl: "ALTER TABLE receipts ADD COLUMN intent_id TEXT" },
  { version: 8, table: "grants", column: "policy_id", ddl: "ALTER TABLE grants ADD COLUMN policy_id TEXT" },
  { version: 8, table: "receipts", column: "policy_id", ddl: "ALTER TABLE receipts ADD COLUMN policy_id TEXT" },
  { version: 9, table: "grants", column: "stage", ddl: "ALTER TABLE grants ADD COLUMN stage TEXT" },
  { version: 10, table: "intents", column: "arm", ddl: "ALTER TABLE intents ADD COLUMN arm TEXT" },
  // v11 (lane D, A21): payment_authorizations is a new TABLE, not a column: SCHEMA's CREATE TABLE IF NOT EXISTS adds it
  // to an older database on open, so there is no ALTER here; the version bump records that the database has it.
  // v12 (lane D): the amount the provider's response authorized — a reversal must name it, not the requested amount.
  { version: 12, table: "payment_authorizations", column: "authorized_amount", ddl: "ALTER TABLE payment_authorizations ADD COLUMN authorized_amount INTEGER" },
  // v13 (bring-your-own-agent): `links` (consent links of company assistants) is a new TABLE, added by SCHEMA's
  // CREATE TABLE IF NOT EXISTS like v11; the bump records that the database has it.
  // v14 (owner key minting): keys the owner minted carry a label; revoking one stamps revoked_at (it stops authenticating).
  { version: 14, table: "keys", column: "label", ddl: "ALTER TABLE keys ADD COLUMN label TEXT" },
  { version: 14, table: "keys", column: "revoked_at", ddl: "ALTER TABLE keys ADD COLUMN revoked_at TEXT" },
];
export const SCHEMA_VERSION = 14;

const TABLES = ["users", "agents", "keys", "sessions", "grants", "intents", "intent_sessions", "quotes", "contributions", "cards", "notes",
  "receipts", "activity", "idempotency", "settings", "observation_batches", "payment_authorizations", "links"] as const;

type Row = Record<string, unknown>;
const s = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : String(v));

function toKey(r: Row): KeyRow {
  const k: KeyRow = { keyHash: String(r.key_hash), agentId: String(r.agent_id), role: r.role as Role, createdAt: String(r.created_at) };
  if (r.label !== null && r.label !== undefined) k.label = String(r.label);
  if (r.revoked_at) k.revokedAt = String(r.revoked_at);
  return k;
}

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
  if (r.policy_id) g.policyId = String(r.policy_id);
  if (isFunnelStage(r.stage)) g.stage = r.stage;
  return g;
}
function toIntent(r: Row): IntentRow {
  const i: IntentRow = { id: String(r.id), userId: String(r.user_id), agentId: String(r.agent_id),
    public: JSON.parse(String(r.public)) as Record<string, string>, expiresAt: String(r.expires_at), createdAt: String(r.created_at) };
  if (r.kind) i.kind = String(r.kind);
  if (r.text) i.text = String(r.text);
  if (r.query) i.query = String(r.query);
  if (isExperimentArm(r.arm)) i.arm = r.arm;
  return i;
}
function toQuote(r: Row): QuoteRow {
  const q: QuoteRow = { id: String(r.id), intentId: String(r.intent_id), agentId: String(r.agent_id), sessionId: String(r.session_id),
    text: String(r.text), price: Number(r.price), currency: "USD", etaDate: s(r.eta_date) ?? null, status: r.status as QuoteStatus,
    createdAt: String(r.created_at), source: (s(r.source) ?? "live") as DataSource, seq: Number(r.seq) };
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
function toActivity(r: Row): ActivityEvent {
  const e: ActivityEvent = { id: String(r.id), at: String(r.at), event: String(r.event), actor: String(r.actor), object: String(r.object),
    result: String(r.result), reason: String(r.reason) };
  if (r.kind === "dreaming" || r.kind === "search" || r.kind === "rank") e.kind = r.kind;
  if (r.stats) e.stats = JSON.parse(String(r.stats)) as NonNullable<ActivityEvent["stats"]>;
  return e;
}
function toReceipt(r: Row): ReceiptRow {
  const x: ReceiptRow = { id: String(r.id), userId: String(r.user_id), sessionId: String(r.session_id), agentId: String(r.agent_id),
    fields: JSON.parse(String(r.fields)) as Field[], purpose: String(r.purpose), createdAt: String(r.created_at) };
  if (r.amount !== null && r.amount !== undefined) x.amount = Number(r.amount);
  if (r.intent_id) x.intentId = String(r.intent_id);
  if (r.policy_id) x.policyId = String(r.policy_id);
  return x;
}
const PAYMENT_STATUSES: ReadonlyArray<PaymentAuthorization["status"]> = ["authorized", "declined", "used", "reversed"];
function toPaymentAuthorization(r: Row): PaymentAuthorizationRow | undefined {
  const status = PAYMENT_STATUSES.find((x) => x === r.status);
  if (!status) return undefined;
  const row: PaymentAuthorizationRow = { id: String(r.id), sessionId: String(r.session_id), quoteId: String(r.quote_id), amount: Number(r.amount), currency: "USD",
    status, createdAt: String(r.created_at), providerRef: String(r.provider_ref), paymentMethodRef: String(r.payment_method_ref), agentId: String(r.agent_id) };
  if (r.authorized_amount !== null && r.authorized_amount !== undefined) row.authorizedAmount = Number(r.authorized_amount);
  return row;
}
const LINK_STATUSES: ReadonlyArray<LinkRow["status"]> = ["pending", "approved", "declined"];
function toLink(r: Row): LinkRow {
  const l: LinkRow = { id: String(r.id), agentId: String(r.agent_id), status: LINK_STATUSES.find((x) => x === r.status) ?? "declined",
    createdAt: String(r.created_at), expiresAt: String(r.expires_at) };
  if (r.decided_at) l.decidedAt = String(r.decided_at);
  if (r.session_id) l.sessionId = String(r.session_id);
  return l;
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
    // Deleted rows are overwritten, not left in free pages (the v5 migration drops stored conversation text).
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
      // v5 (B49): conversation text is never stored. Zero the old queue's text (secure_delete), then drop the table;
      // the batches it belonged to cannot be learned from any more.
      if (current < 5 && this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'observation_turns'").get()) {
        this.db.exec("DELETE FROM observation_turns; DROP TABLE observation_turns; DELETE FROM observation_batches;");
      }
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

  pendingForgets(userId: string): Array<{ field: string; ids: string[] }> {
    return (this.db.prepare("SELECT key, value FROM settings WHERE user_id = ? AND key LIKE 'learning.forget.%'").all(userId) as Row[])
      .map(row => ({ field: String(row.key).slice('learning.forget.'.length), ids: JSON.parse(String(row.value)) as string[] }));
  }
  completeForget(userId: string, field: string): void {
    this.exec("DELETE FROM settings WHERE user_id = ? AND key = ?", userId, `learning.forget.${field}`);
  }
  deletePreference(userId: string, field: string): void {
    this.exec("DELETE FROM contributions WHERE user_id = ? AND field = ?", userId, field);
    this.exec("DELETE FROM cards WHERE user_id = ?", userId);
  }

  // ---- observation queue mirror (learning.ts): ids, counts and times only; the text is in memory.
  /** Record a waiting conversation's counters (insert or update). */
  mirrorObservation(b: ObservationBatchRow): void {
    this.exec(`INSERT INTO observation_batches (agent_id, conversation_id, user_id, channel, turns_seen, first_at, last_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (agent_id, conversation_id) DO UPDATE SET turns_seen = excluded.turns_seen, last_at = excluded.last_at, channel = excluded.channel`,
      b.agentId, b.conversationId, b.userId, b.channel, b.turnsSeen, b.firstAt, b.lastAt);
  }
  observationBatch(agentId: string, conversationId: string): ObservationBatchRow | undefined {
    const r = this.db.prepare("SELECT * FROM observation_batches WHERE agent_id = ? AND conversation_id = ?").get(agentId, conversationId) as Row | undefined;
    return r && toBatch(r);
  }
  observationBatches(userId?: string): ObservationBatchRow[] {
    const rows = userId === undefined ? this.db.prepare("SELECT * FROM observation_batches ORDER BY first_at, rowid").all()
      : this.db.prepare("SELECT * FROM observation_batches WHERE user_id = ? ORDER BY first_at, rowid").all(userId);
    return (rows as Row[]).map(toBatch);
  }
  deleteObservationBatch(agentId: string, conversationId: string): void {
    this.exec("DELETE FROM observation_batches WHERE agent_id = ? AND conversation_id = ?", agentId, conversationId);
  }
  /** Drop every waiting conversation of the user, or of everyone (startup: their text did not survive). Returns how many. */
  dropObservations(userId?: string): number {
    return userId === undefined ? this.exec("DELETE FROM observation_batches").changes
      : this.exec("DELETE FROM observation_batches WHERE user_id = ?", userId).changes;
  }
  /**
   * After deleting observed text: move the overwritten pages out of the WAL and truncate it, so no copy of the text
   * stays on disk. Never waits for another connection (busy_timeout 0 for this call): if one holds the database, it
   * returns false and the caller retries on its next tick.
   */
  checkpoint(): boolean {
    const busyMs = Number(this.db.pragma("busy_timeout", { simple: true }));
    try {
      this.db.pragma("busy_timeout = 0");
      const [r] = this.db.pragma("wal_checkpoint(TRUNCATE)") as Array<{ busy: number; log: number; checkpointed: number }>;
      return !r || r.busy === 0;
    } catch {
      return false;
    } finally {
      this.db.pragma(`busy_timeout = ${busyMs}`);
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
  /**
   * agentIds whose "stated" contributions the merge trusts on a single source (MergeOptions.personalAgentIds): the user's
   * own agents, then every company assistant holding a live assist grant at `now` — purpose "assist" (services/assistant.ts
   * ASSIST_PURPOSE), no intent, not revoked, expiring after `now`. An assistant whose grant was revoked or expired drops
   * out, and its stated values count like learned ones until a new approved link puts it back.
   */
  trustedStatedAgentIds(now: string): string[] {
    const nowMs = Date.parse(now);
    const rows = this.db.prepare(`SELECT s.agent_id AS agent_id, g.expires_at AS expires_at FROM grants g
      JOIN sessions s ON s.session_id = g.session_id JOIN agents a ON a.agent_id = s.agent_id
      WHERE a.category = 'assistant' AND g.purpose = 'assist' AND g.intent_id IS NULL AND g.revoked_at IS NULL`).all() as Row[];
    const linked = new Set(rows.filter((r) => Date.parse(String(r.expires_at)) > nowMs).map((r) => String(r.agent_id)));
    return [...this.personalAgentIds(), ...[...linked].sort()];
  }

  // ---- keys
  insertKey(k: KeyRow): void {
    this.exec("INSERT OR REPLACE INTO keys (key_hash, agent_id, role, created_at, label, revoked_at) VALUES (?, ?, ?, ?, ?, ?)",
      k.keyHash, k.agentId, k.role, k.createdAt, k.label ?? null, k.revokedAt ?? null);
  }
  /** The live key with that hash: a revoked key is not returned, so it authenticates nothing (401 AUTH_REQUIRED). */
  keyByHash(keyHash: string): KeyRow | undefined {
    const r = this.db.prepare("SELECT * FROM keys WHERE key_hash = ? AND revoked_at IS NULL").get(keyHash) as Row | undefined;
    return r && toKey(r);
  }
  deleteKey(keyHash: string): void {
    this.exec("DELETE FROM keys WHERE key_hash = ?", keyHash);
  }
  hasOwnerKey(): boolean {
    return this.db.prepare("SELECT 1 FROM keys WHERE role = 'owner' LIMIT 1").get() !== undefined;
  }
  /** The owner key rows (hashes only): a blank instance's POST /demo/reset keeps its minted owner key. */
  ownerKeys(): KeyRow[] {
    return (this.db.prepare("SELECT * FROM keys WHERE role = 'owner' ORDER BY rowid").all() as Row[]).map(toKey);
  }
  /** Keys the owner minted (they carry a label), revoked ones included, newest first. */
  mintedKeys(): KeyRow[] {
    return (this.db.prepare("SELECT * FROM keys WHERE label IS NOT NULL ORDER BY created_at DESC, rowid DESC").all() as Row[]).map(toKey);
  }
  /** Whether the owner ever minted a key for the agent (revoked or not). */
  hasMintedKey(agentId: string): boolean {
    return this.db.prepare("SELECT 1 FROM keys WHERE agent_id = ? AND label IS NOT NULL LIMIT 1").get(agentId) !== undefined;
  }
  /** Revokes every live minted key of the agent; returns how many this call revoked. */
  revokeMintedKeys(agentId: string, at: string): number {
    return this.exec("UPDATE keys SET revoked_at = ? WHERE agent_id = ? AND label IS NOT NULL AND revoked_at IS NULL", at, agentId).changes;
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
    this.exec(`INSERT INTO grants (id, session_id, intent_id, fields, purpose, created_at, expires_at, revoked_at, seq, policy_id, stage)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, g.id, g.sessionId, g.intentId ?? null, JSON.stringify(g.fields), g.purpose, g.createdAt,
      g.expiresAt, g.revokedAt ?? null, this.next(), g.policyId ?? null, g.stage ?? null);
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
    this.exec(`INSERT INTO intents (id, user_id, agent_id, kind, public, text, query, created_at, expires_at, arm) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      i.id, i.userId, i.agentId, i.kind ?? "", JSON.stringify(i.public), i.text ?? null, i.query ?? null, i.createdAt, i.expiresAt, i.arm ?? null);
  }
  /** The user's intents created by one agent (a personal agent or an assistant), newest first. Assistant stats only. */
  intentsCreatedBy(userId: string, agentId: string): IntentRow[] {
    return (this.db.prepare("SELECT * FROM intents WHERE user_id = ? AND agent_id = ? ORDER BY created_at DESC, rowid DESC").all(userId, agentId) as Row[])
      .map(toIntent);
  }
  /** Phase 4: the user's intents that carry an arm, oldest first, each with its FIRST accept time (an intent may see two accepts). */
  armRows(userId: string): ArmRow[] {
    const rows = this.db.prepare(`SELECT i.id, i.arm, i.created_at, MIN(q.accepted_at) AS accepted_at FROM intents i
      LEFT JOIN quotes q ON q.intent_id = i.id AND q.accepted_at IS NOT NULL
      WHERE i.user_id = ? AND i.arm IS NOT NULL GROUP BY i.id ORDER BY i.created_at, i.rowid`).all(userId) as Row[];
    const out: ArmRow[] = [];
    for (const r of rows) {
      if (!isExperimentArm(r.arm)) continue;
      const x: ArmRow = { intentId: String(r.id), arm: r.arm, createdAt: String(r.created_at) };
      if (r.accepted_at) x.acceptedAt = String(r.accepted_at);
      out.push(x);
    }
    return out;
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
  /** Inserts the row and sets `q.seq` to the sequence it was stored under. */
  insertQuote(q: QuoteRow): number {
    const seq = this.next();
    this.exec(`INSERT INTO quotes (id, intent_id, agent_id, session_id, text, price, currency, eta_date, eta_text, title, seller, variant_id,
      checkout_url, status, created_at, accepted_at, result, seq, source, size_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, q.id, q.intentId, q.agentId, q.sessionId, q.text, q.price, q.currency, q.etaDate ?? null, q.etaText ?? null, q.title ?? null,
        q.seller ?? null, q.variantId ?? null, q.checkoutUrl ?? null, q.status, q.createdAt, q.acceptedAt ?? null,
        q.result ? JSON.stringify(q.result) : null, seq, q.source ?? "live", q.sizeNote ?? null);
    q.seq = seq;
    return seq;
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
  /** Phase 3: one seller's history over this user's intents (counts only; "blocked" accepts are the user's doing and not failures). */
  sellerStats(agentId: string, sellerDomain: string): SellerStats {
    const r = this.db.prepare(`SELECT
        (SELECT COUNT(*) FROM intent_sessions WHERE agent_id = ?) AS intents,
        COUNT(*) AS quotes,
        COALESCE(SUM(CASE WHEN accepted_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS accepted,
        COALESCE(SUM(CASE WHEN status = 'ordered' THEN 1 ELSE 0 END), 0) AS ordered,
        COALESCE(SUM(CASE WHEN status = 'handoff' THEN 1 ELSE 0 END), 0) AS handoff,
        COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed
      FROM quotes WHERE agent_id = ?`).get(agentId, agentId) as Row;
    return { sellerDomain, intents: Number(r.intents), quotes: Number(r.quotes), accepted: Number(r.accepted), ordered: Number(r.ordered),
      handoff: Number(r.handoff), failed: Number(r.failed) };
  }
  /**
   * Phase 5: one merchant's own counts — its sessions, those introduced to more than one intent, its quotes and the
   * accepted ones, and when each quote came relative to its intent. Every clause is keyed by this agent_id alone.
   */
  merchantCounts(agentId: string): MerchantCounts {
    const r = this.db.prepare(`SELECT
        (SELECT COUNT(*) FROM sessions WHERE agent_id = ?) AS sessions,
        (SELECT COUNT(*) FROM (SELECT x.session_id FROM intent_sessions x JOIN sessions s ON s.session_id = x.session_id
          WHERE s.agent_id = ? GROUP BY x.session_id HAVING COUNT(*) > 1)) AS returning_sessions,
        (SELECT COUNT(*) FROM quotes WHERE agent_id = ?) AS quotes,
        (SELECT COUNT(*) FROM quotes WHERE agent_id = ? AND accepted_at IS NOT NULL) AS accepted`).get(agentId, agentId, agentId, agentId) as Row;
    const times = this.db.prepare(`SELECT i.created_at AS intent_at, q.created_at AS quote_at FROM quotes q JOIN intents i ON i.id = q.intent_id
      WHERE q.agent_id = ? ORDER BY q.seq`).all(agentId) as Row[];
    return { sessions: Number(r.sessions), returningSessions: Number(r.returning_sessions), quotes: Number(r.quotes), accepted: Number(r.accepted),
      quoteTimes: times.map((t) => ({ intentAt: String(t.intent_at), quoteAt: String(t.quote_at) })) };
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
  /** Whether any contribution, revoked or not, came from the Sample seed (a blank instance refuses such a database). */
  hasSeedContribution(): boolean {
    return this.db.prepare("SELECT 1 FROM contributions WHERE origin = 'seed' LIMIT 1").get() !== undefined;
  }
  /** Non-revoked Sample seed contributions of the user (card provenance, B20). */
  seedContributions(userId: string): StoredContribution[] {
    return (this.db.prepare("SELECT * FROM contributions WHERE user_id = ? AND origin = 'seed' AND revoked_at IS NULL AND archived_at IS NULL ORDER BY seq")
      .all(userId) as Row[]).map(toContribution);
  }
  contribution(id: string): StoredContribution | undefined {
    const r = this.db.prepare("SELECT * FROM contributions WHERE id = ?").get(id) as Row | undefined;
    return r && toContribution(r);
  }
  /** The user's contributions, minus what Dreaming archived (they live in the memory repo's archive/ only). */
  contributionsForUser(userId: string): StoredContribution[] {
    return (this.db.prepare("SELECT * FROM contributions WHERE user_id = ? AND archived_at IS NULL ORDER BY seq").all(userId) as Row[]).map(toContribution);
  }
  /** Mirror a compaction: these contributions moved to the memory repo's archive/. */
  markArchived(ids: readonly string[], at: string): number {
    let n = 0;
    this.tx(() => { for (const id of ids) n += this.exec("UPDATE contributions SET archived_at = ? WHERE id = ? AND archived_at IS NULL", at, id).changes; });
    return n;
  }
  revokeContribution(id: string, at: string): void {
    // The evidence (the user's words) goes with it: a revoked value needs no reason to be kept.
    this.exec("UPDATE contributions SET revoked_at = ?, evidence = NULL WHERE id = ? AND revoked_at IS NULL", at, id);
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
    this.exec(`INSERT INTO receipts (id, user_id, session_id, agent_id, fields, purpose, amount, created_at, seq, intent_id, policy_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, r.id, r.userId, r.sessionId, r.agentId, JSON.stringify(r.fields), r.purpose, r.amount ?? null, r.createdAt, this.next(), r.intentId ?? null, r.policyId ?? null);
  }
  /** The newest receipt of one session for one purpose (receipt de-duplication, services/receipts.ts). */
  lastReceipt(sessionId: string, purpose: string): ReceiptRow | undefined {
    const r = this.db.prepare("SELECT * FROM receipts WHERE session_id = ? AND purpose = ? ORDER BY seq DESC LIMIT 1").get(sessionId, purpose) as Row | undefined;
    return r && toReceipt(r);
  }
  /** Every `fields.read` allow (field names, purpose and intent in `reason`), newest first. Policy shadow only. */
  fieldReadEvents(limit: number): ActivityEvent[] {
    const rows = this.db.prepare("SELECT * FROM activity WHERE event = 'fields.read' AND result = 'allow' ORDER BY id DESC LIMIT ?").all(limit) as Row[];
    return rows.map(toActivity);
  }
  receiptsForUser(userId: string, limit: number): ReceiptRow[] {
    return (this.db.prepare("SELECT * FROM receipts WHERE user_id = ? ORDER BY seq DESC LIMIT ?").all(userId, limit) as Row[]).map(toReceipt);
  }
  /** Receipts attributed to one intent (handshake reads, purpose releases and Tier 0 deliveries), oldest first. Funnel only. */
  receiptsForIntent(intentId: string): ReceiptRow[] {
    return (this.db.prepare("SELECT * FROM receipts WHERE intent_id = ? ORDER BY seq ASC").all(intentId) as Row[]).map(toReceipt);
  }
  /** Every grant issued for one intent (introduction and widenings), oldest first. Funnel only. */
  grantsForIntent(intentId: string): GrantRow[] {
    return (this.db.prepare("SELECT * FROM grants WHERE intent_id = ? ORDER BY seq ASC").all(intentId) as Row[]).map(toGrant);
  }
  /** `fields.read` allows whose reason carries `intent=<id>` (services/fields.ts), oldest first. Funnel only. */
  fieldReadsForIntent(intentId: string): ActivityEvent[] {
    const rows = this.db.prepare("SELECT * FROM activity WHERE event = 'fields.read' AND result = 'allow' AND instr(reason, ?) > 0 ORDER BY id ASC")
      .all(` intent=${intentId}`) as Row[];
    return rows.map(toActivity);
  }
  /** The filter counts the intent's `ucp.search` event carried, if the search ran. Funnel only. */
  searchStatsForIntent(intentId: string): SearchStats | undefined {
    const r = this.db.prepare("SELECT stats FROM activity WHERE event = 'ucp.search' AND kind = 'search' AND object = ? ORDER BY id DESC LIMIT 1")
      .get(intentId) as Row | undefined;
    return r?.stats ? (JSON.parse(String(r.stats)) as SearchStats) : undefined;
  }
  releasedPurposeFields(sessionId: string): Field[] {
    const rows = this.db.prepare("SELECT fields FROM receipts WHERE session_id = ? AND purpose NOT IN ('tier0', 'handshake')").all(sessionId) as Row[];
    return [...new Set(rows.flatMap((r) => JSON.parse(String(r.fields)) as Field[]))];
  }

  // ---- payment authorizations (lane D, A21). One row per quote, ever (quote_id UNIQUE): the row is RESERVED before the
  // provider is called and filled with its result after, so "one authorization per quote" survives a restart. A row
  // still "reserved" after a crash keeps the quote refused (AUTHORIZATION_USED) rather than risk a second hold.
  /** Claim the quote for authorization `id`; false when the quote already has a reservation or an authorization. */
  reservePaymentQuote(quoteId: string, id: string, at: string): boolean {
    return this.exec("INSERT OR IGNORE INTO payment_authorizations (id, quote_id, status, reserved_at) VALUES (?, ?, 'reserved', ?)", id, quoteId, at).changes === 1;
  }
  /** The provider call failed before any result: the quote may be tried again. Never removes a recorded authorization. */
  releasePaymentQuote(quoteId: string): void {
    this.exec("DELETE FROM payment_authorizations WHERE quote_id = ? AND status = 'reserved'", quoteId);
  }
  putPaymentAuthorization(a: PaymentAuthorizationRow): void {
    this.exec(`INSERT INTO payment_authorizations (id, quote_id, session_id, amount, currency, status, provider_ref, payment_method_ref, agent_id,
      created_at, reserved_at, authorized_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET session_id = excluded.session_id, amount = excluded.amount, currency = excluded.currency,
        status = excluded.status, provider_ref = excluded.provider_ref, payment_method_ref = excluded.payment_method_ref,
        agent_id = excluded.agent_id, created_at = excluded.created_at, authorized_amount = excluded.authorized_amount`,
      a.id, a.quoteId, a.sessionId, a.amount, a.currency, a.status, a.providerRef, a.paymentMethodRef, a.agentId, a.createdAt, a.createdAt,
      a.authorizedAmount ?? null);
  }
  /** A recorded authorization (a bare reservation is not one). */
  paymentAuthorization(id: string): PaymentAuthorizationRow | undefined {
    const r = this.db.prepare("SELECT * FROM payment_authorizations WHERE id = ? AND status <> 'reserved'").get(id) as Row | undefined;
    return r && toPaymentAuthorization(r);
  }
  paymentAuthorizationForQuote(quoteId: string): PaymentAuthorizationRow | undefined {
    const r = this.db.prepare("SELECT * FROM payment_authorizations WHERE quote_id = ? AND status <> 'reserved'").get(quoteId) as Row | undefined;
    return r && toPaymentAuthorization(r);
  }

  // ---- consent links (bring-your-own-agent)
  insertLink(l: LinkRow): void {
    this.exec("INSERT INTO links (id, agent_id, status, created_at, expires_at, decided_at, session_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      l.id, l.agentId, l.status, l.createdAt, l.expiresAt, l.decidedAt ?? null, l.sessionId ?? null);
  }
  link(id: string): LinkRow | undefined {
    const r = this.db.prepare("SELECT * FROM links WHERE id = ?").get(id) as Row | undefined;
    return r && toLink(r);
  }
  /** Newest first. */
  linksForAgent(agentId: string): LinkRow[] {
    return (this.db.prepare("SELECT * FROM links WHERE agent_id = ? ORDER BY created_at DESC, rowid DESC").all(agentId) as Row[]).map(toLink);
  }
  /** Newest first. */
  links(limit: number): LinkRow[] {
    return (this.db.prepare("SELECT * FROM links ORDER BY created_at DESC, rowid DESC LIMIT ?").all(limit) as Row[]).map(toLink);
  }
  /** Decide a link that is still pending; false when it was already decided (the caller answers LINK_NOT_PENDING). */
  decideLink(id: string, status: "approved" | "declined", at: string, sessionId?: string): boolean {
    return this.exec("UPDATE links SET status = ?, decided_at = ?, session_id = ? WHERE id = ? AND status = 'pending'",
      status, at, sessionId ?? null, id).changes === 1;
  }

  // ---- activity
  insertActivity(e: Omit<ActivityEvent, "id">): void {
    this.exec("INSERT INTO activity (at, event, actor, object, result, reason, kind, stats) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", e.at, e.event, e.actor,
      e.object, e.result, e.reason, e.kind ?? null, e.stats ? JSON.stringify(e.stats) : null);
  }
  activity(limit: number): ActivityEvent[] {
    return (this.db.prepare("SELECT * FROM activity ORDER BY id DESC LIMIT ?").all(limit) as Row[]).map(toActivity);
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
