import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  UpstreamError,
  type UcpDestination,
  type UcpCheckout,
  type UcpModule,
} from "@agent-cookie/contract";
import { describe, expect, it } from "vitest";
import { createUcp, ucpModule } from "../src/index.js";
import { createLiveRunner, createUcpInternal, type UcpRunner } from "../src/internal.js";

type JsonRecord = Record<string, any>;
const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/ucp");
const moduleCheck: UcpModule = ucpModule;
void moduleCheck;

function loadFixture(name: string): JsonRecord {
  return JSON.parse(readFileSync(resolve(fixturesDir, name), "utf8")) as JsonRecord;
}

function trimSearchEnvelope(envelope: JsonRecord): JsonRecord {
  return {
    result: {
      products: (envelope.result.products as JsonRecord[]).map((product) => ({
        id: product.id,
        title: product.title,
        variants: (product.variants as JsonRecord[]).map((variant) => ({
          id: variant.id,
          title: variant.title,
          price: variant.price,
          availability: variant.availability,
          options: variant.options,
          seller: variant.seller,
          eligible: variant.eligible,
          ...Object.fromEntries(
            Object.entries(variant).filter(([key]) =>
              /^(eta_date|etaDate|delivery_date|deliveryDate|estimated_delivery_date|estimatedDeliveryDate|delivery_estimate_date|deliveryEstimateDate|delivery_estimate|deliveryEstimate|delivery|eta)$/.test(key)
            ),
          ),
          ...(variant.url ? { url: variant.url } : {}),
          ...(variant.checkout_url ? { checkout_url: variant.checkout_url } : {}),
        })),
      })),
    },
  };
}

const realSearch = trimSearchEnvelope(loadFixture("catalog-search.global.json"));
const rawVariants = (realSearch.result.products as JsonRecord[]).flatMap((product) =>
  (product.variants as JsonRecord[]).map((variant) => ({ product, variant }))
);

function runnerFor(response: unknown, calls: string[][] = []): UcpRunner {
  return async (args) => {
    calls.push(args);
    return response;
  };
}

function parseInput(args: string[]): JsonRecord {
  return JSON.parse(args[args.indexOf("--input") + 1]!) as JsonRecord;
}

function checkout(
  fields: Partial<{
    status: UcpCheckout["status"];
    continueUrl: string;
    orderId: string;
  }> = {},
): UcpCheckout {
  return {
    checkoutId: "checkout-1",
    sellerDomain: "shop.example",
    status: fields.status ?? "incomplete",
    ...(fields.continueUrl ? { continueUrl: fields.continueUrl } : {}),
    ...(fields.orderId ? { orderId: fields.orderId } : {}),
    messages: [],
  };
}

describe("contract module", () => {
  it("exports a value assignable to the frozen UcpModule", () => {
    const module: UcpModule = ucpModule;
    expect(module.createUcp).toBe(createUcp);
  });
});

describe("searchOffers normalization", () => {
  it("preserves all catalog variants and normalizes size, currency, native checkout, ETA, and shipsTo", async () => {
    const marathon = rawVariants.find(({ variant }) => variant.id === "gid://shopify/ProductVariant/42550028075069")!;
    const nzd = rawVariants.find(({ variant }) => variant.price?.currency === "NZD")!;
    const unavailable = rawVariants.find(({ variant }) => variant.availability?.available === false)!;
    const envelope = structuredClone(realSearch);
    const product = envelope.result.products[0];
    product.variants.push(
      { ...marathon.variant, id: "variant-no-product", price: { amount: 100, currency: "USD" } },
      { ...marathon.variant, id: undefined },
      { ...marathon.variant, id: "variant-no-domain", seller: { name: "No domain" } },
      { ...marathon.variant, id: "variant-unavailable", availability: { available: false } },
    );
    const calls: string[][] = [];
    const api = createUcpInternal({ mode: "live" }, runnerFor(envelope, calls));
    const offers = await api.searchOffers({
      query: "trail shoes",
      intentText: "Need wide fit",
      shipsTo: "US",
      maxPriceCents: 12_345,
      limit: 17,
    });

    expect(calls).toHaveLength(1);
    expect(parseInput(calls[0]!)).toEqual({
      query: "trail shoes",
      context: { address_country: "US", currency: "USD", intent: "Need wide fit" },
      filters: { available: true, ships_to: { country: "US" }, price: { max: 12_345 } },
      pagination: { limit: 17 },
    });
    expect(offers.find((offer) => offer.variantId === marathon.variant.id)).toMatchObject({
      sellerDomain: "marathonsports.myshopify.com",
      sizeOptions: ["9 US"],
      nativeCheckout: false,
      etaDate: null,
      shipsTo: ["US"],
    });
    expect(offers.find((offer) => offer.variantId === nzd.variant.id)?.currency).toBe("NZD");
    expect(offers.find((offer) => offer.variantId === "variant-unavailable")?.available).toBe(false);
    expect(offers.some((offer) => offer.variantId === "variant-no-product")).toBe(true);
    expect(offers.some((offer) => offer.variantId === "variant-no-domain")).toBe(false);
    expect(offers.some((offer) => offer.variantId === undefined)).toBe(false);
  });

  it("keeps missing budgets omitted and maps every size-like label verbatim", async () => {
    const api = createUcpInternal({ mode: "live" }, runnerFor(realSearch));
    const offers = await api.searchOffers({ query: "shoes", shipsTo: "CA" });
    expect(offers.find((offer) => offer.sizeOptions.includes("UK 4.5"))?.sizeOptions).toContain("UK 4.5");
    expect(offers.find((offer) => offer.sizeOptions.includes("9 US"))?.sizeOptions).toContain("9 US");
  });
});

describe("checkout CLI arguments and destination mapping", () => {
  it("uses cart_id plus line_items, positional checkout IDs, bare business domains, and optional buyer email", async () => {
    const calls: string[][] = [];
    const lineItem = { id: "line-1", item: { id: "variant-1" }, quantity: 1 };
    const run: UcpRunner = async (args) => {
      calls.push(args);
      if (args[0] === "cart") {
        return { result: { id: "cart-1", continue_url: "https://shop.example/cart/c/1", line_items: [lineItem], messages: [] } };
      }
      if (args[1] === "create") {
        return { result: {
          id: "checkout-1",
          status: "incomplete",
          continue_url: "https://shop.example/cart/c/1",
          line_items: [lineItem],
          fulfillment: { methods: [{ id: "ship-1", type: "shipping", line_item_ids: ["line-1"] }] },
          messages: [],
        } };
      }
      if (args[1] === "update") {
        return { result: { status: "ready_for_complete", continue_url: "https://shop.example/", messages: [] } };
      }
      return { result: { status: "completed", order_id: "order-1", messages: [] } };
    };
    const api = createUcpInternal({ mode: "live" }, run);
    const cart = await api.createCart({ sellerDomain: "shop.example", variantId: "variant-1" });
    const created = await api.createCheckout(cart);
    const address: UcpDestination = {
      name: "Agent Cookie Demo",
      line1: "1 Ferry Building",
      line2: "Suite 2",
      city: "San Francisco",
      region: "CA",
      postalCode: "94111",
      country: "US",
      raw: "ignored by the CLI payload",
    };
    const updated = await api.setDestination(created, address);
    const completed = await api.complete(updated);

    for (const args of calls) {
      expect(args.slice(args.indexOf("--profile"), args.indexOf("--profile") + 2))
        .toEqual(["--profile", "agent"]);
      expect(args.slice(args.indexOf("--business"), args.indexOf("--business") + 2))
        .toEqual(["--business", "shop.example"]);
    }
    expect(parseInput(calls[0]!)).toEqual({
      line_items: [{ item: { id: "variant-1" }, quantity: 1 }],
    });
    expect(calls[1]!.slice(0, 2)).toEqual(["checkout", "create"]);
    expect(calls[1]).not.toContain("--cart-id");
    expect(parseInput(calls[1]!)).toEqual({ cart_id: "cart-1", line_items: [lineItem] });
    expect(calls[2]!.slice(0, 3)).toEqual(["checkout", "update", "checkout-1"]);
    expect(parseInput(calls[2]!)).toEqual({
      line_items: [lineItem],
      fulfillment: { methods: [{
        type: "shipping",
        id: "ship-1",
        line_item_ids: ["line-1"],
        destinations: [{
          street_address: "1 Ferry Building",
          extended_address: "Suite 2",
          address_locality: "San Francisco",
          address_region: "CA",
          postal_code: "94111",
          address_country: "US",
          first_name: "Agent",
          last_name: "Cookie Demo",
        }],
      }] },
    });
    expect(parseInput(calls[2]!)).not.toHaveProperty("buyer");
    expect(calls[3]!.slice(0, 3)).toEqual(["checkout", "complete", "checkout-1"]);
    expect(parseInput(calls[3]!)).toEqual({ payment: {} });
    expect(updated.continueUrl).toBe("https://shop.example/cart/c/1");
    expect(completed).toMatchObject({ status: "completed", orderId: "order-1" });
  });

  it("includes buyer email only when provided and falls back to the first token as last name", async () => {
    let updateInput: JsonRecord | undefined;
    const api = createUcpInternal({ mode: "live" }, async (args) => {
      if (args[1] === "update") {
        updateInput = parseInput(args);
        return { result: { status: "incomplete", messages: [] } };
      }
      return { result: { id: "checkout-1", status: "incomplete", line_items: [], fulfillment: { methods: [] } } };
    });
    const checkout = await api.createCheckout({
      cartId: "cart-1",
      sellerDomain: "shop.example",
      messages: [],
    });
    await api.setDestination(checkout, {
      name: "Agent",
      line1: "1 Main",
      city: "Town",
      region: "CA",
      postalCode: "00000",
      country: "US",
      raw: "ignored",
    }, { email: "buyer@example.test" });
    expect(updateInput?.buyer).toEqual({ email: "buyer@example.test" });
    expect(updateInput?.fulfillment.methods[0].destinations[0]).toMatchObject({
      first_name: "Agent",
      last_name: "Agent",
    });
  });
});

describe("complete and upstream failures", () => {
  it("passes completed and requires_escalation statuses through unchanged", async () => {
    const completed = createUcpInternal({ mode: "live" }, runnerFor({
      result: { status: "completed", order: { id: "order-1" }, messages: [] },
    }));
    await expect(completed.complete(checkout())).resolves.toMatchObject({
      status: "completed",
      orderId: "order-1",
    });

    const escalation = createUcpInternal({ mode: "live" }, runnerFor({
      result: {
        status: "requires_escalation",
        continue_url: "https://shop.example/cart/c/1",
        messages: [{ type: "info", content: "Review and pay on the merchant page." }],
      },
    }));
    await expect(escalation.complete(checkout())).resolves.toMatchObject({
      status: "requires_escalation",
      continueUrl: "https://shop.example/cart/c/1",
      messages: [{ type: "info", content: "Review and pay on the merchant page." }],
    });
  });

  it("throws contract UpstreamError for error envelopes and runner failures with the best URL", async () => {
    const fallback = "https://shop.example/cart/c/checkout-1";
    const envelopeClient = createUcpInternal({ mode: "live" }, runnerFor({
      code: "INSUFFICIENT_PERMISSIONS",
      message: "JWT required",
      continue_url: "https://shop.example/",
    }));
    await expect(envelopeClient.complete(checkout({ continueUrl: fallback })))
      .rejects.toMatchObject({
        message: "ucp checkout-complete: INSUFFICIENT_PERMISSIONS: JWT required",
        continueUrl: fallback,
      });

    const thrownClient = createUcpInternal({ mode: "live" }, async () => {
      throw new Error("runner failed");
    });
    await expect(thrownClient.complete(checkout({ continueUrl: fallback })))
      .rejects.toBeInstanceOf(UpstreamError);
    await expect(thrownClient.complete(checkout({ continueUrl: fallback })))
      .rejects.toMatchObject({ message: "runner failed", continueUrl: fallback });
  });

  it("throws on any operation error envelope rather than filtering or converting it", async () => {
    const api = createUcpInternal({ mode: "live" }, runnerFor({
      code: "CATALOG_UNAVAILABLE",
      message: "Catalog unavailable",
    }));
    await expect(api.searchOffers({ query: "shoes", shipsTo: "US" }))
      .rejects.toBeInstanceOf(UpstreamError);
  });
});

describe("live profile initialization", () => {
  it("retries after profile init fails and honors a supplied binary and timeout", async () => {
    let profileAttempts = 0;
    const calls: Array<{ args: string[]; bin?: string; timeoutMs: number }> = [];
    const runner = createLiveRunner({}, {
      bin: "/custom/ucp",
      timeoutMs: 1234,
      execute: async (args, _env, timeoutMs, bin) => {
        calls.push({ args, bin, timeoutMs });
        if (args[0] === "profile") {
          profileAttempts += 1;
          if (profileAttempts === 1) throw new Error("temporary profile init failure");
          return { stdout: JSON.stringify({ name: "agent" }), stderr: "" };
        }
        return { stdout: JSON.stringify({ result: { ok: true } }), stderr: "" };
      },
    });

    await expect(runner(["catalog", "search"])).rejects.toThrow("temporary profile init failure");
    await expect(runner(["catalog", "search"])).resolves.toEqual({ result: { ok: true } });
    expect(profileAttempts).toBe(2);
    expect(calls.every((call) => call.bin === "/custom/ucp" && call.timeoutMs === 1234)).toBe(true);
    expect(calls[0]!.args).not.toContain("--profile");
  });
});

describe("committed fixture mode", () => {
  it("normalizes both pinned offers and throws with the checkout handoff URL on live-shape failure", async () => {
    const api = createUcp({ mode: "fixture" });
    const pinned = loadFixture("pinned.json");
    const offers = await api.searchOffers({
      query: "trail running shoes",
      shipsTo: "US",
      maxPriceCents: 20_000,
      limit: 50,
    });
    for (const item of pinned.offers as JsonRecord[]) {
      expect(offers.some((offer) => offer.variantId === item.variantId)).toBe(true);
    }
    const marathon = offers.find((offer) => offer.sellerDomain === "marathonsports.myshopify.com")!;
    const cart = await api.createCart(marathon);
    const created = await api.createCheckout(cart);
    const updated = await api.setDestination(created, {
      name: "Agent Cookie Demo",
      line1: "1 Ferry Building",
      line2: "Ferry Building",
      city: "San Francisco",
      region: "CA",
      postalCode: "94111",
      country: "US",
      raw: "ignored",
    }, { email: "demo@agent-cookie.dev" });
    await expect(api.complete(updated)).rejects.toMatchObject({
      continueUrl: expect.stringContaining("/cart/c/"),
    });
  });
});
