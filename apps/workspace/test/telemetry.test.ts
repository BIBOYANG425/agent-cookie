// Sentry tracing + logs, verified offline: a custom transport captures the envelopes the SDK would send. Checks the
// UCP spans sit under the request transaction, activity and UCP logs arrive, and nothing private leaves: no card
// values, no keys, no query strings, no request bodies, and no trace headers on requests to merchants.
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import * as Sentry from "@sentry/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { flushTelemetry, initTelemetry } from "../src/telemetry.js";
import { harness, KEYS } from "./harness.js";

const bodies: string[] = [];
const outbound: IncomingHttpHeaders[] = [];
let merchantUrl = "";
let closeMerchant = () => {};

beforeAll(async () => {
  initTelemetry({
    dsn: "https://public@o0.ingest.example.invalid/1", environment: "test", tracesSampleRate: 1,
    transport: (options) => Sentry.createTransport(options, async (req) => {
      bodies.push(typeof req.body === "string" ? req.body : Buffer.from(req.body).toString("utf8"));
      return { statusCode: 200 };
    }),
  });
  const server = createServer((req, res) => {
    outbound.push(req.headers);
    req.resume();
    req.on("end", () => res.writeHead(200, { "content-type": "application/json" }).end("{}"));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  merchantUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/cb`;
  closeMerchant = () => server.close();
});
afterAll(() => closeMerchant());

/** Envelope = newline-delimited JSON: envelope header, then (item header, item payload) pairs. */
function items(): Array<{ type: string; payload: any }> {
  const out: Array<{ type: string; payload: any }> = [];
  for (const body of bodies) {
    const lines = body.split("\n").filter(Boolean);
    for (let i = 1; i + 1 < lines.length; i += 2) out.push({ type: JSON.parse(lines[i]!).type, payload: JSON.parse(lines[i + 1]!) });
  }
  return out;
}

describe("Sentry tracing + logs", () => {
  it("one accept: request transactions with UCP child spans, activity + UCP logs, nothing private", async () => {
    const h = await harness();
    await h.registerMerchant({ callbackUrl: merchantUrl });
    const { intentId } = await h.intent();
    const quotes = (await h.get(`/personal/intents/${intentId}/quotes?wait=0`, KEYS.personal)).body.quotes;
    const q = quotes.find((x: any) => x.seller === "shoebacca.com");
    expect((await h.post(`/personal/quotes/${q.id}/accept`, KEYS.personal)).body.status).toBe("handoff");
    await h.deps.delivery.settle();
    expect(await flushTelemetry()).toBe(true);

    const all = items();
    // Sentry 11 streams spans (item type "span", v2 payload): segments are the request roots, children carry parent ids.
    const val = (x: any, k: string) => x.attributes?.[k]?.value;
    const spans = all.filter((x) => x.type === "span").flatMap((x) => x.payload.items as any[]);
    const segment = (name: string) => spans.find((s) => s.is_segment && s.name === name)!;
    const childrenOf = (root: any) => spans.filter((s) => s.trace_id === root.trace_id && !s.is_segment);

    const intentTx = segment("POST /personal/intents");
    expect(intentTx).toBeDefined();
    expect(val(intentTx, "sentry.op")).toBe("http.server");
    expect(val(intentTx, "http.route")).toBe("/personal/intents");
    expect(childrenOf(intentTx).map((s) => s.name)).toContain("ucp.searchOffers");

    const acceptTx = segment("POST /personal/quotes/:id/accept");
    expect(acceptTx).toBeDefined();
    const ucpSpans = childrenOf(acceptTx).filter((s) => val(s, "sentry.op") === "ucp").sort((a, b) => a.start_timestamp - b.start_timestamp);
    expect(ucpSpans.map((s) => s.name)).toEqual(["ucp.createCart", "ucp.createCheckout", "ucp.setDestination", "ucp.complete"]);
    for (const s of ucpSpans) {
      expect(s.parent_span_id).toBe(acceptTx.span_id);
      expect(val(s, "ucp.seller")).toBe("shoebacca.com");
    }
    expect(val(ucpSpans.at(-1), "ucp.status")).toBe("requires_escalation");
    // every request is its own trace
    expect(intentTx.trace_id).not.toBe(acceptTx.trace_id);

    const logs = all.filter((x) => x.type === "log").flatMap((x) => x.payload.items);
    const attr = (l: any, k: string) => l.attributes?.[k]?.value;
    expect(logs.some((l: any) => l.body === "activity" && attr(l, "event") === "quote.accept")).toBe(true);
    expect(logs.some((l: any) => l.body === "ucp.complete" && attr(l, "ucp.status") === "requires_escalation")).toBe(true);

    // nothing private in anything sent
    const sent = bodies.join("\n");
    for (const needle of ["Sample St", "Los Angeles", ...Object.values(KEYS), "wait=0", "shoe_size\":\"42", "帮我找双越野跑鞋"]) {
      expect(sent, `telemetry carries ${needle.slice(0, 12)}`).not.toContain(needle);
    }
    expect(sent).not.toMatch(/"authorization"|"cookie"|http\.request\.header|url\.query/i);
    // no trace propagation to merchants (one trace id across two stores would link the user)
    expect(outbound.length).toBeGreaterThan(0);
    for (const headers of outbound) {
      expect(headers["sentry-trace"]).toBeUndefined();
      expect(headers.baggage).toBeUndefined();
      expect(headers.traceparent).toBeUndefined();
    }
  });
});
