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

/** "42", "EU 42", "US 8.5", "M 8.5", "Men's 8.5", "8.5" → Size. Bare numbers ≥ 30 are EU, below are US. */
export function parseSize(raw: string): Size | undefined {
  const t = raw.trim().toLowerCase().replace(/\s+/g, " ");
  let m = /^(?:eu|eur)\s?(\d{2}(?:\.\d)?)$/.exec(t);
  if (m) return num(m[1]!) ? { system: "EU", value: num(m[1]!)! } : undefined;
  m = /^(?:us|us m|m|men'?s|mens)\s?(\d{1,2}(?:\.5)?)$/.exec(t);
  if (m) return num(m[1]!) ? { system: "US", value: num(m[1]!)! } : undefined;
  m = /^(\d{1,2}(?:\.\d)?)$/.exec(t);
  if (m) {
    const v = num(m[1]!);
    if (!v) return undefined;
    return Number(v) >= 30 ? { system: "EU", value: v } : { system: "US", value: v };
  }
  return undefined;
}

function toSystem(s: Size, system: "EU" | "US"): string | undefined {
  if (s.system === system) return s.value;
  return system === "US" ? EU_TO_US_MEN[s.value] : US_TO_EU_MEN[s.value];
}

export function sizeMatches(options: readonly string[], cardSize: string): boolean {
  const want = parseSize(cardSize);
  if (!want) return false;
  return options.some((o) => {
    const have = parseSize(o);
    if (!have) return false;
    return toSystem(want, have.system) === have.value;
  });
}

/** "120", "$120", "120 USD", "119.99" → cents. Undefined when no number is present. */
export function parseBudgetCents(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const m = /(\d+(?:\.\d{1,2})?)/.exec(v.replace(/,/g, ""));
  if (!m) return undefined;
  const cents = Math.round(Number(m[1]) * 100);
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

/** First `n` eligible offers with distinct sellers, in catalog order (A09: only these get sessions). */
export function pickSellers(offers: readonly UcpOffer[], q: EligibilityInput, n = 2): UcpOffer[] {
  const out: UcpOffer[] = [];
  const seen = new Set<string>();
  for (const o of offers) {
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
