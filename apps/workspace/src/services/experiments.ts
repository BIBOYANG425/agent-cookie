// Holdout experiment E1 — docs/commerce-analytics-plan.md Phase 4. Outcome-aware ranking on (treatment) vs today's
// order (control), assigned per intent by a keyed hash so the split is deterministic, unpredictable to merchants and
// recomputable by the user. The arm is stored on the intent when it is created and read back, never recomputed, so an
// idempotent replay keeps it. The report is counts only and is rebuilt from the stored arms alone.
import { createHmac } from "node:crypto";
import { EXPERIMENT_ARMS, type ExperimentArm, type ExperimentArmStats, type ExperimentReport } from "@agent-cookie/contract";
import type { ArmRow } from "../db.js";
import { elapsedMs, median } from "./analytics.js";
import type { Ctx } from "./context.js";

/** The normative rule (contract ExperimentArm): low bit of the last byte of HMAC-SHA256(user secret, intentId). */
export function armFor(userSecret: string, intentId: string): ExperimentArm {
  const mac = createHmac("sha256", Buffer.from(userSecret, "utf8")).update(intentId, "utf8").digest();
  return (mac[mac.length - 1]! & 1) === 1 ? "treatment" : "control";
}

/** Two-sided 95 % normal quantile. */
export const Z95 = 1.96;

/**
 * Wilson score interval for `successes` out of `n`, clamped to [0, 1]. n = 0 → [0, 1] (nothing is known). The edges
 * are exact at 0 and n successes, and the interval always contains successes / n (floating point cannot push a
 * bound past the rate).
 */
export function wilson95(successes: number, n: number, z = Z95): [number, number] {
  if (n <= 0) return [0, 1];
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  const lo = successes <= 0 ? 0 : Math.max(0, Math.min(p, center - half));
  const hi = successes >= n ? 1 : Math.min(1, Math.max(p, center + half));
  return [lo, hi];
}

export function armStats(rows: readonly ArmRow[]): ExperimentArmStats {
  const n = rows.length;
  const acceptMs = rows.flatMap((r) => {
    if (r.acceptedAt === undefined) return [];
    const ms = elapsedMs(r.createdAt, r.acceptedAt);
    return ms === undefined ? [] : [ms];
  });
  const accepted = rows.filter((r) => r.acceptedAt !== undefined).length;
  const out: ExperimentArmStats = { n, accepted, rate: n === 0 ? 0 : accepted / n, wilson95: wilson95(accepted, n) };
  const m = median(acceptMs);
  if (m !== undefined) out.medianAcceptMs = m;
  return out;
}

export class ExperimentService {
  constructor(private ctx: Ctx) {}

  /** GET /owner/experiments: per arm, from the arms stored on this user's intents. */
  report(userId: string): ExperimentReport {
    const { store, clock, config } = this.ctx;
    const rows = store.armRows(userId);
    const arms = Object.fromEntries(EXPERIMENT_ARMS.map((a) => [a, armStats(rows.filter((r) => r.arm === a))])) as Record<ExperimentArm, ExperimentArmStats>;
    return { experiment: "ranking", arms, sample: config.ucpMode !== "live", generatedAt: clock.nowIso() };
  }
}
