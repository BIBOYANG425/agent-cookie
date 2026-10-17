import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createUcp, UcpError } from "../src/index.js";
import type { UcpRunner } from "../src/index.js";

type JsonRecord = Record<string, any>;

const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures/ucp");

function loadFixture(name: string): JsonRecord {
  return JSON.parse(readFileSync(resolve(fixturesDir, name), "utf8")) as JsonRecord;
}

function trimSearchEnvelope(envelope: JsonRecord): JsonRecord {
  const result = envelope.result as JsonRecord;
  return {
    result: {
      products: (result.products as JsonRecord[]).map((product) => ({
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
              /^(eta_date|etaDate|delivery_date|deliveryDate|estimated_delivery_date|estimatedDeliveryDate|delivery_estimate_date|deliveryEstimateDate|delivery_estimate|deliveryEstimate|delivery|eta|eta_text|etaText|delivery_estimate_text|deliveryEstimateText)$/.test(key)
            ),
          ),
        })),
      })),
      pagination: result.pagination,
    },
  };
}

const searchPages = [
  trimSearchEnvelope(loadFixture("catalog-search.global.json")),
  trimSearchEnvelope(loadFixture("catalog-search.p2.json")),
];

function allVariants(envelopes: JsonRecord[]): Array<{ product: JsonRecord; variant: JsonRecord }> {
  return envelopes.flatMap((envelope) =>
    (envelope.result.products as JsonRecord[]).flatMap((product) =>
      (product.variants as JsonRecord[]).map((variant) => ({ product, variant }))
    )
  );
}

const realVariants = allVariants(searchPages);
const marathon = realVariants.find(({ variant }) => variant.id === "gid://shopify/ProductVariant/42550028075069")!;
const capra = realVariants.find(({ variant }) => variant.id === "gid://shopify/ProductVariant/42418551193643")!;

function envelopeFor(...items: Array<{ product: JsonRecord; variant: JsonRecord }>): JsonRecord {
  return {
    result: {
      products: items.map(({ product, variant }) => ({
        id: product.id,
        title: product.title,
        variants: [variant],
      })),
      pagination: { has_next_page: false },
    },
  };
}

function clientFor(envelopes: JsonRecord[]) {
  let index = 0;
  const calls: string[][] = [];
  const run: UcpRunner = async (args) => {
    calls.push(args);
    return envelopes[index++]!;
  };
  return { api: createUcp({ mode: "live", run }), calls };
}

function completeApi(response: unknown) {
  return createUcp({
    mode: "live",
    run: async () => response,
  }).complete({ seller: "shop.example", checkoutId: "checkout-1" });
}

describe("UcpApi search", () => {
  it("parses trimmed live envelopes, locally filters, and keeps the first two distinct sellers", async () => {
    const { api, calls } = clientFor(searchPages);
    const offers = await api.searchOffers({ shoe_size: "9", budget: 200 });

    expect(offers.map(({ seller, size }) => [seller, size])).toEqual([
      ["marathonsports.myshopify.com", "9 US"],
      ["capra-run.myshopify.com", "9"],
    ]);
    expect(new Set(offers.map((offer) => offer.seller)).size).toBe(2);
    expect(offers.every((offer) => offer.currency === "USD" && offer.price <= 20_000)).toBe(true);
    expect(offers.every((offer) => offer.etaDate === null)).toBe(true);
    const input = JSON.parse(calls[0]![calls[0]!.indexOf("--input") + 1]!) as JsonRecord;
    expect(input).toEqual({
      query: "trail running shoes",
      context: { address_country: "US", currency: "USD" },
      filters: {
        available: true,
        ships_to: { country: "US" },
        price: { max: 20_000 },
      },
      pagination: { limit: 50 },
    });
  });

  it("excludes real NZD, unavailable, over-budget, and UK 4.5 variants", async () => {
    const nzd = realVariants.find(({ variant }) =>
      variant.price?.currency === "NZD"
      && variant.options?.some((option: JsonRecord) => option.label === "9 US")
    )!;
    expect(nzd).toBeDefined();
    expect(await clientFor([envelopeFor(nzd)]).api.searchOffers({ shoe_size: "9" })).toEqual([]);

    const unavailable = {
      ...marathon.variant,
      availability: { available: false },
    };
    const overBudget = {
      ...capra.variant,
      price: { ...capra.variant.price, amount: 20_001 },
    };
    expect(await clientFor([envelopeFor(
      { product: marathon.product, variant: unavailable },
      { product: capra.product, variant: overBudget },
    )]).api.searchOffers({ shoe_size: "9", budget: 200 })).toEqual([]);

    const uk = realVariants.find(({ variant }) =>
      variant.options?.some((option: JsonRecord) => option.label === "UK 4.5")
    )!;
    expect(uk).toBeDefined();
    expect(await clientFor([envelopeFor(uk)]).api.searchOffers({ shoe_size: "4.5" })).toEqual([]);
  });

  it("matches EU 42 labels and drops only dates later than the deadline", async () => {
    const eu42 = realVariants.find(({ variant }) =>
      variant.options?.some((option: JsonRecord) => option.label === "42")
    )!;
    expect(eu42).toBeDefined();
    const first: JsonRecord = {
      ...eu42.variant,
      price: { amount: 12_000, currency: "USD" },
      seller: { ...eu42.variant.seller, domain: "eu42.example" },
    };
    const combined: JsonRecord = {
      ...first,
      id: `${first.id}-combined`,
      options: [{ name: "Size", label: "9 US / 42 EU" }],
      seller: { ...first.seller, domain: "combined-size.example" },
    };
    const euOffers = await clientFor([envelopeFor(
      { product: eu42.product, variant: first },
      { product: eu42.product, variant: combined },
    )]).api.searchOffers({ shoe_size: "42" });
    expect(euOffers.map((offer) => offer.size)).toEqual(["42", "9 US / 42 EU"]);

    const late = {
      ...marathon.variant,
      eta_date: "2030-01-01",
    };
    expect(await clientFor([envelopeFor({ product: marathon.product, variant: late })])
      .api.searchOffers({ shoe_size: "9", deadline: "2029-12-31" })).toEqual([]);
    const unknownEta = await clientFor([envelopeFor(marathon)])
      .api.searchOffers({ shoe_size: "9", deadline: "2020-01-01" });
    expect(unknownEta[0]?.etaDate).toBeNull();
  });

  it("follows the cursor while fewer than two sellers match", async () => {
    let index = 0;
    const calls: string[][] = [];
    const run: UcpRunner = async (args) => {
      calls.push(args);
      if (index++ === 0) {
        return {
          ...envelopeFor(marathon),
          result: {
            ...envelopeFor(marathon).result,
            pagination: { has_next_page: true, cursor: "cursor-next" },
          },
        };
      }
      return envelopeFor(capra);
    };
    const offers = await createUcp({ mode: "live", run })
      .searchOffers({ shoe_size: "9", budget: 200 });
    expect(offers).toHaveLength(2);
    const secondInput = JSON.parse(calls[1]![calls[1]!.indexOf("--input") + 1]!) as JsonRecord;
    expect(secondInput.pagination).toEqual({ cursor: "cursor-next", limit: 50 });
  });
});

describe("UcpApi complete", () => {
  it("maps completed and escalation responses and preserves warnings", async () => {
    const warning = {
      type: "warning",
      code: "sold_out",
      content: "This item is sold out.",
      extension: { source: "merchant" },
    };
    await expect(completeApi({
      result: { status: "completed", order: { id: "order-1" }, messages: [warning] },
    })).resolves.toEqual({ status: "ordered", orderId: "order-1", messages: [warning] });
    await expect(completeApi({
      result: { status: "requires_escalation", continue_url: "https://shop.example/checkout", messages: [warning] },
    })).resolves.toEqual({
      status: "handoff",
      continueUrl: "https://shop.example/checkout",
      messages: [warning],
    });
    await expect(completeApi({
      result: { status: "requires_escalation", messages: [warning] },
    })).resolves.toEqual({ status: "failed", messages: [warning] });
  });

  it("maps error envelopes and runner throws to failed without throwing", async () => {
    await expect(completeApi({ code: "UPSTREAM_ERROR", message: "unavailable" }))
      .resolves.toEqual({ status: "failed", messages: [] });
    const warning = { type: "warning", content: "Try again" };
    const api = createUcp({
      mode: "live",
      run: async () => {
        throw new UcpError("CLI failed", {
          stdout: JSON.stringify({ continue_url: "https://shop.example/continue", messages: [warning] }),
        });
      },
    });
    await expect(api.complete({ seller: "shop.example", checkoutId: "checkout-1" }))
      .resolves.toEqual({
        status: "failed",
        continueUrl: "https://shop.example/continue",
        messages: [warning],
      });
  });
});

describe("UCP operation arguments", () => {
  it("passes cart and checkout identifiers in the CLI's expected locations", async () => {
    const calls: string[][] = [];
    const lineItem = { id: "line-1", item: { id: "variant-1" }, quantity: 1 };
    const run: UcpRunner = async (args) => {
      calls.push(args);
      if (args[0] === "cart") return { result: { id: "cart-1", line_items: [lineItem], messages: [] } };
      if (args[1] === "create") {
        return {
          result: {
            id: "checkout-1",
            line_items: [lineItem],
            fulfillment: { methods: [] },
            continue_url: "https://shop.example/checkout",
            messages: [],
          },
        };
      }
      if (args[1] === "update") return { result: { messages: [] } };
      return { result: { status: "completed", order_id: "order-1", messages: [] } };
    };
    const api = createUcp({ mode: "live", run });
    const cart = await api.createCart({ seller: "shop.example", variantId: "variant-1" });
    await api.createCheckout({ seller: "shop.example", cartId: cart.cartId });
    await api.setDestination({
      seller: "shop.example",
      checkoutId: "checkout-1",
      email: "demo@agent-cookie.dev",
      address: {
        firstName: "Agent",
        lastName: "Cookie",
        streetAddress: "1 Ferry Building",
        locality: "San Francisco",
        region: "CA",
        postalCode: "94111",
        country: "US",
      },
    });
    await api.complete({ seller: "shop.example", checkoutId: "checkout-1" });

    for (const args of calls) {
      expect(args.slice(args.indexOf("--profile"), args.indexOf("--profile") + 2))
        .toEqual(["--profile", "agent"]);
      expect(args.slice(args.indexOf("--format"), args.indexOf("--format") + 2))
        .toEqual(["--format", "json"]);
    }
    const createCheckout = calls[1]!;
    const createInput = JSON.parse(createCheckout[createCheckout.indexOf("--input") + 1]!) as JsonRecord;
    expect(createCheckout.slice(0, 2)).toEqual(["checkout", "create"]);
    expect(createCheckout).not.toContain("--cart-id");
    expect(createInput).toMatchObject({ cart_id: "cart-1", line_items: [lineItem] });

    const update = calls[2]!;
    const updateInput = JSON.parse(update[update.indexOf("--input") + 1]!) as JsonRecord;
    expect(update.slice(0, 3)).toEqual(["checkout", "update", "checkout-1"]);
    expect(update.slice(update.indexOf("--business"), update.indexOf("--business") + 2))
      .toEqual(["--business", "shop.example"]);
    expect(updateInput.line_items).toEqual([lineItem]);
    expect(updateInput.fulfillment.methods[0].line_item_ids).toEqual(["line-1"]);

    const complete = calls[3]!;
    const completeInput = JSON.parse(complete[complete.indexOf("--input") + 1]!) as JsonRecord;
    expect(complete.slice(0, 3)).toEqual(["checkout", "complete", "checkout-1"]);
    expect(complete.slice(complete.indexOf("--business"), complete.indexOf("--business") + 2))
      .toEqual(["--business", "shop.example"]);
    expect(completeInput).toEqual({ payment: {} });
    expect(completeInput).not.toHaveProperty("payment.instruments");
  });
});

describe("fixture mode", () => {
  it("runs the recorded search, cart, checkout, destination, and complete flow", async () => {
    const api = createUcp({ mode: "fixture", fixturesDir });
    const offers = await api.searchOffers({ shoe_size: "9", budget: 200 });
    expect(offers.map((offer) => offer.variantId)).toEqual([
      "gid://shopify/ProductVariant/42550028075069",
      "gid://shopify/ProductVariant/42418551193643",
    ]);
    for (const offer of offers) {
      const cart = await api.createCart({ seller: offer.seller, variantId: offer.variantId });
      const checkout = await api.createCheckout({ seller: offer.seller, cartId: cart.cartId });
      const destination = await api.setDestination({
        seller: offer.seller,
        checkoutId: checkout.checkoutId,
        email: "demo@agent-cookie.dev",
        address: {
          firstName: "Agent",
          lastName: "Cookie",
          streetAddress: "1 Ferry Building",
          locality: "San Francisco",
          region: "CA",
          postalCode: "94111",
          country: "US",
        },
      });
      expect(destination.messages[0]?.code).toBe("buyer_identity_email_is_invalid");
      await expect(api.complete({ seller: offer.seller, checkoutId: checkout.checkoutId }))
        .resolves.toEqual({ status: "failed", messages: [] });
    }
  });
});
