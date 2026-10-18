// Policy as data — docs/commerce-analytics-plan.md Phase 1. The field policy is a versioned DOCUMENT the workspace
// evaluates; DEFAULT_POLICY (v1) is exactly the table plan §5 froze, and policy.ts keeps its old signatures as
// wrappers over it. A document a user installs is validated against the FLOOR below, which no document can lower:
// style fields ride every handshake, payment_method opens only for purpose "payment", shipping_address only for
// "checkout", merchants write only shoe_size, and the user's own agents read and write everything.
// Purpose "payment" is the workspace's own read of the token on the user's behalf (it also names the stage and the
// receipts); a merchant read of payment_method is refused whatever the document says, and merchants only ever see the
// authorization result.
// The evaluator is deterministic code over data; no model output is ever an input here.
import { createHash } from "node:crypto";
import type { RankingWeights } from "./analytics.js";
import type { ReadDecision, ReadMode } from "./policy.js";
import { FIELDS, isField, PREF_FIELDS, type Category, type Field } from "./types.js";

export const CATEGORIES: readonly Category[] = ["personal", "shoe", "retail"];
/** Purpose names are short lower-case tokens ("checkout", "payment"). */
export const PURPOSE_NAME = /^[a-z][a-z0-9_-]{0,31}$/;
/** Every handshake carries values for these three (A04); no document may take them out of `auto`. */
export const STYLE_FIELDS: readonly Field[] = ["lang", "tone", "length"];

/** v1: today's POLICY.yaml shape. Field order inside the arrays is significant (handshake `available`, Tier 0 prefix). */
export interface PolicyDocument {
  v: 1;
  /** Readable with the handshake, no purpose needed. */
  auto: Record<Category, Field[]>;
  /** Readable only when the declared purpose is listed. */
  purpose: Record<Category, Partial<Record<Field, string[]>>>;
  /** Writable through contributions. */
  write: Record<Category, Field[]>;
  /** Phase 3, optional: outcome-aware seller ranking weights. Absent = catalog order after size and preferences. */
  ranking?: RankingWeights;
}

const TOP_LEVEL_KEYS: ReadonlySet<string> = new Set(["v", "auto", "purpose", "write", "ranking"]);
const RANKING_KEYS: ReadonlySet<string> = new Set(["winRate", "failure"]);

const MERCHANT_AUTO: readonly Field[] = ["lang", "tone", "length", "shoe_size", "budget", "deadline"];

function deepFreeze<T>(x: T): T {
  if (x && typeof x === "object") {
    for (const v of Object.values(x as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(x);
  }
  return x;
}

/** The frozen table of plan v0.3 §5 (plus the 2026-10-17 retail/pref.* ruling), as a document. Its id is the seed's version. */
export const DEFAULT_POLICY: PolicyDocument = deepFreeze({
  v: 1,
  auto: {
    personal: [...FIELDS],
    shoe: [...MERCHANT_AUTO],
    // UCP store proxies also read the learned preferences (pref.*) with the handshake (2026-10-17).
    retail: [...MERCHANT_AUTO, ...PREF_FIELDS],
  },
  purpose: {
    personal: {},
    shoe: { shipping_address: ["checkout"], payment_method: ["payment"] },
    retail: { shipping_address: ["checkout"], payment_method: ["payment"] },
  },
  write: {
    personal: [...FIELDS],
    shoe: ["shoe_size"],
    retail: ["shoe_size"],
  },
});

/** JSON with object keys sorted at every level; array order is kept (it is meaningful). Two equal documents canonicalize equal. */
export function canonicalPolicy(doc: PolicyDocument): string {
  const sort = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(sort);
    if (x && typeof x === "object") {
      return Object.fromEntries(Object.keys(x as Record<string, unknown>).sort().map((k) => [k, sort((x as Record<string, unknown>)[k])]));
    }
    return x;
  };
  return JSON.stringify(sort(doc));
}

/** First 12 hex characters of SHA-256 over the canonical form. Stored on every grant and receipt the document allowed. */
export function policyId(doc: PolicyDocument): string {
  return createHash("sha256").update(canonicalPolicy(doc), "utf8").digest("hex").slice(0, 12);
}

export function policyReadMode(doc: PolicyDocument, category: Category, field: Field): ReadMode {
  if (doc.auto[category]?.includes(field)) return "auto";
  if (doc.purpose[category]?.[field]) return "purpose";
  return "deny";
}

/** Same semantics as policy.ts readDecision: the declared purpose is a parameter compared against the document, never trusted. */
export function evaluateRead(doc: PolicyDocument, category: Category, field: Field, purpose?: string): ReadDecision {
  const mode = policyReadMode(doc, category, field);
  if (mode === "auto") return "allow";
  if (mode === "purpose") return purpose !== undefined && doc.purpose[category]![field]!.includes(purpose) ? "allow" : "PURPOSE_MISMATCH";
  return "SCOPE_DENIED";
}

export function evaluateWrite(doc: PolicyDocument, category: Category, field: Field): boolean {
  return doc.write[category]?.includes(field) ?? false;
}

export function policyAutoFields(doc: PolicyDocument, category: Category): Field[] {
  return [...(doc.auto[category] ?? [])];
}

export function policyPurposeFields(doc: PolicyDocument, category: Category): Field[] {
  return Object.keys(doc.purpose[category] ?? {}) as Field[];
}

export function policyPurposesFor(doc: PolicyDocument, category: Category, field: Field): string[] {
  return [...(doc.purpose[category]?.[field] ?? [])];
}

/**
 * Shape and FLOOR check for a document a user wants to install. Empty list = may be installed. Messages name sections
 * and field names only (never values). Checks every problem it can find rather than stopping at the first.
 */
export function policyViolations(input: unknown): string[] {
  const out: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) return ["document must be an object"];
  const doc = input as Record<string, unknown>;
  if (doc.v !== 1) out.push("v must be 1");
  for (const k of Object.keys(doc)) if (!TOP_LEVEL_KEYS.has(k)) out.push(`${k}: unknown section`);
  if (doc.ranking !== undefined) {
    const r = doc.ranking;
    if (!r || typeof r !== "object" || Array.isArray(r)) {
      out.push("ranking must be an object { winRate, failure }");
    } else {
      for (const k of Object.keys(r)) if (!RANKING_KEYS.has(k)) out.push(`ranking.${k}: unknown weight`);
      for (const k of RANKING_KEYS) {
        const v = (r as Record<string, unknown>)[k];
        if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 100) out.push(`ranking.${k} must be an integer 0–100`);
      }
    }
  }
  const sections = ["auto", "purpose", "write"] as const;
  for (const s of sections) {
    const sec = doc[s];
    if (!sec || typeof sec !== "object" || Array.isArray(sec)) {
      out.push(`${s} must be an object keyed by category`);
      continue;
    }
    for (const k of Object.keys(sec)) if (!CATEGORIES.includes(k as Category)) out.push(`${s}.${k}: unknown category`);
    for (const c of CATEGORIES) if (!(c in (sec as object))) out.push(`${s}.${c} missing`);
  }
  if (out.length > 0) return out;

  const auto = doc.auto as Record<Category, unknown>;
  const purpose = doc.purpose as Record<Category, unknown>;
  const write = doc.write as Record<Category, unknown>;
  const fieldList = (where: string, v: unknown): Field[] | undefined => {
    if (!Array.isArray(v)) { out.push(`${where} must be a list of field names`); return undefined; }
    const seen = new Set<string>();
    const fields: Field[] = [];
    for (const f of v) {
      if (!isField(f)) { out.push(`${where}: ${String(f)} is not a field`); continue; }
      if (seen.has(f)) { out.push(`${where}: ${f} listed twice`); continue; }
      seen.add(f);
      fields.push(f);
    }
    return fields;
  };

  for (const c of CATEGORIES) {
    const a = fieldList(`auto.${c}`, auto[c]);
    const w = fieldList(`write.${c}`, write[c]);
    const p = purpose[c];
    const purposeFields: Field[] = [];
    if (!p || typeof p !== "object" || Array.isArray(p)) {
      out.push(`purpose.${c} must be an object keyed by field name`);
    } else {
      for (const [f, list] of Object.entries(p as Record<string, unknown>)) {
        if (!isField(f)) { out.push(`purpose.${c}: ${f} is not a field`); continue; }
        purposeFields.push(f);
        if (!Array.isArray(list) || list.length === 0) { out.push(`purpose.${c}.${f} must list at least one purpose`); continue; }
        const seen = new Set<string>();
        for (const name of list) {
          if (typeof name !== "string" || !PURPOSE_NAME.test(name)) out.push(`purpose.${c}.${f}: invalid purpose name`);
          else if (seen.has(name)) out.push(`purpose.${c}.${f}: purpose listed twice`);
          seen.add(String(name));
        }
      }
    }
    if (!a || !w) continue;
    for (const f of purposeFields) if (a.includes(f)) out.push(`${c}: ${f} cannot be both auto and purpose`);

    // ---- the floor ----
    for (const f of STYLE_FIELDS) if (!a.includes(f)) out.push(`auto.${c} must include ${f} (every handshake carries it)`);
    if (c === "personal") {
      for (const f of FIELDS) if (!a.includes(f)) out.push(`auto.personal must include ${f} (the user's own agents read everything)`);
      if (purposeFields.length > 0) out.push("purpose.personal must be empty");
      for (const f of FIELDS) if (!w.includes(f)) out.push(`write.personal must include ${f}`);
      continue;
    }
    if (a.includes("payment_method")) out.push(`auto.${c}: payment_method may never be auto`);
    if (a.includes("shipping_address")) out.push(`auto.${c}: shipping_address may never be auto`);
    const pm = (p as Partial<Record<Field, string[]>>)["payment_method"];
    if (Array.isArray(pm) && (pm.length !== 1 || pm[0] !== "payment")) out.push(`purpose.${c}.payment_method must be exactly ["payment"]`);
    const sa = (p as Partial<Record<Field, string[]>>)["shipping_address"];
    if (Array.isArray(sa) && (sa.length !== 1 || sa[0] !== "checkout")) out.push(`purpose.${c}.shipping_address must be exactly ["checkout"]`);
    for (const f of w) if (f !== "shoe_size") out.push(`write.${c}: merchants may write shoe_size only, not ${f}`);
  }
  return out;
}

export function isPolicyDocument(x: unknown): x is PolicyDocument {
  return policyViolations(x).length === 0;
}

/** Response of GET /personal/policy. `source`: where the installed document came from. */
export interface PolicyView {
  policy: PolicyDocument;
  policyId: string;
  /** "default" = compiled DEFAULT_POLICY; "repo" = POLICY.yaml in the memory repo; "installed" = PUT by the owner, held in SQLite. */
  source: "default" | "repo" | "installed";
}

/**
 * Response of POST /personal/policy/shadow: every past release (receipt) and every logged field read re-evaluated
 * under a candidate document, compared with the installed one. Ids, field NAMES and decision codes only.
 */
export interface ShadowReport {
  candidateId: string;
  currentId: string;
  changed: Array<{ ref: string; kind: "receipt" | "read"; field: Field; before: ReadDecision; after: ReadDecision }>;
  /** (ref, field) pairs whose decision is the same under both documents. */
  unchanged: number;
}
