import { WorkspaceError } from "@agent-cookie/core";
import type { ErrorCode } from "@agent-cookie/core";

export type { AuthorizePayment, PaymentAuthorization } from "@agent-cookie/core";

export type LaneErrorCode = ErrorCode;

export class LaneError extends WorkspaceError {
  constructor(code: ErrorCode, message?: string) {
    super(code, message);
    this.name = "LaneError";
  }
}
