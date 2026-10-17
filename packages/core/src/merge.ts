// Card merge rules — docs/plan.md §4 T0-4 and §5 "规模与时间规则". Pure; no IO.
import type { Card, Contribution } from "./types.js";

export interface MergeOptions {
  /** Injected clock for tests. ISO string. */
  now?: string;
}

/**
 * Rules:
 *  - same field+value from ≥2 distinct agentIds with basis≠inferred → on card (confidence high)
 *  - personal "stated", single source → on card (confidence medium)
 *  - inferred → never on card (candidate, reason "inferred")
 *  - single non-personal source → candidate, reason "single_source"
 *  - several qualifying values for one field → newest wins; older values stay in history (superseded)
 *  - newest value with one source → medium + changedRecently
 *  - lastSupportedAt > 180 days → medium; > 365 days → dropped
 *  - personal stated always overrides immediately
 */
export function mergeCard(contributions: Contribution[], options: MergeOptions = {}): Card {
  void contributions; void options;
  throw new Error("mergeCard: implemented by the core subagent (T0-4)");
}
