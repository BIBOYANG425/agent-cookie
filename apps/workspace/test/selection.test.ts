// Text-driven selection (2026-10-17, human direction). Property tests: what must hold for ANY catalog, not which store
// or price comes out. Hard: USD, ships to US, available, the budget stated in this request. Soft: size (stated, else
// the card's) and the card's budget only rank. At most N distinct sellers. Size mismatch → sizeNote.
import { describe, expect, it } from "vitest";
import type { UcpOffer } from "@agent-cookie/contract";
import { isEligible, mentions, parseCount, pickSellers, sizeMatches, terms, type SearchConditions } from "../src/ucp-filter.js";

let seq = 0;
const offer = (seller: string, size: string | null, price: number, extra: Partial<UcpOffer> = {}): UcpOffer => ({
  sellerDomain: seller, sellerName: seller, productTitle: `${seller} shoe`, variantId: `v${++seq}`, variantTitle: size ?? "",
  priceCents: price, currency: "USD", available: true, shipsTo: ["US"], sizeOptions: size === null ? [] : [size],
  nativeCheckout: false, etaDate: null, ...extra });

/** A random-ish but deterministic catalog: several sellers, mixed sizes, prices, currencies, availability. */
function catalog(n: number): UcpOffer[] {
  const sizes = ["US 8", "US 8.5", "US 9", "41", "42", "43", "US 10", null];
  const out: UcpOffer[] = [];
  for (let i = 0; i < n; i++) {
    out.push(offer(`s${i % 7}.example`, sizes[(i * 5) % sizes.length]!, 4000 + ((i * 3719) % 20000), {
      currency: i % 11 === 0 ? "EUR" : "USD", available: i % 13 !== 0, shipsTo: i % 17 === 0 ? ["CA"] : ["US"],
      productTitle: `p${i % 3}` }));
  }
  return out;
}

describe("selection properties (any catalog)", () => {
  const cases: Array<{ q: SearchConditions; n: number }> = [];
  for (const maxPriceCents of [undefined, 9000, 15000]) for (const size of [undefined, "42", "US 9", "47"]) for (const n of [1, 2, 3, 5]) {
    cases.push({ q: { shipsTo: "US", ...(maxPriceCents ? { maxPriceCents } : {}), ...(size ? { size } : {}), preferMaxPriceCents: 10000 }, n });
  }
  it.each(cases.map((c, i) => [i, c] as const))("case %i", (_, { q, n }) => {
    const offers = catalog(60);
    const picked = pickSellers(offers, q, n);
    const sellers = picked.map((p) => p.offer.sellerDomain);
    expect(picked.length).toBeLessThanOrEqual(n);
    expect(new Set(sellers).size).toBe(sellers.length);
    // as many sellers as the hard filters allow
    const eligibleSellers = new Set(offers.filter((o) => isEligible(o, q)).map((o) => o.sellerDomain));
    expect(picked.length).toBe(Math.min(n, eligibleSellers.size));
    for (const { offer: o, sizeNote } of picked) {
      expect(o.currency).toBe("USD");
      expect(o.available).toBe(true);
      expect(o.shipsTo).toContain("US");
      if (q.maxPriceCents !== undefined) expect(o.priceCents).toBeLessThanOrEqual(q.maxPriceCents);
      // a size mismatch on a sized product is always explained; a match never carries a note
      if (q.size !== undefined && sizeMatches(o.sizeOptions, q.size)) expect(sizeNote).toBeUndefined();
      if (sizeNote) expect(sizeMatches(o.sizeOptions, q.size!)).toBe(false);
      // a seller with the wanted size in stock is quoted in that size
      if (q.size !== undefined) {
        const sellerHas = offers.some((x) => x.sellerDomain === o.sellerDomain && isEligible(x, q) && sizeMatches(x.sizeOptions, q.size!));
        if (sellerHas) expect(sizeMatches(o.sizeOptions, q.size)).toBe(true);
      }
    }
  });
});

describe("size is soft, the stated budget is hard", () => {
  it("returns sellers even when none has the size, each with a note listing what the store has", () => {
    const offers = [offer("a.com", "US 8", 9000), offer("a.com", "US 10", 9000), offer("b.com", "43", 9500)];
    const picked = pickSellers(offers, { shipsTo: "US", size: "42", lang: "zh" }, 2);
    expect(picked).toHaveLength(2);
    expect(picked[0]!.sizeNote).toBe("没有 42，有 US 8、US 10");
    expect(picked[1]!.sizeNote).toBe("没有 42，有 43");
    expect(pickSellers(offers, { shipsTo: "US", size: "42", lang: "en" }, 1)[0]!.sizeNote).toBe("No 42; has US 8, US 10");
  });
  it("ranks sellers with the wanted size first, but still fills N with the others", () => {
    const offers = [offer("a.com", "US 10", 5000), offer("b.com", "US 8.5", 9000), offer("c.com", "US 7", 6000)];
    const picked = pickSellers(offers, { shipsTo: "US", size: "42" }, 2);
    expect(picked.map((p) => p.offer.sellerDomain)[0]).toBe("b.com");
    expect(picked[0]!.sizeNote).toBeUndefined();
    expect(picked[1]!.sizeNote).toBeDefined();
  });
  it("ranks a size match before no-size and mismatch offers", () => {
    const offers = [
      offer("mismatch.com", "US 9", 5000),
      offer("no-size.com", null, 5000),
      offer("match.com", "EU 42", 5000),
    ];
    const picked = pickSellers(offers, { shipsTo: "US", size: "42" }, 3);
    expect(picked.map(({ offer: pickedOffer }) => pickedOffer.sellerDomain))
      .toEqual(["match.com", "no-size.com", "mismatch.com"]);
    expect(picked[1]!.sizeNote).toBeUndefined();
  });
  it("unsized products carry no note (size does not apply)", () => {
    expect(pickSellers([offer("a.com", null, 2000)], { shipsTo: "US", size: "42" }, 1)[0]!.sizeNote).toBeUndefined();
  });
  it("the card's budget ranks only; the stated budget excludes", () => {
    const offers = [offer("a.com", "42", 20000), offer("b.com", "42", 30000)];
    expect(pickSellers(offers, { shipsTo: "US", preferMaxPriceCents: 12000 }, 2)).toHaveLength(2);
    expect(pickSellers(offers, { shipsTo: "US", maxPriceCents: 12000 }, 2)).toHaveLength(0);
    const mixed = [offer("a.com", "42", 20000), offer("b.com", "42", 9000)];
    expect(pickSellers(mixed, { shipsTo: "US", preferMaxPriceCents: 12000 }, 1)[0]!.offer.sellerDomain).toBe("b.com");
  });
  it("count is 1–5", () => {
    expect([parseCount("1", 5), parseCount("5", 5), parseCount(" 3 ", 5)]).toEqual([1, 5, 3]);
    for (const bad of ["0", "6", "2.5", "two", "", "-1"]) expect(parseCount(bad, 5)).toBeUndefined();
  });
});

describe("learned preferences in ranking (pref.brand / pref.color rank, pref.avoid excludes)", () => {
  const brands = ["Brooks", "Hoka", "Saucony", "Altra", "Nike"];
  const colors = ["Black", "Blue", "Red", "Green"];
  const shop = (i: number) => offer(`s${i % 6}.example`, i % 3 ? "US 8.5" : "US 10", 5000 + ((i * 977) % 9000), {
    productTitle: `${brands[i % brands.length]} Runner ${i % 4}`, variantTitle: `${colors[(i * 7) % colors.length]} / ${i % 3 ? "US 8.5" : "US 10"}` });
  const offers = Array.from({ length: 40 }, (_, i) => shop(i));
  const prefSets = [
    { brand: ["hoka"], color: [], avoid: ["nike"] },
    { brand: ["brooks", "altra"], color: ["blue"], avoid: [] },
    { brand: [], color: ["red"], avoid: ["saucony", "black"] },
  ];
  it.each(prefSets.map((p, i) => [i, p] as const))("prefs %i: avoided terms never appear; a seller offering the brand is quoted in it", (_, prefs) => {
    const q: SearchConditions = { shipsTo: "US", size: "42", prefs };
    const picked = pickSellers(offers, q, 4);
    for (const { offer: o } of picked) for (const t of prefs.avoid) expect(mentions(o, t)).toBe(false);
    const score = (x: UcpOffer) => Number(prefs.brand.some((t) => mentions(x, t))) + Number(prefs.color.some((t) => mentions(x, t)));
    for (const { offer: o } of picked) {
      // size first; within the wanted size, the seller's offer matching the most preferences (brand, color) is quoted
      const sameSize = offers.filter((x) => x.sellerDomain === o.sellerDomain && isEligible(x, q) && sizeMatches(x.sizeOptions, "42"));
      if (sameSize.length) {
        expect(sizeMatches(o.sizeOptions, "42")).toBe(true);
        expect(score(o)).toBe(Math.max(...sameSize.map(score)));
      }
    }
  });
  it("terms split on commas, 、, slashes and 'and'/和; matching is whole-word for Latin terms", () => {
    expect(terms("Brooks, Hoka")).toEqual(["brooks", "hoka"]);
    expect(terms("Brooks、Hoka 和 Altra")).toEqual(["brooks", "hoka", "altra"]);
    expect(terms("red and blue / green")).toEqual(["red", "blue", "green"]);
    expect(terms(undefined)).toEqual([]);
    const o = offer("x.example", "US 9", 1000, { productTitle: "Shredder Trail", variantTitle: "Redwood / US 9" });
    expect(mentions(o, "red")).toBe(false);
    expect(mentions(o, "redwood")).toBe(true);
    expect(mentions(offer("y.example", "US 9", 1000, { productTitle: "跑鞋 黑色" }), "黑色")).toBe(true);
  });
});

