// Deterministic post-filter over UCP catalog offers (lane B's field findings, 2026-10-17): keep only USD,
// ships to US, available, size matching the card, price within budget; then the first two distinct sellers.
// No model involved. An unknown delivery date (etaDate null) never disqualifies an offer.
import type { UcpDestination, UcpOffer } from "@agent-cookie/contract";

/** Men's EU → US, the common Brooks/Saucony/Nike table. Brand tables differ by up to half a size; this is a filter, not a fitting. */
const EU_TO_US_MEN: Record<string, string> = {
  "38": "5.5", "38.5": "6", "39": "6.5", "40": "7", "40.5": "7.5", "41": "8", "42": "8.5", "42.5": "9", "43": "9.5",
  "44": "10", "44.5": "10.5", "45": "11", "45.5": "11.5", "46": "12", "47": "13", "48": "14",
};
const US_TO_EU_MEN: Record<string, string> = Object.fromEntries(Object.entries(EU_TO_US_MEN).map(([eu, us]) => [us, eu]));

export interface Size { system: "EU" | "US"; value: string }

function num(s: string): string | undefined {
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? String(n) : undefined;
}

/** One size token: "EU 42", "42 EU", "US 9", "9 US", "M 9", "Men's 9", "US Men 9", "Size 9", "9", "42" (bare ≥ 30 is EU). UK and women's sizes are not parsed. */
function parseOne(part: string): Size | undefined {
  const t = part.trim().toLowerCase().replace(/\s+/g, " ").replace(/^size /, "");
  if (t === "" || /women|wmn|\bw\b|\buk\b|\bcm\b|\bjp\b/.test(t)) return undefined;
  let m = /^(?:eu|eur)\s?(\d{2}(?:\.\d)?)$/.exec(t) ?? /^(\d{2}(?:\.\d)?)\s?(?:eu|eur)$/.exec(t);
  if (m) return num(m[1]!) ? { system: "EU", value: num(m[1]!)! } : undefined;
  m = /^(?:us(?: m| men'?s?| mens)?|m|men'?s|mens)\s?(\d{1,2}(?:\.5)?)$/.exec(t) ?? /^(\d{1,2}(?:\.5)?)\s?(?:us|us m|m)$/.exec(t);
  if (m) return num(m[1]!) ? { system: "US", value: num(m[1]!)! } : undefined;
  m = /^(\d{1,2}(?:\.\d)?)$/.exec(t);
  if (m) {
    const v = num(m[1]!);
    if (!v) return undefined;
    return Number(v) >= 30 ? { system: "EU", value: v } : { system: "US", value: v };
  }
  return undefined;
}

/** Every size a variant option states: "US 4 / EU 36", "7.5 (42)", "US Women 6 - US Men 4" → each part on its own. */
export function parseSizes(raw: string): Size[] {
  return raw.split(/\/|,|;|\||\s-\s|\(|\)/).map(parseOne).filter((x): x is Size => x !== undefined);
}

export function parseSize(raw: string): Size | undefined {
  return parseSizes(raw)[0];
}

function toSystem(s: Size, system: "EU" | "US"): string | undefined {
  if (s.system === system) return s.value;
  return system === "US" ? EU_TO_US_MEN[s.value] : US_TO_EU_MEN[s.value];
}

/** Strict: EU 42 matches US 8.5 or EU 42, never US 9 (lanes B/C: a recorded US 9 must not be quoted as EU 42). */
export function sizeMatches(options: readonly string[], cardSize: string): boolean {
  const want = parseSize(cardSize);
  if (!want) return false;
  return options.some((o) => parseSizes(o).some((have) => toSystem(want, have.system) === have.value));
}

/** "120", "$120", "120 USD", "120 以内", "1,200", "119.99" → cents; a range "100-160" / "100 到 160" → its upper bound. */
export function parseBudgetCents(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const nums = [...v.replace(/(\d),(?=\d{3}\b)/g, "$1").matchAll(/\d+(?:\.\d{1,2})?/g)].map((m) => Number(m[0]));
  if (nums.length === 0) return undefined;
  const max = nums.length >= 2 && /\d\s*(?:-|–|~|到|至|to)\s*\$?\d/i.test(v) ? Math.max(nums[0]!, nums[1]!) : nums[0]!;
  const cents = Math.round(max * 100);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : undefined;
}

export interface EligibilityInput { shoeSize?: string; maxPriceCents?: number; shipsTo: string }

export function isEligible(o: UcpOffer, q: EligibilityInput): boolean {
  if (o.currency !== "USD") return false;
  if (!o.available) return false;
  if (!Array.isArray(o.shipsTo) || !o.shipsTo.includes(q.shipsTo)) return false;
  if (!Number.isSafeInteger(o.priceCents) || o.priceCents < 0) return false;
  if (q.maxPriceCents !== undefined && o.priceCents > q.maxPriceCents) return false;
  if (q.shoeSize !== undefined && !sizeMatches(o.sizeOptions ?? [], q.shoeSize)) return false;
  return Boolean(o.sellerDomain && o.variantId);
}

/**
 * First `n` eligible offers with distinct sellers (A09: only these get sessions). Pinned rehearsal variants that pass
 * every filter come first, in pinned order; then catalog order. Pinning never bypasses a filter.
 */
export function pickSellers(offers: readonly UcpOffer[], q: EligibilityInput, n = 2, preferVariantIds: readonly string[] = []): UcpOffer[] {
  const out: UcpOffer[] = [];
  const seen = new Set<string>();
  const pinned = preferVariantIds.map((id) => offers.find((o) => o.variantId === id)).filter((o): o is UcpOffer => o !== undefined);
  for (const o of [...pinned, ...offers]) {
    if (out.length >= n) break;
    if (seen.has(o.sellerDomain) || !isEligible(o, q)) continue;
    seen.add(o.sellerDomain);
    out.push(o);
  }
  return out;
}

/**
 * Best-effort split of a one-line address "Name, 1234 Street, Apt 5, City, ST 12345, US" into a UCP destination.
 * The original line is kept in `raw`; the merchant's page is the fallback if the split is wrong.
 */
export function parseAddress(line: string): UcpDestination {
  const parts = line.split(",").map((p) => p.trim()).filter(Boolean);
  let country = "US";
  if (parts.length > 0 && /^[A-Za-z]{2}$/.test(parts[parts.length - 1]!)) country = parts.pop()!.toUpperCase();
  let region = "";
  let postalCode = "";
  const rp = parts.length > 0 ? /^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/.exec(parts[parts.length - 1]!) : null;
  if (rp) {
    parts.pop();
    region = rp[1]!.toUpperCase();
    postalCode = rp[2]!;
  }
  const city = parts.length > 1 ? parts.pop()! : "";
  const streetIdx = parts.findIndex((p) => /^\d/.test(p));
  const name = streetIdx > 0 ? parts.slice(0, streetIdx).join(", ") : undefined;
  const line1 = streetIdx >= 0 ? parts[streetIdx]! : (parts[0] ?? "");
  const rest = streetIdx >= 0 ? parts.slice(streetIdx + 1) : parts.slice(1);
  const d: UcpDestination = { line1, city, region, postalCode, country, raw: line };
  if (name) d.name = name;
  if (rest.length > 0) d.line2 = rest.join(", ");
  return d;
}
