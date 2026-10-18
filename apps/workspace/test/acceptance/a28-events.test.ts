// A28 · quotes pushed as server-sent events (proposed; docs/commerce-analytics-plan.md §8 "Push instead of poll" — a
// human adds it to docs/plan.md §2). Black box: HTTP only, against the real wiring (lane C seed, git memory repo, lane
// D's adapter replaying fixtures/ucp recordings). GET /personal/intents/:id/events streams what GET …/quotes returns,
// as it happens: recorded UCP quotes at once, a callback merchant's quote the moment it is posted, then `complete`;
// `expired` when the clock passes the intent's expiry; nothing beyond the quotes' own fields.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  api, expectError, getQuotes, introduce, KEYS, merchant, NOT_FOUND_TEXT, PINNED, reset, SEED, startCallbackServer, startWorkspace,
  type Api, type CallbackServer, type Json, type Workspace,
} from "./helpers.js";
import { sseReader, type SseReader } from "../sse-reader.js";

let ws: Workspace;
let cb: CallbackServer;
let personal: Api;
const open: AbortController[] = [];

beforeAll(async () => {
  [ws, cb] = await Promise.all([startWorkspace(), startCallbackServer()]);
  personal = api(ws.url, KEYS.personal);
}, 60_000);

afterAll(async () => {
  await cb?.close();
  await ws?.stop();
});

beforeEach(async () => {
  cb.clear();
  await reset(ws.url);
});

afterEach(() => {
  for (const a of open.splice(0)) a.abort();
});

async function events(intentId: string, key: string = KEYS.personal, headers: Record<string, string> = {}): Promise<{ res: Response; sse?: SseReader }> {
  const abort = new AbortController();
  open.push(abort);
  const res = await fetch(`${ws.url}/personal/intents/${encodeURIComponent(intentId)}/events`, {
    headers: { authorization: `Bearer ${key}`, accept: "text/event-stream", ...headers }, signal: abort.signal });
  return { res, ...(res.headers.get("content-type")?.startsWith("text/event-stream") ? { sse: sseReader(res.body!) } : {}) };
}

describe("A28 报价推送（proposed）", { timeout: 45_000 }, () => {
  it("pinned intent: the two recorded quotes exactly as GET …/quotes returns them, ids increasing, then complete and the end", async () => {
    const r = await personal.post("/personal/intents", PINNED.intent);
    expect(r.status).toBe(201);
    const intentId = r.body.intentId as string;
    const { res, sse } = await events(intentId);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    const frames = await sse!.rest(10_000);
    expect(frames.map((f) => f.event)).toEqual(["quote", "quote", "complete"]);
    const polled = await getQuotes(personal, intentId, 0);
    expect(frames.slice(0, 2).map((f) => JSON.parse(f.data))).toEqual((polled.quotes as Json[]).map((quote) => ({ type: "quote", quote })));
    expect((polled.quotes as Json[]).map((q) => q.seller).sort()).toEqual(PINNED.sellers);
    expect(Number(frames[0]!.id)).toBeLessThan(Number(frames[1]!.id));
    expect(frames[2]!.id).toBeUndefined();
    expect(JSON.parse(frames[2]!.data)).toEqual({ type: "complete", intentId });
  });

  it("a callback merchant's quote arrives the moment it is posted, with its seq as id; Last-Event-ID resumes after it", async () => {
    const m = await merchant(ws.url, cb);
    const { intentId } = await introduce(personal, [m], PINNED.intent);
    const { sse } = await events(intentId);
    const recorded = [await sse!.next(10_000), await sse!.next(10_000)];
    expect(recorded.map((f) => f!.event)).toEqual(["quote", "quote"]);
    const t = Date.now();
    const posted = await m.api.post("/agent/quotes", { intentId, text: "Sample trail shoe", price: 9900, etaDate: null });
    expect(posted.status).toBe(201);
    const live = await sse!.next(5000);
    // Pushed, not polled: no 250 ms poll tick in the way (a generous bound for a loaded CI machine).
    expect(Date.now() - t).toBeLessThan(1000);
    expect(live!.event).toBe("quote");
    expect(JSON.parse(live!.data)).toEqual({ type: "quote", quote: posted.body });
    expect(Number(live!.id)).toBeGreaterThan(Number(recorded[1]!.id));
    expect((await sse!.rest(5000)).map((f) => f.event)).toEqual(["complete"]);

    const resumed = await events(intentId, KEYS.personal, { "last-event-id": recorded[1]!.id! });
    expect((await resumed.sse!.rest(5000)).map((f) => [f.event, f.id])).toEqual([["quote", live!.id], ["complete", undefined]]);
  });

  it("unknown intent → the identical 404 and no stream; a merchant key → 403", async () => {
    const r = await personal.post("/personal/intents", PINNED.intent);
    const missing = await events("i_missing");
    expect(missing.sse).toBeUndefined();
    expect(missing.res.status).toBe(404);
    expect(await missing.res.text()).toBe(NOT_FOUND_TEXT);
    const m = await merchant(ws.url, cb);
    const denied = await events(r.body.intentId, m.key);
    expect(denied.sse).toBeUndefined();
    const body = await denied.res.text();
    expectError({ status: denied.res.status, body: JSON.parse(body), text: body }, 403, "SCOPE_DENIED");
  });

  it("POST /test/clock past the intent's expiry → expired, then the end; the stream holds no part of the card's address", async () => {
    const m = await merchant(ws.url, cb);
    const { intentId } = await introduce(personal, [m], PINNED.intent);
    const { sse } = await events(intentId);
    await sse!.next(10_000);
    await sse!.next(10_000);
    try {
      const clock = await api(ws.url).post("/test/clock", { offsetMs: 11 * 60 * 1000 });
      expect(clock.status).toBe(200);
      expect((await sse!.rest(5000)).map((f) => f.event)).toEqual(["expired"]);
    } finally {
      await api(ws.url).post("/test/clock", { offsetMs: 0 });
    }
    for (const needle of [SEED.address, ...SEED.addressNeedles]) expect(sse!.text()).not.toContain(needle);
  });

  it("POST /demo/reset ends an open stream at once", async () => {
    const m = await merchant(ws.url, cb);
    const { intentId } = await introduce(personal, [m], PINNED.intent);
    const { sse } = await events(intentId);
    await sse!.next(10_000);
    await sse!.next(10_000);
    const t = Date.now();
    await reset(ws.url);
    expect(await sse!.rest(5000)).toEqual([]);
    expect(Date.now() - t).toBeLessThan(5000);
    expect(sse!.frames.map((f) => f.event)).toEqual(["quote", "quote"]);
  });
});
