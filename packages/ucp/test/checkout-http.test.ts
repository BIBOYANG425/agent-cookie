import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JarKeyStore, verifyTapRequest } from "@agent-cookie/auth";
import type { UcpCheckout } from "@agent-cookie/contract";
import { describe, expect, it, vi } from "vitest";
import { createCheckoutHttpTransport, type CheckoutHttpOptions, type CheckoutReplay } from "../src/checkout-http.js";
import { createUcpInternal } from "../src/internal.js";

type Json = Record<string, any>;
const handler = { name: "example.authorization-reference", id: "SampleHandler", version: "2026-08-25" as const,
  instrumentType: "SampleAuthorization", credentialType: "SampleAuthorizationReference" };
const payment = { authorizationId: "SampleAuthorization", amount: 100, currency: "USD" as const };
const fixturePath = new URL("./fixtures/checkout-payment.local-replay.json", import.meta.url);

async function withMerchant(run: (h: {
  checkout: UcpCheckout; options: CheckoutHttpOptions; requests: Array<{ method: string; path: string; body: Json | undefined }>;
  exchanges: CheckoutReplay["exchanges"]; resource: Json; profile: Json; complete: (body: Json) => Json | "timeout";
  origin: string; signatures: boolean[]; redirect?: boolean;
}) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), "agent-cookie-checkout-"));
  const oldGate = process.env.UCP_PAYMENT_SIMULATOR;
  process.env.UCP_PAYMENT_SIMULATOR = "1";
  const jar = JarKeyStore.open({ path: join(directory, "jar.json"), kek: Buffer.alloc(32, 7) });
  jar.unlock(60_000);
  const nonces = new Set<string>();
  const registry = { [handler.name]: [{ id: handler.id, version: handler.version }] };
  const resource: Json = { id: "SampleCheckout", status: "ready_for_complete", currency: "USD", ucp: { version: handler.version, payment_handlers: registry },
    line_items: [{ id: "SampleLine", item: { id: "SampleProduct" }, quantity: 1 }], buyer: { first_name: "Sample", email: "sample@example.com" },
    fulfillment: { methods: [{ id: "SampleShipping", type: "shipping", line_item_ids: ["SampleLine"] }] },
    totals: [{ type: "total", amount: 100 }], discounts: { codes: [{ code: "SampleDiscount" }] } };
  const requests: Array<{ method: string; path: string; body: Json | undefined }> = [];
  const exchanges: CheckoutReplay["exchanges"] = [];
  const signatures: boolean[] = [];
  let h: Parameters<typeof run>[0];
  const server = createServer((req, res) => {
    void (async () => {
      const signed = verifyTapRequest({ authority: req.headers.host!, path: req.url!, signatureInput: String(req.headers["signature-input"] ?? ""),
        signature: String(req.headers.signature ?? ""), jwk: jar.publicJwk("SampleMerchantSession"),
        nowSec: Math.floor(Date.now() / 1000), seenNonces: nonces, expectedTag: "agent-payer-auth" });
      signatures.push(signed.ok);
      const send = (status: number, response: unknown) => {
        exchanges.push({ method: req.method!, path: req.url!, status, response: structuredClone(response) });
        res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(response));
      };
      if (!signed.ok || req.headers["ucp-agent"] !== 'profile="https://platform.example/profile"') return send(401, { error: "unauthorized" });
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) as Json : undefined;
      requests.push({ method: req.method!, path: req.url!, body });
      if (h.redirect) { res.writeHead(302, { Location: `${h.origin}/must-not-follow` }); res.end("{}"); return; }
      if (req.url === "/.well-known/ucp") return send(200, h.profile);
      if (req.url === "/ucp/checkout-sessions/SampleCheckout" && req.method === "GET") return send(200, h.resource);
      if (req.url === "/ucp/checkout-sessions/SampleCheckout" && req.method === "PUT") {
        Object.assign(h.resource, body); return send(200, h.resource);
      }
      if (req.url?.endsWith("/complete") && req.method === "POST") {
        const result = h.complete(body!);
        if (result === "timeout") return;
        return send(200, result);
      }
      send(404, {});
    })().catch(() => { res.writeHead(500); res.end("{}"); });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Sample merchant did not start");
  const origin = `http://127.0.0.1:${address.port}`;
  const domain = new URL(origin).host;
  const checkout: UcpCheckout = { checkoutId: "SampleCheckout", sellerDomain: domain, status: "ready_for_complete", messages: [], continueUrl: "https://merchant.example/checkout/SampleCheckout" };
  h = { checkout, requests, exchanges, resource, origin, signatures,
    profile: { ucp: { version: handler.version, payment_handlers: registry, services: { "dev.ucp.shopping": [{ version: handler.version, transport: "rest", endpoint: `${origin}/ucp` }] } } },
    complete: (body) => ({ ...resource, status: "completed", order: { id: "SampleOrder" }, payment: {
      instruments: [{ id: body.payment.instruments[0].id, handler_id: handler.id, type: handler.instrumentType, selected: true }],
    }, messages: [{ content: "SampleSensitiveMerchantText" }] }),
    options: { mode: "live", platformProfileUrl: "https://platform.example/profile", merchants: { [domain]: handler }, simulatorOrigin: origin,
      resolveAuthorization: vi.fn(async () => ({ authorizationId: payment.authorizationId, checkoutId: checkout.checkoutId, sellerDomain: domain,
        amount: 100, currency: "USD" as const, status: "authorized" as const, providerRef: "SampleProviderAuthorization", payment_method: "tms_SampleMustNotLeave" })),
      signPayer: ({ authority, path, tag }) => jar.signTapRequest({ sessionId: "SampleMerchantSession", authority, path, tag }), onOutcome: vi.fn() },
  };
  try { await run(h); } finally {
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
    if (oldGate === undefined) delete process.env.UCP_PAYMENT_SIMULATOR; else process.env.UCP_PAYMENT_SIMULATOR = oldGate;
  }
}

describe("D2 private REST seam — Sample simulated merchant, not Visa or Shopify acceptance", () => {
  it("uses real HTTP with merchant-verified payer signatures, full PUT state and only an authorization reference", async () => {
    await withMerchant(async (h) => {
      const transport = createCheckoutHttpTransport(h.options);
      const cli = vi.fn(async () => { throw new Error("CLI not expected"); });
      const ucp = createUcpInternal({ mode: "live" }, cli, transport);
      const updated = await ucp.setDestination(h.checkout, { raw: "Sample Street", line1: "Sample Street", city: "Sample City", region: "CA", postalCode: "00000", country: "US" });
      const result = await ucp.complete(updated, payment);
      expect(result).toMatchObject({ orderId: "SampleOrder", status: "completed", messages: [] });
      expect(h.signatures).toHaveLength(6);
      expect(h.signatures.every(Boolean)).toBe(true);
      const put = h.requests.find((request) => request.method === "PUT")!.body!;
      expect(put).toMatchObject({ line_items: h.resource.line_items, buyer: { first_name: "Sample", email: "sample@example.com" },
        discounts: { codes: [{ code: "SampleDiscount" }] }, fulfillment: { methods: [{ id: "SampleShipping", line_item_ids: ["SampleLine"] }] } });
      const complete = h.requests.find((request) => request.method === "POST")!.body!;
      expect(complete).toEqual({ payment: { instruments: [{ id: payment.authorizationId, handler_id: handler.id, type: handler.instrumentType,
        credential: { type: handler.credentialType, token: "SampleProviderAuthorization" } }] } });
      expect(JSON.stringify(h.requests)).not.toContain("tms_SampleMustNotLeave");
      expect(JSON.stringify(result)).not.toMatch(/SampleProviderAuthorization|SampleSensitiveMerchantText|credential|payment_method/);
      expect(h.options.onOutcome).toHaveBeenCalledWith({ authorizationId: payment.authorizationId, checkoutId: "SampleCheckout", outcome: "accepted", owner: "merchant" });
      expect(cli).not.toHaveBeenCalled();
      const replay = JSON.parse(JSON.stringify({ provenance: "recorded-replay", source: "local-simulated-merchant", simulated: true,
        _note: "Sample/test-only. Captured over real loopback HTTP by checkout-http.test.ts; listener origin replaced with https://merchant.example. Not real UCP/Visa acceptance.",
        exchanges: h.exchanges }).replaceAll(h.origin, "https://merchant.example"));
      if (process.env.UCP_RECORD_CHECKOUT_FIXTURE === "1") writeFileSync(fixturePath, `${JSON.stringify(replay, null, 2)}\n`);
      expect(replay).toEqual(JSON.parse(readFileSync(fixturePath, "utf8")));
    });
  });

  it("replays recorded Sample HTTP envelopes in fixture mode without network", async () => {
    await withMerchant(async (h) => {
      const replay = JSON.parse(readFileSync(fixturePath, "utf8")) as CheckoutReplay;
      const network = vi.fn(async () => { throw new Error("network forbidden"); });
      const checkout = { ...h.checkout, sellerDomain: "merchant.example" };
      const transport = createCheckoutHttpTransport({ ...h.options, mode: "fixture", simulatorOrigin: undefined, merchants: { "merchant.example": handler }, replay, fetch: network,
        resolveAuthorization: async () => ({ authorizationId: payment.authorizationId, checkoutId: checkout.checkoutId, sellerDomain: checkout.sellerDomain,
          amount: 100, currency: "USD", status: "authorized", providerRef: "SampleProviderAuthorization" }) });
      const ucp = createUcpInternal({ mode: "fixture" }, undefined, transport);
      const updated = await ucp.setDestination(checkout, { raw: "Sample Street", line1: "Sample Street", city: "Sample City", region: "CA", postalCode: "00000", country: "US" });
      expect(await ucp.complete(updated, payment)).toMatchObject({ orderId: "SampleOrder", status: "completed" });
      expect(network).not.toHaveBeenCalled();
    });
  });

  it.each(["merchant", "checkout", "amount", "status", "token", "card-shaped"])("refuses invalid authorization %s binding before any mutation", async (kind) => {
    await withMerchant(async (h) => {
      const authorization = await h.options.resolveAuthorization(h.checkout, payment);
      const modified = { ...authorization, ...(kind === "merchant" ? { sellerDomain: "wrong.example" } : kind === "checkout" ? { checkoutId: "wrong" } :
        kind === "amount" ? { amount: 99 } : kind === "status" ? { status: "used" } : kind === "card-shaped" ? { providerRef: "0".repeat(16) } : { providerRef: "tms_SampleMustNotLeave" }) };
      h.options.resolveAuthorization = vi.fn(async () => modified as typeof authorization);
      await expect(createCheckoutHttpTransport(h.options).complete(h.checkout, payment)).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
      expect(h.requests.every((request) => request.method === "GET")).toBe(true);
      expect(h.options.onOutcome).not.toHaveBeenCalled();
    });
  });

  it.each(["timeout", "credential echo", "unselected", "processing", "order reference echo"])("marks %s unknown without retry/capture/reversal or false success", async (kind) => {
    await withMerchant(async (h) => {
      h.options.timeoutMs = 500;
      const complete = h.complete;
      h.complete = (body) => {
        if (kind === "timeout") return "timeout";
        const result = complete(body) as Json;
        if (kind === "credential echo") result.payment.instruments[0].credential = body.payment.instruments[0].credential;
        if (kind === "unselected") result.payment.instruments[0].selected = false;
        if (kind === "processing") result.status = "complete_in_progress";
        if (kind === "order reference echo") result.order.id = "SampleProviderAuthorization";
        return result;
      };
      const transport = createCheckoutHttpTransport(h.options);
      await expect(transport.complete(h.checkout, payment)).rejects.toMatchObject({ message: "ucp payment completion needs reconciliation: failed" });
      expect(h.options.onOutcome).toHaveBeenCalledWith({ authorizationId: payment.authorizationId, checkoutId: "SampleCheckout", outcome: "unknown", owner: "unknown" });
      await expect(transport.complete(h.checkout, payment)).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
      expect(h.requests.filter((request) => request.method === "POST")).toHaveLength(1);
    });
  });

  it("falls back before lookup/release when no compatible handler is advertised", async () => {
    await withMerchant(async (h) => {
      h.profile.ucp.payment_handlers = {};
      const cli = vi.fn(async () => ({ result: { id: "SampleCheckout", status: "requires_escalation" } }));
      const ucp = createUcpInternal({ mode: "live" }, cli, createCheckoutHttpTransport(h.options));
      expect(await ucp.complete(h.checkout, payment)).toMatchObject({ status: "requires_escalation" });
      expect(cli).toHaveBeenCalledOnce();
      expect(h.options.resolveAuthorization).not.toHaveBeenCalled();
      expect(h.options.onOutcome).not.toHaveBeenCalled();
    });
  });

  it("refuses cross-origin endpoints before releasing a reference", async () => {
    await withMerchant(async (h) => {
      h.profile.ucp.services["dev.ucp.shopping"][0].endpoint = "https://other.example/ucp";
      await expect(createCheckoutHttpTransport(h.options).complete(h.checkout, payment)).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
      expect(h.options.resolveAuthorization).not.toHaveBeenCalled();
      expect(h.requests).toHaveLength(1);
    });
  });

  it("fails closed for locked signing, wrong payer tags, missing loopback gate, and fixture/live mode mismatch", async () => {
    await withMerchant(async (h) => {
      const original = h.options.signPayer;
      h.options.signPayer = async () => { throw new Error("SamplePrivatePathOrSecret"); };
      await expect(createCheckoutHttpTransport(h.options).complete(h.checkout, payment)).rejects.toMatchObject({ message: "ucp checkout get: failed" });
      h.options.signPayer = (input) => original({ ...input, tag: "agent-browser-auth" as "agent-payer-auth" });
      await expect(createCheckoutHttpTransport(h.options).complete(h.checkout, payment)).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
      h.options.signPayer = original;
      delete process.env.UCP_PAYMENT_SIMULATOR;
      await expect(createCheckoutHttpTransport(h.options).complete(h.checkout, payment)).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
      expect(h.requests).toHaveLength(0);
      expect(() => createUcpInternal({ mode: "fixture" }, undefined, createCheckoutHttpTransport(h.options))).toThrow("transport mode mismatch");
    });
  });

  it.each(["amount", "currency", "processing", "sold out"])("does not release a reference for checkout %s preflight failure", async (kind) => {
    await withMerchant(async (h) => {
      if (kind === "amount") h.resource.totals[0].amount = 101;
      if (kind === "currency") h.resource.currency = "EUR";
      if (kind === "processing") h.resource.status = "complete_in_progress";
      if (kind === "sold out") h.resource.messages = [{ type: "error", code: "out_of_stock", content: "SamplePrivateMessage" }];
      await expect(createCheckoutHttpTransport(h.options).complete(h.checkout, payment)).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
      expect(h.options.resolveAuthorization).not.toHaveBeenCalled();
      expect(h.requests.every((request) => request.method === "GET")).toBe(true);
    });
  });

  it("reports sold-out update honestly without echoing merchant field values", async () => {
    await withMerchant(async (h) => {
      h.resource.messages = [{ type: "error", code: "out_of_stock", content: "SamplePrivateMessage" }];
      const ucp = createUcpInternal({ mode: "live" }, undefined, createCheckoutHttpTransport(h.options));
      const result = await ucp.setDestination(h.checkout, { raw: "Sample", line1: "Sample", city: "Sample", region: "CA", postalCode: "00000", country: "US" });
      expect(result).toMatchObject({ status: "requires_escalation", messages: [{ code: "out_of_stock", content: "Item is out of stock" }] });
      expect(JSON.stringify(result)).not.toContain("SamplePrivateMessage");
    });
  });

  it("does not follow HTTP redirects or release an authorization after one", async () => {
    await withMerchant(async (h) => {
      h.redirect = true;
      await expect(createCheckoutHttpTransport(h.options).complete(h.checkout, payment)).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
      expect(h.requests.map((request) => request.path)).toEqual(["/.well-known/ucp"]);
      expect(h.options.resolveAuthorization).not.toHaveBeenCalled();
    });
  });

  it.each(["signature", "authority"])("has the HTTP merchant reject a tampered payer %s", async (kind) => {
    await withMerchant(async (h) => {
      const sign = h.options.signPayer;
      h.options.signPayer = async (input) => {
        const signed = await sign(kind === "authority" ? { ...input, authority: "wrong.example" } : input);
        return kind === "signature" ? { ...signed, signature: `sig2=:${Buffer.alloc(64).toString("base64")}:` } : signed;
      };
      await expect(createCheckoutHttpTransport(h.options).complete(h.checkout, payment)).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });
      expect(h.signatures).toEqual([false]);
      expect(h.options.resolveAuthorization).not.toHaveBeenCalled();
    });
  });

  it("sends at most one mutation for concurrent authorization completion", async () => {
    await withMerchant(async (h) => {
      const transport = createCheckoutHttpTransport(h.options);
      const results = await Promise.allSettled([transport.complete(h.checkout, payment), transport.complete(h.checkout, payment)]);
      expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
      expect(h.requests.filter((request) => request.method === "POST")).toHaveLength(1);
      expect(h.options.onOutcome).toHaveBeenCalledOnce();
    });
  });

  it("sanitizes persistence failures rather than releasing callback errors", async () => {
    await withMerchant(async (h) => {
      h.options.onOutcome = async () => { throw new Error("SamplePrivateFileOrSecret"); };
      await expect(createCheckoutHttpTransport(h.options).complete(h.checkout, payment)).rejects.toMatchObject({ message: "ucp payment completion needs reconciliation: failed" });
      expect(h.requests.filter((request) => request.method === "POST")).toHaveLength(1);
    });
  });
});
