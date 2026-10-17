// Bearer-key authentication. A key maps to {agentId, role}; the caller's claims about who it is are never used.
import type { MiddlewareHandler } from "hono";
import type { Role } from "@agent-cookie/contract";
import type { Store } from "./db.js";
import { fail, type AppEnv, type AuthedAgent } from "./http.js";
import { hashKey } from "./ids.js";

export const OWNER_AGENT_ID = "owner";

export function ownerAgent(createdAt: string): AuthedAgent {
  return { agentId: OWNER_AGENT_ID, name: "owner", category: "personal", capabilities: [], createdAt, role: "owner" };
}

export function authenticate(store: Store): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
    if (!m) fail("AUTH_REQUIRED");
    const row = store.keyByHash(hashKey(m[1]!));
    if (!row) fail("AUTH_REQUIRED");
    if (row.role === "owner") {
      c.set("agent", ownerAgent(row.createdAt));
    } else {
      const agent = store.agent(row.agentId);
      if (!agent) fail("AUTH_REQUIRED");
      c.set("agent", { ...agent, role: row.role });
    }
    await next();
  };
}

export function requireRole(...roles: Role[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!roles.includes(c.get("agent").role)) fail("SCOPE_DENIED", "wrong role for this route");
    await next();
  };
}
