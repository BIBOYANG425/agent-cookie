// Shared service context. `persist` writes through to the user's memory repo; SQLite stays the serving store,
// so a failed repo write is logged (activity "memory.write" failed) instead of failing the request.
import type { MemoryRepo, RulesApi, UcpApi, WriteMeta } from "@agent-cookie/contract";
import type { Log } from "../activity.js";
import type { Clock } from "../clock.js";
import type { Config } from "../config.js";
import type { Store } from "../db.js";
import { canonicalJson, sha256Hex } from "../ids.js";
import type { Delivery } from "./delivery.js";

export interface Ctx {
  config: Config;
  store: Store;
  clock: Clock;
  rules: RulesApi;
  ucp: UcpApi;
  repo: () => MemoryRepo;
  log: Log;
  delivery: Delivery;
}

export function writeMeta(ctx: Ctx, author: string, payload: unknown): WriteMeta {
  return { author, sig: sha256Hex(canonicalJson(payload)), at: ctx.clock.nowIso() };
}

export async function persist(ctx: Ctx, what: string, actor: string, fn: (repo: MemoryRepo) => Promise<unknown>): Promise<void> {
  try {
    await fn(ctx.repo());
  } catch (err) {
    ctx.log({ event: "memory.write", actor, object: what, result: "failed", reason: err instanceof Error ? err.name : "error" });
    console.error(`[workspace] memory repo write failed (${what}):`, err);
  }
}

/** The hackathon has one user; every personal agent and the owner act for it. */
export function theUser(store: Store): string {
  const u = store.firstUser();
  if (!u) throw new Error("no user seeded");
  return u.userId;
}
