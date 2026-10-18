// Receipts for releases an agent repeats on every message: an assistant's context read (purpose "assist"), a
// merchant's read of the handshake's auto fields, and the workspace's own read of the card for a UCP store proxy (both
// purpose "handshake"). Every release writes a receipt ("每次放行写回执"), but every receipt is a git commit, so a read
// that repeats the last one closely enough is not receipted again. One rule, here, for all of them. Field NAMES only.
import type { Receipt } from "@agent-cookie/contract";
import { persistStrict, writeMeta, type Ctx } from "./context.js";

/** The purpose of a receipt for auto fields read with (or, for a UCP store proxy, instead of) the handshake. */
export const HANDSHAKE_PURPOSE = "handshake";

/**
 * Receipt de-duplication window. A read writes NO new receipt when the newest receipt of the same session and purpose
 * named exactly the same field set, for the same intent (or both for none), under the same policy document, less than
 * RECEIPT_DEDUPE_MS ago on the workspace clock; any other read writes one. A read that releases no value writes none.
 * Callers log every read (counts only), receipted or not.
 */
export const RECEIPT_DEDUPE_MS = 60 * 60 * 1000;

export type ReceiptOutcome = "written" | "deduped" | "none";

export function sameFieldSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/** True when the newest stored receipt of `r`'s session and purpose makes `r` a repeat under the rule above. */
export function repeatsRecent(ctx: Pick<Ctx, "store" | "clock">, r: Pick<Receipt, "sessionId" | "purpose" | "fields" | "intentId" | "policyId">): boolean {
  const last = ctx.store.lastReceipt(r.sessionId, r.purpose);
  if (!last || last.policyId !== r.policyId || last.intentId !== r.intentId || !sameFieldSet(last.fields, r.fields)) return false;
  const age = ctx.clock.now() - Date.parse(last.createdAt);
  return age >= 0 && age < RECEIPT_DEDUPE_MS;
}

/**
 * Writes receipts one at a time, so two reads at once cannot both decide "no recent receipt". Git first (persistStrict:
 * a failed repo write fails the caller), then SQLite; the caller releases values only after this resolved.
 */
export class ReceiptWriter {
  private serial: Promise<unknown> = Promise.resolve();

  constructor(private ctx: Ctx) {}

  /**
   * `dedupe: false` always writes (a purpose release); otherwise repeatsRecent decides. An empty field list writes
   * nothing, unless `allowEmpty` (a release that is not a card field, e.g. the intent history an assistant reads:
   * services/assistant.ts HISTORY_PURPOSE).
   */
  write(r: Receipt, userId: string, actor: string, opts: { dedupe: boolean; allowEmpty?: boolean }): Promise<ReceiptOutcome> {
    const run = this.serial.then(async (): Promise<ReceiptOutcome> => {
      if (r.fields.length === 0 && opts.allowEmpty !== true) return "none";
      if (opts.dedupe && repeatsRecent(this.ctx, r)) return "deduped";
      await persistStrict(this.ctx, "receipt", actor, (repo) => repo.appendReceipt(r, writeMeta(this.ctx, "workspace", r)));
      this.ctx.store.insertReceipt({ ...r, userId });
      return "written";
    });
    this.serial = run.catch(() => undefined);
    return run;
  }
}
