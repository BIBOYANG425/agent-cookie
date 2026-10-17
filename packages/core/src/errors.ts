import type { ErrorCode } from "./types.js";

export const ERROR_STATUS: Record<ErrorCode, number> = {
  AUTH_REQUIRED: 401,
  SCOPE_DENIED: 403,
  PURPOSE_MISMATCH: 403,
  GRANT_MISSING: 403,
  GRANT_EXPIRED: 403,
  GRANT_REVOKED: 403,
  JAR_LOCKED: 403,
  NOT_FOUND: 404,
  IDEMPOTENCY_CONFLICT: 409,
  MISSING_FIELD: 422,
};

/** Wire shape of every error response. Never includes field names the caller is not allowed to know. */
export interface ErrorBody {
  error: { code: ErrorCode; message: string };
}

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
