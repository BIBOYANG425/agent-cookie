// Push instead of poll (docs/commerce-analytics-plan.md §8): GET /personal/intents/:id/events as server-sent events.
// The long-poll GET /personal/intents/:id/quotes?wait= (QUOTE_POLL_MAX_MS) stays as the fallback.
import type { Quote } from "./types.js";

/**
 * One event on GET /personal/intents/:id/events (`text/event-stream`). Each event is one SSE frame:
 *
 *     event: <IntentEvent.type>
 *     data: <JSON of the IntentEvent>
 *     id: <quote seq>                  (quote events only)
 *
 * The SSE `id` of a quote frame is that quote's insertion sequence in the workspace: decimal digits, strictly
 * increasing in insertion order, otherwise opaque (gaps are normal). A client that reconnects with
 * `Last-Event-ID: <id>` gets only the quotes inserted after it, then the live ones; `complete` and `expired`
 * frames carry no id, so they never move the resume point. A quote's payload is exactly what GET …/quotes returns
 * for the same quote: no field value beyond it.
 *
 *  quote    — existing quotes first, in sequence order, then each new quote as it is inserted.
 *  complete — every introduced merchant that can quote (every introduction but Tier 0) has quoted; the same rule
 *             as `complete` on GET …/quotes. The stream closes after it.
 *  expired  — the intent's `expiresAt` passed on the workspace clock; its quotes can no longer be accepted. The
 *             stream closes after it. Checked before `complete`, so an expired intent never reports `complete`.
 *
 * The workspace also closes a stream INTENT_STREAM_MAX_MS after it opened, and at once on demo reset. A stream that
 * ends without `complete` or `expired` is not an error: resume with Last-Event-ID, or read GET …/quotes. Lines that
 * start with ":" are heartbeat comments, sent every INTENT_STREAM_HEARTBEAT_MS; clients ignore them.
 */
export type IntentEvent =
  | { type: "quote"; quote: Quote }
  | { type: "complete"; intentId: string }
  | { type: "expired"; intentId: string };
export type IntentEventType = IntentEvent["type"];
export const INTENT_EVENT_TYPES: readonly IntentEventType[] = ["quote", "complete", "expired"];
/** The workspace closes an events stream this long after it opened (the client resumes with Last-Event-ID). */
export const INTENT_STREAM_MAX_MS = 60_000;
/** Interval of the ":" heartbeat comment lines on an open events stream. */
export const INTENT_STREAM_HEARTBEAT_MS = 15_000;
