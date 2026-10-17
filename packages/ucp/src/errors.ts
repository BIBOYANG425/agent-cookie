export class UcpError extends Error {
  readonly code = "UPSTREAM_ERROR" as const;

  constructor(message = "UCP CLI failed", readonly detail?: unknown) {
    super(message);
    this.name = "UcpError";
  }
}
