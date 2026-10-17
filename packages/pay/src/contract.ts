// mirrors docs/plan.md §5; switch to @agent-cookie/core once lane A adds these
export interface PaymentAuthorization {
  id: string;
  sessionId: string;
  quoteId: string;
  amount: number; // minor units (cents), same as lane A Quote.price
  currency: "USD";
  status: "authorized" | "declined" | "used";
  createdAt: string;
}

export type AuthorizePayment = (a: {
  sessionId: string;
  quoteId: string;
  amount: number;
  currency: "USD";
}) => Promise<PaymentAuthorization>;

export type LaneErrorCode =
  | "AUTH_REQUIRED"
  | "SCOPE_DENIED"
  | "JAR_LOCKED"
  | "AUTHORIZATION_USED"
  | "OVER_BUDGET"
  | "NOT_FOUND"
  | "UPSTREAM_ERROR";

const errorStatuses: Record<LaneErrorCode, number> = {
  AUTH_REQUIRED: 401,
  SCOPE_DENIED: 403,
  JAR_LOCKED: 403,
  AUTHORIZATION_USED: 403,
  OVER_BUDGET: 403,
  NOT_FOUND: 404,
  UPSTREAM_ERROR: 502,
};

export class LaneError extends Error {
  readonly status: number;

  constructor(readonly code: LaneErrorCode, message = code) {
    super(message);
    this.name = "LaneError";
    this.status = errorStatuses[code];
  }

  toBody(): { error: { code: LaneErrorCode; message: string } } {
    return { error: { code: this.code, message: this.message } };
  }
}
