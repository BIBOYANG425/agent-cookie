// Idempotency-Key for write routes (plan §5 "写操作带 Idempotency-Key", A13). Scoped per caller so one agent can
// never replay another's response. Same key + same body → stored response; same key + different body → 409.
// Concurrent requests with the same key wait for the first one instead of running twice.
import type { MiddlewareHandler } from "hono";
import type { Clock } from "./clock.js";
import type { Store } from "./db.js";
import { fail, json, readJson, type AppEnv } from "./http.js";
import { canonicalJson, sha256Hex } from "./ids.js";

export function idempotency(store: Store, clock: Clock): MiddlewareHandler<AppEnv> {
  const inflight = new Map<string, Promise<void>>();
  return async (c, next) => {
    const key = c.req.header("idempotency-key");
    if (!key) return next();
    if (key.length > 200) fail("MISSING_FIELD", "Idempotency-Key too long");
    const scope = `${c.get("agent").agentId} ${c.req.method} ${c.req.path}`;
    const body = await readJson(c);
    let hash: string;
    try {
      hash = sha256Hex(canonicalJson(body));
    } catch {
      fail("MISSING_FIELD", "body too deeply nested");
    }
    const slot = `${scope}\n${key}`;
    while (inflight.has(slot)) await inflight.get(slot);
    const hit = store.idempotent(scope, key);
    if (hit) {
      if (hit.requestHash !== hash) fail("IDEMPOTENCY_CONFLICT");
      c.res = new Response(hit.body, { status: hit.status, headers: { "content-type": "application/json; charset=utf-8", "idempotent-replay": "true" } });
      return;
    }
    let release!: () => void;
    inflight.set(slot, new Promise<void>((r) => { release = r; }));
    try {
      await next();
      if (c.res.status < 500 && !c.error) {
        store.saveIdempotent(scope, key, hash, c.res.status, await c.res.clone().text(), clock.nowIso());
      }
    } finally {
      inflight.delete(slot);
      release();
    }
  };
}

export { json };
