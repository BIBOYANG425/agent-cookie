// Field policy table — docs/plan.md v0.3 §5. Anything not listed is "deny". Deterministic; no model involved.
import { FIELDS, type Category, type Field } from "./types.js";

export type ReadMode = "auto" | "purpose" | "deny";

/** Readable with the handshake, no purpose needed. */
const AUTO: Record<Category, Field[]> = {
  personal: [...FIELDS],
  shoe: ["lang", "tone", "length", "shoe_size", "budget", "deadline"],
};

/** Readable only when the declared purpose matches. payment_method is purpose=payment for every merchant category (lane D). */
const PURPOSE: Record<Category, Partial<Record<Field, string[]>>> = {
  personal: {},
  shoe: { shipping_address: ["checkout"], payment_method: ["payment"] },
};

/** Writable through contributions. personal may use basis "stated"; merchants only "observed". */
const WRITE: Record<Category, Field[]> = {
  personal: [...FIELDS],
  shoe: ["shoe_size"],
};

export const POLICY_TABLE = { auto: AUTO, purpose: PURPOSE, write: WRITE } as const;

export function readMode(category: Category, field: Field): ReadMode {
  if (AUTO[category].includes(field)) return "auto";
  if (PURPOSE[category][field]) return "purpose";
  return "deny";
}

export function autoFields(category: Category): Field[] {
  return [...AUTO[category]];
}

export function purposeFields(category: Category): Field[] {
  return Object.keys(PURPOSE[category]) as Field[];
}

export function purposesFor(category: Category, field: Field): string[] {
  return [...(PURPOSE[category][field] ?? [])];
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
  const mode = readMode(category, field);
  if (mode === "auto") return "allow";
  if (mode === "purpose") {
    return purpose && PURPOSE[category][field]!.includes(purpose) ? "allow" : "PURPOSE_MISMATCH";
  }
  return "SCOPE_DENIED";
}

/** Plan §4 T0 signature: auto fields allow with any purpose; purpose fields only with a matching purpose. */
export function canRead(category: Category, field: Field, purpose?: string): "allow" | "deny" {
  return readDecision(category, field, purpose) === "allow" ? "allow" : "deny";
}

export function canWrite(category: Category, field: Field): boolean {
  return WRITE[category].includes(field);
}

/** Which basis values a category may write. */
export function allowedBases(category: Category): ReadonlyArray<"observed" | "stated"> {
  return category === "personal" ? ["observed", "stated"] : ["observed"];
}
