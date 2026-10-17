// Behaviour added with the real packages (B20–B23): size strings from the recorded catalog, pinned preference,
// public upstream messages, address seed, data sources.
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { UcpOffer } from "@agent-cookie/contract";
import { REPO_ROOT } from "../src/config.js";
import { loadFixtures } from "../src/seed.js";
import { publicUpstreamMessage } from "../src/services/commerce.js";
import { pickSellers, sizeMatches } from "../src/ucp-filter.js";
import { harness, KEYS } from "./harness.js";

const offer = (seller: string, variantId: string, size: string, price = 10000): UcpOffer => ({ sellerDomain: seller, sellerName: seller,
  productTitle: "Sample shoe", variantId, variantTitle: size, priceCents: price, currency: "USD", available: true, shipsTo: ["US"],
  sizeOptions: [size], nativeCheckout: false, etaDate: null });

describe("size options as the recorded catalog writes them (lane D's shared matcher)", () => {
  it("is strict: EU 42 is US 8.5, never US 9; suffix and slash labels parse", () => {
    expect(sizeMatches(["9 US"], "US 9")).toBe(true);
    expect(sizeMatches(["9 US"], "42")).toBe(false);
    expect(sizeMatches(["8.5"], "42")).toBe(true);
    expect(sizeMatches(["US 4 / EU 36"], "EU 36")).toBe(true);
    expect(sizeMatches(["UK 7"], "41")).toBe(false);
  });
  it("prefers pinned variants that pass the filters, never ones that do not", () => {
    const offers = [offer("a.com", "va", "8.5"), offer("b.com", "vb", "8.5"), offer("c.com", "vc", "8.5"), offer("d.com", "vd", "8.5", 99999)];
    const q = { shoeSize: "42", maxPriceCents: 12000, shipsTo: "US" };
    expect(pickSellers(offers, q, 2, ["vc"]).map((o) => o.sellerDomain)).toEqual(["c.com", "a.com"]);
    expect(pickSellers(offers, q, 2, ["vd"]).map((o) => o.sellerDomain)).toEqual(["a.com", "b.com"]);
  });
});

describe("upstream messages are safe to show", () => {
  it("drops local paths and file-system errors, keeps merchant text", () => {
    expect(publicUpstreamMessage("ENOENT: no such file or directory, open '/home/user/agent-cookie/fixtures/ucp/cart-create.x.json'"))
      .toBe("The store's response for this step is not available.");
    expect(publicUpstreamMessage("ucp checkout-complete: INSUFFICIENT_PERMISSIONS: A valid JWT is required")).toBe("The store needs you to sign in and pay on its own page.");
    expect(publicUpstreamMessage("cart-create failed at https://shop.example/api/x (see /home/me/log.txt)")).toBe("cart-create failed at https://shop.example/api/x (see <path>)");
  });
});

describe("lane C seed: address import and sources (B20, B21)", () => {
  it("imports fixtures/address.json as a personal stated shipping_address, deterministically", () => {
    const a = loadFixtures(resolve(REPO_ROOT, "fixtures"));
    const b = loadFixtures(resolve(REPO_ROOT, "fixtures"));
    const addr = a.contributions.find((c) => c.field === "shipping_address")!;
    expect(addr).toMatchObject({ id: "seed-shipping-address-01", basis: "stated", agentId: a.agents.find((x) => x.category === "personal")!.agentId });
    expect(b.contributions).toEqual(a.contributions);
    expect(a.pinnedVariantIds.length).toBeGreaterThan(0);
  });
  it("the card says sample while it rests on seed data; UCP quotes say fixture", async () => {
    const h = await harness();
    expect((await h.get("/personal/card", KEYS.personal)).body.source).toBe("sample");
    const { intentId } = await h.intent();
    const quotes = (await h.get(`/personal/intents/${intentId}/quotes?wait=0`, KEYS.personal)).body.quotes;
    expect(quotes.length).toBeGreaterThan(0);
    for (const q of quotes) expect(q.source).toBe("fixture");
  });
});
