// Field policy — docs/plan.md v0.3 §5. Anything not listed is "deny". Deterministic; no model involved.
// Since Phase 1 (docs/commerce-analytics-plan.md) the table is DATA: DEFAULT_POLICY in policy-document.ts is the frozen
// v1 document, and every function here evaluates it. The workspace evaluates the user's INSTALLED document instead
// (apps/workspace services/policy.ts); lanes B, C and D keep calling these signatures for the default.
import {
  DEFAULT_POLICY, evaluateRead, evaluateWrite, policyAutoFields, policyPurposeFields, policyPurposesFor, policyReadMode,
} from "./policy-document.js";
import type { Category, Field } from "./types.js";

export type ReadMode = "auto" | "purpose" | "deny";

/** The default document's three sections, for readers that still want the table shape (lane C's seed generator). */
export const POLICY_TABLE = { auto: DEFAULT_POLICY.auto, purpose: DEFAULT_POLICY.purpose, write: DEFAULT_POLICY.write, history: DEFAULT_POLICY.history } as const;

export function readMode(category: Category, field: Field): ReadMode {
  return policyReadMode(DEFAULT_POLICY, category, field);
}

export function autoFields(category: Category): Field[] {
  return policyAutoFields(DEFAULT_POLICY, category);
}

export function purposeFields(category: Category): Field[] {
  return policyPurposeFields(DEFAULT_POLICY, category);
}

export function purposesFor(category: Category, field: Field): string[] {
  return policyPurposesFor(DEFAULT_POLICY, category, field);
}

export type ReadDecision = "allow" | "PURPOSE_MISMATCH" | "SCOPE_DENIED";

/**
 * Why a read is allowed or refused BY POLICY. The declared purpose is a parameter supplied by the merchant;
 * it is only compared against the table, never trusted on its own.
 *
 * Policy is necessary, not sufficient, for purpose fields: the workspace additionally requires that the
 * session's intent has a quote by this same agent that the user ACCEPTED (purpose=checkout / payment). A merchant
 * that merely declares purpose=checkout without an accepted quote gets 403 PURPOSE_MISMATCH. That check needs
 * hot state and lives in the workspace (see isPurposeGrounded in apps/workspace), not here.
 */
export function readDecision(category: Category, field: Field, purpose?: string): ReadDecision {
  return evaluateRead(DEFAULT_POLICY, category, field, purpose);
}

/** Plan §4 T0 signature: auto fields allow with any purpose; purpose fields only with a matching purpose. */
export function canRead(category: Category, field: Field, purpose?: string): "allow" | "deny" {
  return readDecision(category, field, purpose) === "allow" ? "allow" : "deny";
}

export function canWrite(category: Category, field: Field): boolean {
  return evaluateWrite(DEFAULT_POLICY, category, field);
}

/** Which basis values a category may write. Not part of the document: the user's own agents state, merchants observe. */
export function allowedBases(category: Category): ReadonlyArray<"observed" | "stated"> {
  return category === "personal" ? ["observed", "stated"] : ["observed"];
}
