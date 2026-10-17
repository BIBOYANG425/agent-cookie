import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PinnedOffers } from "@agent-cookie/contract";
import { describe, expect, it } from "vitest";
import { createUcp } from "../src/index.js";
import { createUcpInternal } from "../src/internal.js";
import { buildSearchInput, recordingOptions } from "../src/record.js";

type JsonRecord = Record<string, any>;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const testFixturesDir = join(repositoryRoot, "fixtures", "ucp", "test");

function parseInput(args: string[]): JsonRecord {
  return JSON.parse(args[args.indexOf("--input") + 1]!) as JsonRecord;
}

function catalogVariant(fields: {
  id: string;
  currency?: string;
  available?: boolean;
  size?: string;
  color?: string;
  sellerDomain?: string;
}): JsonRecord {
  return {
    id: fields.id,
    title: fields.id,
    price: { amount: 12_000, currency: fields.currency ?? "USD" },
    availability: { available: fields.available ?? true },
    options: [
      ...(fields.size ? [{ name: "Size", label: fields.size }] : []),
      ...(fields.color ? [{ name: "Colour", label: fields.color }] : []),
    ],
    seller: { domain: fields.sellerDomain ?? `${fields.id}.example`, name: fields.id },
    eligible: { native_checkout: false },
  };
}

describe("generic catalog search", () => {
  it("passes the query verbatim and puts buyer size/color signals only in intent", async () => {
    const calls: string[][] = [];
    const envelope = {
      result: {
        products: [{
          title: "Catalog result",
          variants: [
            catalogVariant({ id: "xl", size: "XL", color: "Red/Black", sellerDomain: "shared.example" }),
            catalogVariant({ id: "medium", size: "M", color: "Blue", sellerDomain: "shared.example" }),
            catalogVariant({ id: "one-size", color: "O/S" }),
            catalogVariant({ id: "unavailable", available: false }),
            catalogVariant({ id: "eur", currency: "EUR" }),
          ],
        }],
      },
    };
    const api = createUcpInternal({ mode: "live" }, async (args) => {
      calls.push(args);
      return envelope;
    });

    const offers = await api.searchOffers({
      query: "rain jacket",
      size: "M",
      color: "red",
      shipsTo: "US",
      maxPriceCents: 15_000,
    });

    expect(parseInput(calls[0]!)).toEqual({
      query: "rain jacket",
      context: {
        address_country: "US",
        currency: "USD",
        intent: "rain jacket (size: M, color: red)",
      },
      filters: { available: true, ships_to: { country: "US" }, price: { max: 15_000 } },
      pagination: { limit: 50 },
    });
    expect(parseInput(calls[0]!).filters).not.toHaveProperty("attributes");
    expect(offers.map((offer) => offer.variantId)).toEqual(["xl", "medium", "one-size"]);
    expect(offers[0]!.sizeOptions).toEqual(["XL"]);
    expect(offers[0]!.colorOptions).toEqual(["Red/Black"]);
    expect(offers[1]!.sizeOptions).toEqual(["M"]);
    expect(offers[1]!.colorOptions).toEqual(["Blue"]);
    expect(offers[2]!.sizeOptions).toEqual([]);
    expect(offers[2]!.colorOptions).toEqual(["O/S"]);

    await api.searchOffers({
      query: "waterproof coat",
      intentText: "Please find size 10 in RED",
      size: "10",
      color: "red",
      shipsTo: "CA",
    });
    expect(parseInput(calls[1]!).context.intent).toBe("Please find size 10 in RED");
    expect(parseInput(calls[1]!).context.address_country).toBe("CA");
    expect(parseInput(calls[1]!).filters.ships_to.country).toBe("CA");

    await api.searchOffers({
      query: "waterproof coat",
      intentText: "Need size 10 coat",
      size: "10",
      color: "blue",
      shipsTo: "US",
    });
    expect(parseInput(calls[2]!).context.intent).toBe("Need size 10 coat (color: blue)");
  });

  it("omits the catalog price filter when the recorder has no budget", async () => {
    const options = recordingOptions(["--query", "scarf"]);
    const calls: string[][] = [];
    const api = createUcpInternal({ mode: "live" }, async (args) => {
      calls.push(args);
      return { result: { products: [] } };
    });

    expect(options.budget).toBeUndefined();
    await api.searchOffers(buildSearchInput(options));
    expect(parseInput(calls[0]!).filters).toEqual({
      available: true,
      ships_to: { country: "US" },
    });
    expect(parseInput(calls[0]!).filters).not.toHaveProperty("price");
  });
});

describe("generic category fixture recordings", () => {
  it.each(["rain-jacket", "scarf", "basketball-shoes"])(
    "%s contains two seller chains that replay in fixture mode",
    async (category) => {
      const fixturesDir = join(testFixturesDir, category);
      const pinned = JSON.parse(readFileSync(join(fixturesDir, "pinned.json"), "utf8")) as
        PinnedOffers & { query: string; offers: Array<{ variantId: string; seller: string }> };
      expect(pinned.testOnly).toBe(true);
      expect(pinned.note).toBe("Test fixture only; not used to pick offers in live mode.");
      expect(new Set(pinned.offers.map((offer) => offer.seller)).size).toBeGreaterThanOrEqual(2);

      const api = createUcp({ mode: "fixture", fixturesDir });
      const offers = await api.searchOffers({
        query: pinned.query,
        shipsTo: "US",
        ...(pinned.budget !== undefined ? { maxPriceCents: pinned.budget * 100 } : {}),
      });
      const recordedOffers = pinned.offers.map((pinnedOffer) => {
        const offer = offers.find((candidate) =>
          candidate.variantId === pinnedOffer.variantId
          && candidate.sellerDomain === pinnedOffer.seller
        );
        expect(offer).toBeDefined();
        return offer!;
      });
      expect(new Set(recordedOffers.map((offer) => offer.sellerDomain)).size).toBeGreaterThanOrEqual(2);

      for (const offer of recordedOffers) {
        const cart = await api.createCart(offer);
        const checkout = await api.createCheckout(cart);
        const updated = await api.setDestination(checkout, {
          name: "Fixture Buyer",
          line1: "1 Main Street",
          city: "San Francisco",
          region: "CA",
          postalCode: "94111",
          country: "US",
          raw: "Fixture Buyer, 1 Main Street, San Francisco, CA 94111, US",
        });
        const completed = await api.complete(updated);
        expect([
          "requires_escalation",
          "completed",
          "complete_in_progress",
          "ready_for_complete",
        ]).toContain(completed.status);
      }
    },
  );
});
