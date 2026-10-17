// Agent Cookie contract v0.1 — frozen at T0 (2026-10-17). Changing anything here needs two lanes' agreement.
// Source: docs/plan.md §5.

export type Basis = "observed" | "stated" | "inferred";

export type Category = "personal" | "shoe" | "pharmacy" | "hotel";

export const FIELDS = [
  "lang", "tone", "length",
  "shoe_size", "budget", "deadline",
  "shipping_address", "date_of_birth", "allergies", "diet",
  "payment_method", // a payment-provider token reference, never a card number
] as const;
export type Field = (typeof FIELDS)[number];

export type Role = "personal" | "merchant" | "owner";

export interface Agent {
  agentId: string;
  name: string;
  category: Category;
  capabilities: string[];
  /** Merchant agents with their own HTTP callback (introduce / accepted events). */
  callbackUrl?: string;
  /** Tier-0 merchants: a plain chat endpoint that receives the handshake as a text prefix. */
  chatEndpoint?: string;
  createdAt: string;
}

export interface Contribution {
  id: string;
  userId: string;
  agentId: string;
  field: Field;
  value: string;
  basis: Basis;
  createdAt: string;
  revokedAt?: string;
}

export interface CardField {
  field: Field;
  value: string;
  confidence: "high" | "medium";
  sources: string[];
  updatedAt: string;
  lastSupportedAt: string;
  changedRecently: boolean;
}

export interface Candidate {
  field: Field;
  value: string;
  sources: string[];
  reason: "single_source" | "inferred";
}

export interface Card {
  card: CardField[];
  candidates: Candidate[];
}

export interface Session {
  sessionId: string;
  userId: string;
  agentId: string;
  createdAt: string;
}

export interface Grant {
  id: string;
  sessionId: string;
  /** Fields readable with the handshake (policy "auto"). */
  fields: Field[];
  /** Fields readable only with a matching purpose (policy "purpose"). */
  purposeFields: Field[];
  purpose: string;
  expiresAt: string;
  revokedAt?: string;
}

export interface Handshake {
  v: 1;
  sessionId: string;
  /** Workspace API base URL. The merchant calls this; no discovery needed. */
  jar: string;
  lang: string;
  tone: string;
  length: string;
  /** Field names only, never values. */
  available: Field[];
  expiresAt: string;
  /** Added by lane D (TD2). */
  sig?: string;
  kid?: string;
}

export interface Intent {
  id: string;
  userId: string;
  kind: string;
  public: Record<string, string>;
  createdAt: string;
  expiresAt: string;
}

export interface Quote {
  id: string;
  intentId: string;
  agentId: string;
  sessionId: string;
  text: string;
  price: number; // minor units (cents)
  currency: "USD";
  etaDate: string;
  /** UCP routing, when the merchant is a real Shopify store. */
  sellerDomain?: string;
  variantId?: string;
  checkoutUrl?: string;
  status: "open" | "accepted" | "ordered" | "lost" | "blocked";
}

export interface Receipt {
  id: string;
  sessionId: string;
  agentId: string;
  fields: Field[];
  purpose: string;
  result: "allowed" | "denied";
  code?: ErrorCode;
  createdAt: string;
}

export interface Note {
  agentId: string;
  userId: string;
  key: string;
  value: string;
  updatedAt: string;
  expiresAt: string;
}

export interface ActivityEvent {
  at: string;
  event: string;
  actor: string;
  object: string;
  result: string;
  reason: string;
}

export type ErrorCode =
  | "AUTH_REQUIRED"
  | "SCOPE_DENIED"
  | "PURPOSE_MISMATCH"
  | "GRANT_MISSING"
  | "GRANT_EXPIRED"
  | "GRANT_REVOKED"
  | "NOT_FOUND"
  | "MISSING_FIELD"
  | "IDEMPOTENCY_CONFLICT"
  | "JAR_LOCKED";

export const GRANT_TTL_MS = 10 * 60 * 1000;
export const NOTE_MAX_BYTES = 2048;
export const NOTE_TTL_DAYS = 365;
export const CARD_DECAY_MEDIUM_DAYS = 180;
export const CARD_DROP_DAYS = 365;
