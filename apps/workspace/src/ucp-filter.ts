// Deterministic post-filter over UCP catalog offers (lane B's field findings, 2026-10-17): keep only USD,
// ships to US, available, size matching the card, price within budget; then the first two distinct sellers.
// No model involved. An unknown delivery date (etaDate null) never disqualifies an offer.
import type { UcpDestination, UcpOffer } from "@agent-cookie/contract";
import { sizeMatches } from "@agent-cookie/ucp";

// Size matching is shared with lane D (B22): one strict men's EU↔US table and one label parser, in @agent-cookie/ucp.
// EU 42 = US 8.5, EU 42.5 = US 9; a recorded US 9 is never quoted as EU 42.
export { parseSize, sizeMatches } from "@agent-cookie/ucp";

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
