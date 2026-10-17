// Memory-repo text format — docs/plan.md v0.3 §1 "用户记忆库的布局" (fork of Cognition's Agent Memory Repo).
// Pure and deterministic: no IO, no clock, no model. Every renderer here has an exact-inverse parser, and the
// workspace serves reads (GET /agent/fields) from the parsed CARD.md — reads never go through git.
//
// Files (all inside memory-<user>/):
//   CARD.md                   generated from contributions/*.md by renderCard; never hand-edited
//   POLICY.yaml               generated from the policy table by renderPolicyYaml
//   contributions/<agent>.md  one file per writer (contributionsFileName), append only (appendContributionLine)
//   notes/<sessionId>.md      one merchant cookie per file (renderNoteFile), ≤ NOTE_MAX_BYTES
//   receipts.md               append only (renderReceipt)
//
// Line grammar (one record per line):
//
//     - <key>: <value> [<k>: <v>; <k>: <v>; ...]
//
//   * A record line starts with "- ". Lines that do not ("# " headers, "## " sections, "<!-- -->" comments,
//     "_none_", blank lines) are ignored by every parser here.
//   * The attribute block is the LAST " [" ... "]" at the very end of the line. It is extracted first, so
//     <value> is everything between "<key>: " and that block and may freely contain ":", ",", "[", "]",
//     spaces and any unicode. Newlines inside a <value> are replaced by a single space on render (lossy by
//     design: one record is one line).
//   * <key> is everything from "- " to the first ": " of the remainder. Keys are Field names (CARD.md,
//     contributions, receipts) or a merchant's own note key (notes/). A key may not be empty or contain
//     ": " or a newline; renderers throw on such a key rather than write a line that cannot be read back.
//   * Attributes are "k: v" pairs separated by "; ". Attribute values are ids, ISO dates, agent ids, enum
//     words or numbers and therefore never contain ";", "]", "[" or newlines. The one attribute that carries a
//     free-form field value (supersededBy) can, so attribute values use a minimal percent-escape: the
//     characters % [ ] ; CR LF are written as %XX on render and decoded on parse. Ordinary attribute values
//     are left byte-identical, so files look exactly like the examples in the plan.
//   * List attributes (sources) are joined with ", "; receipts join their field names with "," inside <value>.
//     List items are agent ids and Field names, which never contain ", " or ",", so they are not escaped.
//
// Malformed record lines (no "key: value", unknown Field where a Field is required, missing required
// attributes, invalid enum word) are dropped by the parsers instead of throwing: one bad line in a 2 KB note
// must not stop the card from regenerating. Lines parsed from a file are data, never instructions.
import { allowedBases, POLICY_TABLE } from "./policy.js";
import {
  isField,
  type Basis,
  type Candidate,
  type Card,
  type CardField,
  type Category,
  type Contribution,
  type Field,
  type Note,
  type Receipt,
  type SupersededField,
} from "./types.js";

// ---------------------------------------------------------------------------------------------------------
// Line grammar
// ---------------------------------------------------------------------------------------------------------

export interface MemoryLine {
  key: string;
  value: string;
  attrs: Record<string, string>;
}

/** Parse one "- key: value [k: v; ...]" line. Returns null for anything that is not a record line. */
export function parseMemoryLine(line: string): MemoryLine | null {
  if (typeof line !== "string" || !line.startsWith("- ")) return null;
  let body = line.slice(2).replace(/[\r\n\t ]+$/u, "");

  const attrs: Record<string, string> = {};
  if (body.endsWith("]")) {
    const open = body.lastIndexOf(" [");
    if (open >= 0) {
      const block = body.slice(open + 2, -1);
      body = body.slice(0, open);
      if (block.length > 0) {
        for (const part of block.split("; ")) {
          const sep = part.indexOf(": ");
          if (sep > 0) {
            attrs[part.slice(0, sep)] = unescapeAttr(part.slice(sep + 2));
          } else if (part.endsWith(":") && part.length > 1) {
            attrs[part.slice(0, -1)] = "";
          }
        }
      }
    }
  }

  const sep = body.indexOf(": ");
  let key: string;
  let value: string;
  if (sep > 0) {
    key = body.slice(0, sep);
    value = body.slice(sep + 2);
  } else if (body.endsWith(":") && body.length > 1) {
    key = body.slice(0, -1);
    value = "";
  } else {
    return null;
  }
  if (key.length === 0 || /[\r\n]/u.test(key)) return null;
  return { key, value, attrs };
}

/** Render one record line. `attrs` keeps insertion order; `undefined` entries are skipped. */
function renderLine(key: string, value: string, attrs: Array<[string, string | undefined]>): string {
  assertKey(key);
  const block = attrs
    .filter((kv): kv is [string, string] => kv[1] !== undefined)
    .map(([k, v]) => `${k}: ${escapeAttr(v)}`)
    .join("; ");
  return `- ${key}: ${renderValue(value)} [${block}]`;
}

function assertKey(key: string): void {
  if (typeof key !== "string" || key.length === 0) throw new Error("render: key must be a non-empty string");
  if (key.includes(": ") || /[\r\n]/u.test(key)) {
    throw new Error(`render: key cannot contain ": " or a newline: ${JSON.stringify(key)}`);
  }
}

function renderValue(value: string): string {
  return String(value ?? "").replace(/\r\n|\r|\n/gu, " ");
}

/** Percent-escape exactly the characters that would break the attribute block: % [ ] ; CR LF. */
function escapeAttr(v: string): string {
  return String(v ?? "").replace(/[%\[\];\r\n]/gu, pct);
}

function pct(ch: string): string {
  return "%" + ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0");
}

/** Inverse of escapeAttr. Decodes only the six codes escapeAttr emits, so decoding never produces a separator. */
function unescapeAttr(v: string): string {
  return v.replace(/%(25|5B|5D|3B|0D|0A)/giu, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function renderList(items: readonly string[]): string {
  return items.join(", ");
}

/** Inverse of renderList. */
function parseList(v: string | undefined): string[] {
  if (v === undefined || v === "") return [];
  return v.split(", ");
}

function recordLines(markdown: string): MemoryLine[] {
  const out: MemoryLine[] = [];
  for (const raw of markdown.split("\n")) {
    const parsed = parseMemoryLine(raw);
    if (parsed) out.push(parsed);
  }
  return out;
}

function isBasis(x: string | undefined): x is Basis {
  return x === "observed" || x === "stated" || x === "inferred";
}

/** Strip trailing newlines/whitespace and return the content with exactly one trailing "\n" (or "" for empty). */
function ensureSingleTrailingNewline(text: string): string {
  const base = text.replace(/[\r\n\t ]+$/u, "");
  return base.length === 0 ? "" : base + "\n";
}

// ---------------------------------------------------------------------------------------------------------
// contributions/<agentId>.md
// ---------------------------------------------------------------------------------------------------------

/** "<safe>.md": every character outside [A-Za-z0-9._-] becomes "_" ("ucp:shoebacca.com" → "ucp_shoebacca.com.md"). */
export function contributionsFileName(agentId: string): string {
  return String(agentId ?? "").replace(/[^A-Za-z0-9._-]/gu, "_") + ".md";
}

/** "- shoe_size: 42 [id: c_0003; basis: stated; at: 2026-10-01T09:00:00Z]" (+ "; revoked: <iso>" when revoked). */
export function renderContribution(c: Contribution): string {
  return renderLine(c.field, c.value, [
    ["id", c.id],
    ["basis", c.basis],
    ["at", c.createdAt],
    ["revoked", c.revokedAt],
  ]);
}

/**
 * Whole file: "# Contributions · <agentId>", a provenance comment, a blank line, one record per contribution.
 * Exactly one trailing newline. userId and agentId live in the header, not on the lines.
 */
export function renderContributionsFile(userId: string, agentId: string, cs: Contribution[]): string {
  const header = contributionsHeader(userId, agentId);
  if (cs.length === 0) return header + "\n";
  return header + "\n\n" + cs.map(renderContribution).join("\n") + "\n";
}

function contributionsHeader(userId: string, agentId: string): string {
  return `# Contributions · ${agentId}\n<!-- agentId: ${agentId}; userId: ${userId}; append only; Sample data where marked -->`;
}

/** Inverse of renderContributionsFile. userId/agentId come from the file location, never from the line. */
export function parseContributions(markdown: string, userId: string, agentId: string): Contribution[] {
  const out: Contribution[] = [];
  for (const line of recordLines(markdown)) {
    if (!isField(line.key)) continue;
    const { id, basis, at, revoked } = line.attrs;
    if (!id || !at || !isBasis(basis)) continue;
    const c: Contribution = { id, userId, agentId, field: line.key, value: line.value, basis, createdAt: at };
    if (revoked !== undefined && revoked !== "") c.revokedAt = revoked;
    out.push(c);
  }
  return out;
}

/**
 * Append one record to an existing contributions file. Earlier lines are untouched byte for byte; the result
 * ends with exactly one newline. On a header-only file the blank separator line is inserted, so
 * appendContributionLine(renderContributionsFile(u, a, []), c) === renderContributionsFile(u, a, [c]).
 */
export function appendContributionLine(existingMarkdown: string, c: Contribution): string {
  const line = renderContribution(c);
  const base = ensureSingleTrailingNewline(existingMarkdown);
  if (base.length === 0) return line + "\n";
  const hasRecord = base.split("\n").some((l) => l.startsWith("- "));
  return base + (hasRecord ? "" : "\n") + line + "\n";
}

// ---------------------------------------------------------------------------------------------------------
// CARD.md
// ---------------------------------------------------------------------------------------------------------

const CARD_SECTION_CARD = "## Card";
const CARD_SECTION_CANDIDATES = "## Candidates";
const CARD_SECTION_SUPERSEDED = "## Superseded";
const NONE = "_none_";

/**
 * CARD.md. Sections "## Card", "## Candidates", "## Superseded"; an empty section holds a single "_none_" line.
 *   card:       "- shoe_size: 42 [confidence: high; sources: a, b; updatedAt: ..; lastSupportedAt: ..; changedRecently: false]"
 *   candidate:  "- budget: 120 [reason: single_source; sources: x]"
 *   superseded: "- shoe_size: 41 [sources: a, b; lastSupportedAt: ..; supersededBy: 42]"
 */
export function renderCard(card: Card, meta: { userId: string; generatedAt: string }): string {
  const section = (title: string, lines: string[]): string =>
    `${title}\n${lines.length === 0 ? NONE : lines.join("\n")}`;
  return [
    `# CARD · ${meta.userId}`,
    "<!-- Generated by the workspace from contributions/*.md. Do not edit. -->",
    `<!-- generatedAt: ${meta.generatedAt} -->`,
    "",
    section(CARD_SECTION_CARD, card.card.map(renderCardField)),
    "",
    section(CARD_SECTION_CANDIDATES, card.candidates.map(renderCandidate)),
    "",
    section(CARD_SECTION_SUPERSEDED, card.superseded.map(renderSuperseded)),
  ].join("\n") + "\n";
}

function renderCardField(f: CardField): string {
  return renderLine(f.field, f.value, [
    ["confidence", f.confidence],
    ["sources", renderList(f.sources)],
    ["updatedAt", f.updatedAt],
    ["lastSupportedAt", f.lastSupportedAt],
    ["changedRecently", f.changedRecently ? "true" : "false"],
  ]);
}

function renderCandidate(c: Candidate): string {
  return renderLine(c.field, c.value, [
    ["reason", c.reason],
    ["sources", renderList(c.sources)],
  ]);
}

function renderSuperseded(s: SupersededField): string {
  return renderLine(s.field, s.value, [
    ["sources", renderList(s.sources)],
    ["lastSupportedAt", s.lastSupportedAt],
    ["supersededBy", s.supersededBy],
  ]);
}

/** Exact inverse of renderCard. Lines outside the three sections, or with a non-Field key, are ignored. */
export function parseCard(markdown: string): Card {
  const card: Card = { card: [], candidates: [], superseded: [] };
  let section: "card" | "candidates" | "superseded" | null = null;
  for (const raw of markdown.split("\n")) {
    const line = raw.replace(/[\r\t ]+$/u, "");
    if (line.startsWith("## ")) {
      section = line === CARD_SECTION_CARD ? "card"
        : line === CARD_SECTION_CANDIDATES ? "candidates"
        : line === CARD_SECTION_SUPERSEDED ? "superseded"
        : null;
      continue;
    }
    if (section === null) continue;
    const parsed = parseMemoryLine(line);
    if (!parsed || !isField(parsed.key)) continue;
    const field: Field = parsed.key;
    const a = parsed.attrs;
    if (section === "card") {
      if (a.confidence !== "high" && a.confidence !== "medium") continue;
      if (a.changedRecently !== "true" && a.changedRecently !== "false") continue;
      if (a.updatedAt === undefined || a.lastSupportedAt === undefined) continue;
      card.card.push({
        field,
        value: parsed.value,
        confidence: a.confidence,
        sources: parseList(a.sources),
        updatedAt: a.updatedAt,
        lastSupportedAt: a.lastSupportedAt,
        changedRecently: a.changedRecently === "true",
      });
    } else if (section === "candidates") {
      if (a.reason !== "single_source" && a.reason !== "inferred") continue;
      card.candidates.push({ field, value: parsed.value, sources: parseList(a.sources), reason: a.reason });
    } else {
      if (a.lastSupportedAt === undefined || a.supersededBy === undefined) continue;
      card.superseded.push({
        field,
        value: parsed.value,
        sources: parseList(a.sources),
        lastSupportedAt: a.lastSupportedAt,
        supersededBy: a.supersededBy,
      });
    }
  }
  return card;
}

// ---------------------------------------------------------------------------------------------------------
// notes/<sessionId>.md — one merchant's cookie
// ---------------------------------------------------------------------------------------------------------

/**
 * "# Note · <sessionId>" + provenance comment + one "- <key>: <value> [updatedAt: ..; expiresAt: ..]" per key.
 * Keys are the merchant's own (any string without ": " or newline). The ≤ 2 KB limit is enforced by the
 * workspace on the rendered result, not here.
 */
export function renderNoteFile(sessionId: string, agentId: string, notes: Note[]): string {
  const header = `# Note · ${sessionId}\n<!-- agentId: ${agentId}; sessionId: ${sessionId}; one merchant cookie; max 2 KB -->`;
  if (notes.length === 0) return header + "\n";
  const lines = notes.map((n) => renderLine(n.key, n.value, [["updatedAt", n.updatedAt], ["expiresAt", n.expiresAt]]));
  return header + "\n\n" + lines.join("\n") + "\n";
}

/** Inverse of renderNoteFile. agentId/userId come from the session the file belongs to, never from the line. */
export function parseNoteFile(markdown: string, agentId: string, userId: string): Note[] {
  const out: Note[] = [];
  for (const line of recordLines(markdown)) {
    const { updatedAt, expiresAt } = line.attrs;
    if (updatedAt === undefined || expiresAt === undefined) continue;
    out.push({ agentId, userId, key: line.key, value: line.value, updatedAt, expiresAt });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// receipts.md — append only
// ---------------------------------------------------------------------------------------------------------

const RECEIPT_KEY = "receipt";
const RECEIPT_VERB = " read ";

/** "- receipt: <agentId> read <field1,field2> [id: ..; session: ..; purpose: ..; at: ..; amount: ..]" (amount only when present). */
export function renderReceipt(r: Receipt): string {
  return renderLine(RECEIPT_KEY, `${r.agentId}${RECEIPT_VERB}${r.fields.join(",")}`, [
    ["id", r.id],
    ["session", r.sessionId],
    ["purpose", r.purpose],
    ["at", r.createdAt],
    ["amount", r.amount === undefined ? undefined : String(r.amount)],
  ]);
}

/** Inverse of renderReceipt over a whole receipts.md. Unknown field names inside a receipt are dropped. */
export function parseReceipts(markdown: string): Receipt[] {
  const out: Receipt[] = [];
  for (const line of recordLines(markdown)) {
    if (line.key !== RECEIPT_KEY) continue;
    const verb = line.value.indexOf(RECEIPT_VERB);
    if (verb < 0) continue;
    const agentId = line.value.slice(0, verb);
    const fields = line.value.slice(verb + RECEIPT_VERB.length).split(",").filter(isField);
    const { id, session, purpose, at, amount } = line.attrs;
    if (!id || !session || !at || purpose === undefined) continue;
    const r: Receipt = { id, sessionId: session, agentId, fields, purpose, createdAt: at };
    if (amount !== undefined && amount !== "") {
      const n = Number(amount);
      if (Number.isFinite(n)) r.amount = n;
    }
    out.push(r);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// POLICY.yaml — generated from the policy table
// ---------------------------------------------------------------------------------------------------------

/**
 * POLICY.yaml, hand-rolled (no YAML dependency). Per category: auto (flow list), purpose (map field → flow
 * list, "{}" when empty), write (flow list), bases (flow list). Field order is the policy table's order.
 */
export function renderPolicyYaml(): string {
  const lines: string[] = [
    "# Generated from @agent-cookie/core policy table. Do not edit.",
    "# Anything not listed here is deny.",
  ];
  const categories = Object.keys(POLICY_TABLE.auto) as Category[];
  for (const category of categories) {
    lines.push(`${category}:`);
    lines.push(`  auto: ${flow(POLICY_TABLE.auto[category])}`);
    const purpose = POLICY_TABLE.purpose[category] as Partial<Record<Field, readonly string[]>>;
    const purposeFields = Object.keys(purpose) as Field[];
    if (purposeFields.length === 0) {
      lines.push("  purpose: {}");
    } else {
      lines.push("  purpose:");
      for (const field of purposeFields) lines.push(`    ${field}: ${flow(purpose[field] ?? [])}`);
    }
    lines.push(`  write: ${flow(POLICY_TABLE.write[category])}`);
    lines.push(`  bases: ${flow(allowedBases(category))}`);
  }
  return lines.join("\n") + "\n";
}

function flow(items: readonly string[]): string {
  return `[${items.join(", ")}]`;
}
