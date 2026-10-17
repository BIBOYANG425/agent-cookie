// Activity log: who did what to which object, with what result. NEVER field values (plan §4 T1).
import type { Clock } from "./clock.js";
import type { Store } from "./db.js";
import { logActivity } from "./telemetry.js";

export interface ActivityInput {
  event: string;
  actor: string;
  object?: string;
  result: string;
  /** Codes, field NAMES, purposes, step names. Never values, never upstream message text. */
  reason?: string;
}

export type Log = (e: ActivityInput) => void;

/** `stale()` true → the event belongs to a request a reset overtook: dropped, not written into the fresh database. */
export function activityLogger(store: Store, clock: Clock, stale: () => boolean = () => false): Log {
  return (e) => {
    if (stale()) return;
    store.insertActivity({ at: clock.nowIso(), event: e.event, actor: e.actor, object: e.object ?? "", result: e.result, reason: e.reason ?? "" });
    logActivity(e);
  };
}
