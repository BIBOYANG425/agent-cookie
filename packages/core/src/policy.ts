// Field policy table — docs/plan.md §5. Anything not listed is "deny".
import { FIELDS, type Category, type Field } from "./types.js";

export type ReadMode = "auto" | "purpose" | "deny";

/** For "purpose" fields: which declared purposes unlock the field for that category. */
const PURPOSES: Record<Category, Partial<Record<Field, string[]>>> = {
  personal: {},
  shoe: { shipping_address: ["checkout"], payment_method: ["payment"] },
  pharmacy: {
    shipping_address: ["delivery"],
    date_of_birth: ["prescription"],
    allergies: ["prescription"],
    payment_method: ["payment"],
  },
  hotel: { shipping_address: ["checkout"], payment_method: ["payment"] },
};

const AUTO: Record<Category, Field[]> = {
  personal: [...FIELDS],
  shoe: ["lang", "tone", "length", "shoe_size", "budget", "deadline"],
  pharmacy: ["lang", "tone", "length"],
  hotel: ["lang", "tone", "length", "budget", "deadline"],
};

const WRITE: Record<Category, Field[]> = {
  personal: [...FIELDS],
  shoe: ["shoe_size"],
  pharmacy: ["allergies"],
  hotel: [],
};

export function readMode(category: Category, field: Field): ReadMode {
  if (AUTO[category].includes(field)) return "auto";
  if (PURPOSES[category][field]) return "purpose";
  return "deny";
}

export function autoFields(category: Category): Field[] {
  return [...AUTO[category]];
}

export function purposeFields(category: Category): Field[] {
  return Object.keys(PURPOSES[category]) as Field[];
}

export function purposesFor(category: Category, field: Field): string[] {
  return [...(PURPOSES[category][field] ?? [])];
}

export type ReadDecision = "allow" | "PURPOSE_MISMATCH" | "SCOPE_DENIED";

/** Deterministic. The declared purpose is a parameter, never an authorization source by itself. */
export function canRead(category: Category, field: Field, purpose?: string): ReadDecision {
  const mode = readMode(category, field);
  if (mode === "auto") return "allow";
  if (mode === "purpose") {
    return purpose && PURPOSES[category][field]!.includes(purpose) ? "allow" : "PURPOSE_MISMATCH";
  }
  return "SCOPE_DENIED";
}

export function canWrite(category: Category, field: Field): boolean {
  return WRITE[category].includes(field);
}
