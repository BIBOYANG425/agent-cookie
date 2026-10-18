// Error handling and request helpers. Every error body is { error: { code, message } } with a generic message:
// never a field name or a value the caller may not know (A05), and NOT_FOUND is byte-identical everywhere (A08).
import type { Context, Hono } from "hono";
import { WorkspaceError, type Agent, type ErrorCode, type Role } from "@agent-cookie/contract";
import { captureUnhandled } from "./telemetry.js";

export interface AuthedAgent extends Agent {
  role: Role;
}

export type AppEnv = { Variables: { agent: AuthedAgent } };

const MESSAGES: Record<ErrorCode, string> = {
  AUTH_REQUIRED: "authentication required",
  SCOPE_DENIED: "not allowed for this agent",
  GRANT_EXPIRED: "grant expired",
  GRANT_REVOKED: "grant revoked",
  PURPOSE_MISMATCH: "purpose does not match the field's policy",
  NOT_FOUND: "not found",
  IDEMPOTENCY_CONFLICT: "idempotency key reused with a different request",
  LINK_NOT_PENDING: "link already decided or expired",
  MISSING_FIELD: "missing or invalid request field",
  UPSTREAM_ERROR: "upstream service failed",
  JAR_LOCKED: "jar is locked",
  AUTHORIZATION_USED: "payment authorization already used",
  OVER_BUDGET: "amount exceeds the budget",
};

/** Throw a contract error. NOT_FOUND ignores `message` so every 404 is identical. */
export function fail(code: ErrorCode, message?: string): never {
  throw new WorkspaceError(code, code === "NOT_FOUND" || message === undefined ? MESSAGES[code] : message);
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
}

export function installErrorHandling(app: Hono<AppEnv>): void {
  app.onError((err) => {
    if (err instanceof WorkspaceError) return json(err.toBody(), err.status);
    console.error("[workspace] unhandled error:", err);
    captureUnhandled(err);
    return json({ error: { code: "UPSTREAM_ERROR", message: "internal error" } }, 500);
  });
  app.notFound(() => json({ error: { code: "NOT_FOUND", message: MESSAGES.NOT_FOUND } }, 404));
}

/** Parsed JSON body ({} when empty). Hono caches the body, so middleware and handler can both call this. */
export async function readJson(c: Context): Promise<Record<string, unknown>> {
  const text = await c.req.text();
  if (text.trim() === "") return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail("MISSING_FIELD", "body is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail("MISSING_FIELD", "body must be a JSON object");
  return parsed as Record<string, unknown>;
}

export function str(body: Record<string, unknown>, name: string, opts: { max?: number } = {}): string {
  const v = body[name];
  if (typeof v !== "string" || v.trim() === "") fail("MISSING_FIELD", `missing ${name}`);
  if (Buffer.byteLength(v, "utf8") > (opts.max ?? 4096)) fail("MISSING_FIELD", `${name} too long`);
  return v;
}

export function optStr(body: Record<string, unknown>, name: string, opts: { max?: number } = {}): string | undefined {
  const v = body[name];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") fail("MISSING_FIELD", `invalid ${name}`);
  if (Buffer.byteLength(v, "utf8") > (opts.max ?? 4096)) fail("MISSING_FIELD", `${name} too long`);
  return v;
}

export function query(c: Context, name: string): string {
  const v = c.req.query(name);
  if (!v) fail("MISSING_FIELD", `missing ${name}`);
  return v;
}
