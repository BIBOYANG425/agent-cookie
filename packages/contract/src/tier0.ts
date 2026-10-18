// Tier 0 text prefix (wire format) — docs/plan.md v0.3 §1 "接入阶梯".
// The only place a field VALUE is written into a message: auto fields of the merchant's category only.
// Purpose fields are listed by name with their purposes and never carry a value. Every delivery writes a receipt.
// Phase 1: the policy document is a parameter (default DEFAULT_POLICY); the workspace passes the installed one.
import { DEFAULT_POLICY, policyAutoFields, policyPurposeFields, policyPurposesFor, type PolicyDocument } from "./policy-document.js";
import type { Category, Field, Handshake } from "./types.js";

export interface Tier0Prefix {
  sessionId: string;
  /** Auto-field values in field order (lang, tone, length first, from the handshake). */
  auto: Array<{ field: Field; value: string }>;
  /** Purpose fields the merchant may ask for later, with the purposes that unlock them. Names only. */
  onRequest: Array<{ field: Field; purposes: string[] }>;
}

/**
 * Build the Tier 0 prefix from a handshake and the values the workspace resolved for auto fields.
 * `values` may contain anything (card ∪ intent overrides); only the category's auto fields that are
 * also listed in `h.available` survive. A purpose-field value passed in here is dropped, by construction.
 */
export function buildTier0Prefix(h: Handshake, category: Category, values: Partial<Record<Field, string>>, doc: PolicyDocument = DEFAULT_POLICY): Tier0Prefix {
  const allowed = new Set(policyAutoFields(doc, category).filter((f) => h.available.includes(f)));
  const style: Partial<Record<Field, string>> = { lang: h.lang, tone: h.tone, length: h.length };
  const auto: Tier0Prefix["auto"] = [];
  for (const field of policyAutoFields(doc, category)) {
    if (!allowed.has(field)) continue;
    const value = style[field] ?? values[field];
    if (value === undefined || value === "") continue;
    auto.push({ field, value });
  }
  const onRequest = policyPurposeFields(doc, category)
    .filter((f) => h.available.includes(f))
    .map((field) => ({ field, purposes: policyPurposesFor(doc, category, field) }));
  return { sessionId: h.sessionId, auto, onRequest };
}

/** `[agent-cookie] session k7f2 · lang zh · tone 简短 · shoe_size 42 · budget 120 · on request: shipping_address(checkout)` */
export function renderTier0Prefix(p: Tier0Prefix): string {
  const parts = [`session ${p.sessionId}`, ...p.auto.map((a) => `${a.field} ${a.value}`)];
  if (p.onRequest.length > 0) {
    parts.push(`on request: ${p.onRequest.map((r) => `${r.field}(${r.purposes.join("|")})`).join(", ")}`);
  }
  return `[agent-cookie] ${parts.join(" · ")}`;
}

export function renderHandshakePrefix(h: Handshake, category: Category, values: Partial<Record<Field, string>>, doc: PolicyDocument = DEFAULT_POLICY): string {
  return renderTier0Prefix(buildTier0Prefix(h, category, values, doc));
}
