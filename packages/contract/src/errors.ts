import type { ErrorBody, ErrorCode } from "./types.js";

export const ERROR_STATUS: Record<ErrorCode, number> = {
  AUTH_REQUIRED: 401,
  SCOPE_DENIED: 403,
  GRANT_EXPIRED: 403,
  GRANT_REVOKED: 403,
  PURPOSE_MISMATCH: 403,
  JAR_LOCKED: 403,
  AUTHORIZATION_USED: 403,
  OVER_BUDGET: 403,
  NOT_FOUND: 404,
  IDEMPOTENCY_CONFLICT: 409,
  MISSING_FIELD: 422,
  UPSTREAM_ERROR: 502,
};

export class WorkspaceError extends Error {
  constructor(public code: ErrorCode, message?: string) {
    super(message ?? code);
    this.name = "WorkspaceError";
  }
  get status(): number {
    return ERROR_STATUS[this.code];
  }
  toBody(): ErrorBody {
    return { error: { code: this.code, message: this.message } };
  }
}

/** ucp / Photon / payment provider failed. 502 UPSTREAM_ERROR; carries the upstream's continue_url when it gave one. */
export class UpstreamError extends WorkspaceError {
  constructor(message: string, public continueUrl?: string) {
    super("UPSTREAM_ERROR", message);
    this.name = "UpstreamError";
  }
  override toBody(): ErrorBody & { continueUrl?: string } {
    return this.continueUrl ? { ...super.toBody(), continueUrl: this.continueUrl } : super.toBody();
  }
}

export function isErrorBody(x: unknown): x is ErrorBody {
  return typeof x === "object" && x !== null && "error" in x
    && typeof (x as ErrorBody).error?.code === "string";
}
