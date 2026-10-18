// GET /personal/intents/:id/events — push instead of poll (docs/commerce-analytics-plan.md §8; contract events.ts).
// Harness style: the Hono app in process, a stub UCP replaying the Sample offers (two UCP sellers quote at creation),
// callback merchants registered per test. The long-poll route is unchanged and covered by workspace.test.ts.
import { describe, expect, it } from "vitest";
import { INTENT_STREAM_HEARTBEAT_MS, INTENT_STREAM_MAX_MS, type IntentEvent } from "@agent-cookie/contract";
import { harness, KEYS } from "./harness.js";
import { sseReader, type SseFrame } from "./sse-reader.js";

type H = Awaited<ReturnType<typeof harness>>;
const NOT_FOUND = '{"error":{"code":"NOT_FOUND","message":"not found"}}';
/** The Sample card's address (test/fixtures/sample/contributions.json): none of it may appear on the stream. */
const ADDRESS_NEEDLES = ["Sample User", "1234 Sample St", "Sample St", "Apt 5", "Los Angeles", "90024"];

async function open(h: H, intentId: string, key: string = KEYS.personal, headers: Record<string, string> = {}) {
  const res = await h.app.request(`/personal/intents/${encodeURIComponent(intentId)}/events`, {
    headers: { authorization: `Bearer ${key}`, accept: "text/event-stream", ...headers } });
  // Only a stream gets a reader; an error answer keeps its body for res.text()/res.json().
  const sse = res.headers.get("content-type")?.startsWith("text/event-stream") ? sseReader(res.body!) : undefined;
  return { res, sse: sse! };
}
const event = (f: SseFrame | undefined): IntentEvent => JSON.parse(f!.data) as IntentEvent;
const activity = async (h: H) => (await h.get("/owner/activity?limit=1000", KEYS.owner)).body.events as Array<{ event: string; object: string; result: string }>;

/** An intent the two UCP sellers quote at once and one registered callback merchant has not quoted yet: not complete. */
async function pendingIntent(h: H) {
  const m = await h.registerMerchant();
  const { intentId } = await h.intent();
  return { m, intentId };
}

describe("GET /personal/intents/:id/events", () => {
  it("defaults to the contract's limits", async () => {
    const h = await harness();
    expect(h.deps.commerce.streamLimits).toEqual({ maxMs: INTENT_STREAM_MAX_MS, heartbeatMs: INTENT_STREAM_HEARTBEAT_MS });
    expect(INTENT_STREAM_MAX_MS).toBe(60_000);
    expect(INTENT_STREAM_HEARTBEAT_MS).toBe(15_000);
  });

  it("existing quotes first in seq order, a callback merchant's later quote live with its seq as id, then complete and the end", async () => {
    const h = await harness();
    const { m, intentId } = await pendingIntent(h);
    const stored = (await h.get(`/personal/intents/${intentId}/quotes?wait=0`, KEYS.personal)).body;
    expect(stored.complete).toBe(false);
    expect(stored.quotes).toHaveLength(2);
    const { res, sse } = await open(h, intentId);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const first = [await sse.next(), await sse.next()];
    expect(first.map((f) => f!.event)).toEqual(["quote", "quote"]);
    // Exactly what GET …/quotes returns, in its (seq) order, ids increasing and equal to the stored seq.
    expect(first.map((f) => event(f))).toEqual(stored.quotes.map((quote: unknown) => ({ type: "quote", quote })));
    const ids = first.map((f) => Number(f!.id));
    expect(ids[0]).toBeLessThan(ids[1]!);
    expect(ids).toEqual(stored.quotes.map((q: { id: string }) => h.deps.store.quote(q.id)!.seq));

    const posted = await h.post("/agent/quotes", m.key, { intentId, text: "Sample trail shoe", price: 9900, etaDate: null });
    expect(posted.status).toBe(201);
    const live = await sse.next();
    expect(live!.event).toBe("quote");
    expect(event(live)).toEqual({ type: "quote", quote: posted.body });
    expect(live!.id).toBe(String(h.deps.store.quote(posted.body.id)!.seq));
    expect(Number(live!.id)).toBeGreaterThan(ids[1]!);

    const done = await sse.next();
    expect(done).toMatchObject({ event: "complete" });
    expect(done!.id).toBeUndefined();
    expect(event(done)).toEqual({ type: "complete", intentId });
    expect(await sse.rest()).toEqual([]);
    expect(sse.ended()).toBe(true);
  });

  it("an intent whose every merchant already quoted: its quotes, then complete at once", async () => {
    const h = await harness();
    const { intentId } = await h.intent();
    const { sse } = await open(h, intentId);
    const frames = await sse.rest();
    expect(frames.map((f) => f.event)).toEqual(["quote", "quote", "complete"]);
  });

  it("Last-Event-ID skips quotes already seen (skipped quotes still count towards complete); a malformed id → 422", async () => {
    const h = await harness();
    const { intentId } = await h.intent();
    const all = await (await open(h, intentId)).sse.rest();
    expect(all.map((f) => f.event)).toEqual(["quote", "quote", "complete"]);
    const afterFirst = await (await open(h, intentId, KEYS.personal, { "last-event-id": all[0]!.id! })).sse.rest();
    expect(afterFirst.map((f) => [f.event, f.id])).toEqual([["quote", all[1]!.id], ["complete", undefined]]);
    const afterBoth = await (await open(h, intentId, KEYS.personal, { "last-event-id": all[1]!.id! })).sse.rest();
    expect(afterBoth.map((f) => f.event)).toEqual(["complete"]);
    for (const bad of ["abc", "-1", "1.5", "1e3"]) {
      const { res } = await open(h, intentId, KEYS.personal, { "last-event-id": bad });
      expect(res.status).toBe(422);
      expect((await res.json()).error.code).toBe("MISSING_FIELD");
    }
  });

  it("another user's intent and an unknown id → the identical 404 and no stream; a merchant key → 403; no key → 401; the owner key may read", async () => {
    const h = await harness();
    const { intentId } = await h.intent();
    const now = h.deps.clock.nowIso();
    h.deps.store.insertUser({ userId: "u_other", name: "Other · Sample", secret: "sample-other-secret", createdAt: now });
    h.deps.store.insertIntent({ id: "i_other", userId: "u_other", agentId: "personal-photon", kind: "trail_shoes", public: {}, createdAt: now,
      expiresAt: h.deps.clock.isoIn(600_000) });
    for (const id of ["i_other", "i_missing"]) {
      const { res } = await open(h, id);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toMatch(/^application\/json/);
      expect(await res.text()).toBe(NOT_FOUND);
    }
    const m = await h.registerMerchant();
    const denied = await open(h, intentId, m.key);
    expect(denied.res.status).toBe(403);
    expect((await denied.res.json()).error.code).toBe("SCOPE_DENIED");
    const anon = await h.app.request(`/personal/intents/${intentId}/events`);
    expect(anon.status).toBe(401);
    const owner = await open(h, intentId, KEYS.owner);
    expect(owner.res.status).toBe(200);
    expect((await owner.sse.rest()).map((f) => f.event)).toEqual(["quote", "quote", "complete"]);
  });

  it("after POST /test/clock past expiry the stream yields expired and ends", async () => {
    const h = await harness();
    const { intentId } = await pendingIntent(h);
    const { sse } = await open(h, intentId);
    expect([(await sse.next())!.event, (await sse.next())!.event]).toEqual(["quote", "quote"]);
    const t = Date.now();
    expect((await h.post("/test/clock", undefined, { offsetMs: 601_000 })).status).toBe(200);
    const expired = await sse.next(2000);
    expect(expired).toMatchObject({ event: "expired" });
    expect(event(expired)).toEqual({ type: "expired", intentId });
    expect(await sse.rest()).toEqual([]);
    expect(Date.now() - t).toBeLessThan(1000);
    // An already expired intent: its quotes (as GET …/quotes shows them), then expired, never complete.
    const again = await (await open(h, intentId)).sse.rest();
    expect(again.map((f) => f.event)).toEqual(["quote", "quote", "expired"]);
  });

  it("an idle stream sends heartbeat comments and ends after INTENT_STREAM_MAX_MS without complete or expired", async () => {
    const h = await harness();
    h.deps.commerce.streamLimits.maxMs = 400;
    h.deps.commerce.streamLimits.heartbeatMs = 100;
    const { intentId } = await pendingIntent(h);
    const t = Date.now();
    const { sse } = await open(h, intentId);
    const frames = await sse.rest(3000);
    const took = Date.now() - t;
    expect(frames.map((f) => f.event)).toEqual(["quote", "quote"]);
    expect(took).toBeGreaterThanOrEqual(350);
    expect(took).toBeLessThan(1500);
    expect(sse.comments.length).toBeGreaterThanOrEqual(2);
    expect(new Set(sse.comments)).toEqual(new Set(["heartbeat"]));
  });

  it("no event carries a field value: the whole stream holds no part of the card's address", async () => {
    const h = await harness();
    const { m, intentId } = await pendingIntent(h);
    const { sse } = await open(h, intentId);
    await sse.next();
    await h.post("/agent/quotes", m.key, { intentId, text: "Sample trail shoe", price: 9900, etaDate: null });
    await sse.rest();
    const text = sse.text();
    expect(text).toContain("event: complete");
    for (const needle of ADDRESS_NEEDLES) expect(text).not.toContain(needle);
    // Only the three contract event types, and every data line is one IntentEvent.
    for (const f of sse.frames) {
      expect(["quote", "complete", "expired"]).toContain(f.event);
      expect(Object.keys(JSON.parse(f.data)).sort()).toEqual(f.event === "quote" ? ["quote", "type"] : ["intentId", "type"]);
    }
  });

  it("the activity log gets one row for the stream request and nothing per event", async () => {
    const h = await harness();
    const { m, intentId } = await pendingIntent(h);
    const before = await activity(h);
    const { sse } = await open(h, intentId);
    await sse.next();
    await sse.next();
    const during = await activity(h);
    await h.post("/agent/quotes", m.key, { intentId, text: "Sample trail shoe", price: 9900, etaDate: null });
    await sse.rest();
    const after = await activity(h);
    const streamRows = (rows: Awaited<ReturnType<typeof activity>>) => rows.filter((e) => e.event === "GET /personal/intents/:id/events");
    expect(during.length - before.length).toBe(1);
    expect(streamRows(during)).toEqual([expect.objectContaining({ object: intentId, result: "200" })]);
    expect(streamRows(after)).toHaveLength(1);
    // After: only what the merchant's POST itself logs (its request row and quote.submit), nothing from the stream.
    const added = after.slice(0, after.length - during.length).map((e) => e.event).sort();
    expect(added).toEqual(["POST /agent/quotes", "quote.submit"]);
  });

  it("a demo reset ends open streams at once, without waiting for them", async () => {
    const h = await harness();
    const { intentId } = await pendingIntent(h);
    const { sse } = await open(h, intentId);
    await sse.next();
    await sse.next();
    const t = Date.now();
    expect((await h.post("/demo/reset", KEYS.owner)).status).toBe(200);
    expect(await sse.rest(2000)).toEqual([]);
    expect(Date.now() - t).toBeLessThan(2000);
    expect(sse.frames.map((f) => f.event)).toEqual(["quote", "quote"]);
  });

  it("the stream ends when the reset starts closing the gate, before the reset has finished waiting for requests in flight", async () => {
    const h = await harness();
    const { intentId } = await pendingIntent(h);
    const { sse } = await open(h, intentId);
    await sse.next();
    await sse.next();
    // A request in flight for 500 ms: the reset waits for it before it wipes anything.
    let held = 0;
    const inFlight = h.deps.gate.run(() => new Promise<void>((r) => setTimeout(() => { held = Date.now(); r(); }, 500)));
    const t = Date.now();
    const reset = h.post("/demo/reset", KEYS.owner);
    expect(await sse.rest(2000)).toEqual([]);
    const ended = Date.now();
    expect(ended - t).toBeLessThan(400);
    await inFlight;
    expect((await reset).status).toBe(200);
    expect(ended).toBeLessThan(held);
  });

  it("a client that disconnects releases its subscription", async () => {
    const h = await harness();
    const { intentId } = await pendingIntent(h);
    const listeners = () => (h.deps.commerce as unknown as { emitter: import("node:events").EventEmitter }).emitter.listenerCount("quote");
    const { sse } = await open(h, intentId);
    await sse.next();
    expect(listeners()).toBe(1);
    await sse.cancel();
    for (let i = 0; i < 50 && listeners() > 0; i++) await new Promise((r) => setTimeout(r, 10));
    expect(listeners()).toBe(0);
  });
});
