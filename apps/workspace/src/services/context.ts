// Shared service context. `persist` writes through to the user's memory repo; SQLite stays the serving store,
// so a failed repo write is logged (activity "memory.write" failed) instead of failing the request.
import { WorkspaceError, type MemoryRepo, type RulesApi, type UcpApi, type WriteMeta } from "@agent-cookie/contract";
import { fail } from "../http.js";
import type { Log } from "../activity.js";
import type { Clock } from "../clock.js";
import type { Config } from "../config.js";
import type { Store } from "../db.js";
import { canonicalJson, sha256Hex } from "../ids.js";
import type { LaneDHooks } from "../laneD.js";
import type { Delivery } from "./delivery.js";
import type { PolicyService } from "./policy.js";

export interface Ctx {
  /** True when the calling request started before the last reset (gate.ts); such a request must not write. */
  stale: () => boolean;
  /** A reset is waiting or running (long polls return early). */
  closing: () => boolean;
  /** Run background work as part of the current request (gate.ts `hold`). */
  hold: <T>(fn: () => Promise<T>) => Promise<T>;
  config: Config;
  store: Store;
  clock: Clock;
  rules: RulesApi;
  ucp: UcpApi;
  repo: () => MemoryRepo;
  log: Log;
  delivery: Delivery;
  laneD: LaneDHooks;
  /** The user's installed field-policy document (Phase 1): every read, grant and Tier 0 prefix is evaluated against it. */
  policy: PolicyService;
}

/** What the write helpers below and the PolicyService need from the context (the policy service is built before the rest). */
export type WriteCtx = Pick<Ctx, "stale" | "repo" | "log" | "clock">;

export function writeMeta(ctx: WriteCtx, author: string, payload: unknown): WriteMeta {
  return { author, sig: sha256Hex(canonicalJson(payload)), at: ctx.clock.nowIso() };
}

/** Refuse any write from a request that a reset has overtaken (same answer as "does not exist"). */
export function assertFresh(ctx: WriteCtx): void {
  if (ctx.stale()) fail("NOT_FOUND");
}

/**
 * Write to the memory repo and FAIL the request if it does not land. Used for every record an agent or the user
 * asked for (contributions, revocations, notes, receipts): the repo is written first, SQLite only after it
 * succeeded, so an HTTP success always means the record is in git. The repo's own rules (e.g. the 2 KB note file)
 * are the authority; its WorkspaceErrors (MISSING_FIELD, SCOPE_DENIED) pass through unchanged.
 */
export async function persistStrict<T>(ctx: WriteCtx, what: string, actor: string, fn: (repo: MemoryRepo) => Promise<T>): Promise<T> {
  assertFresh(ctx);
  try {
    return await fn(ctx.repo());
  } catch (err) {
    if (!ctx.stale()) {
      ctx.log({ event: "memory.write", actor, object: what, result: "failed", reason: err instanceof WorkspaceError ? err.code : "error" });
    }
    if (err instanceof WorkspaceError) throw err;
    console.error(`[workspace] memory repo write failed (${what}):`, err);
    throw new Error(`memory repo write failed (${what})`);
  }
}

/** Best-effort write for derived artifacts only (CARD.md regeneration, startup reconciliation): logged, never fatal. */
export async function persist(ctx: Ctx, what: string, actor: string, fn: (repo: MemoryRepo) => Promise<unknown>): Promise<void> {
  if (ctx.stale()) return;
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
