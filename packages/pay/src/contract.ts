import { WorkspaceError } from "@agent-cookie/contract";
import type { ErrorCode } from "@agent-cookie/contract";

export type { AuthorizePayment, PaymentAuthorization } from "@agent-cookie/contract";

export type LaneErrorCode = ErrorCode;

export class LaneError extends WorkspaceError {
  constructor(code: ErrorCode, message?: string) {
    super(code, message);
    this.name = "LaneError";
  }
}
