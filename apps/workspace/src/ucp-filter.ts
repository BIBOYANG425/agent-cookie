// Deterministic selection over UCP catalog offers (2026-10-17, human direction: search is driven by the user's words).
// HARD filters: USD, ships to the US, available, and the budget the user stated in THIS request. Everything else
// ranks: the wanted size (stated, else the card's), then the card's budget. Then the first N distinct sellers.
// No model involved. An unknown delivery date (etaDate null) never disqualifies an offer.
import { DEFAULT_SELLER_COUNT, type UcpDestination, type UcpOffer } from "@agent-cookie/contract";
import { parseSize, sizeMatches, toSystem } from "@agent-cookie/ucp";

// Size matching is shared with lane D (B22): one strict men's EU↔US table and one label parser, in @agent-cookie/ucp.
// EU 42 = US 8.5, EU 42.5 = US 9; a recorded US 9 is never treated as EU 42.
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

export interface SearchConditions {
  shipsTo: string;
  /** Budget stated in this request: HARD. */
  maxPriceCents?: number;
  /** The card's budget when the request stated none: ranks only. */
  preferMaxPriceCents?: number;
  /** Wanted size: stated in this request, else the card's. Ranks only; never excludes. */
  size?: string;
  /** Card `lang`: the language of `sizeNote`. */
  lang?: string;
}

/** Hard filters only. */
export function isEligible(o: UcpOffer, q: Pick<SearchConditions, "shipsTo" | "maxPriceCents">): boolean {
  if (o.currency !== "USD") return false;
  if (!o.available) return false;
  if (!Array.isArray(o.shipsTo) || !o.shipsTo.includes(q.shipsTo)) return false;
  if (!Number.isSafeInteger(o.priceCents) || o.priceCents < 0) return false;
  if (q.maxPriceCents !== undefined && o.priceCents > q.maxPriceCents) return false;
  return Boolean(o.sellerDomain && o.variantId);
}

export interface Picked { offer: UcpOffer; sizeNote?: string }

/**
 * The first `n` eligible offers from distinct sellers (A09: only these get sessions), best first:
 * pinned rehearsal variants (fixture mode only; the caller passes none in live mode), then variants in the wanted
 * size, then within the card's budget, then catalog order. Ranking never bypasses a hard filter.
 */
export function pickSellers(offers: readonly UcpOffer[], q: SearchConditions, n = DEFAULT_SELLER_COUNT,
  preferVariantIds: readonly string[] = []): Picked[] {
  const eligible = offers.filter((o) => isEligible(o, q));
  const pinRank = (o: UcpOffer) => { const i = preferVariantIds.indexOf(o.variantId); return i < 0 ? preferVariantIds.length : i; };
  const sizeRank = (o: UcpOffer) => (q.size !== undefined && sizeMatches(o.sizeOptions ?? [], q.size) ? 0 : 1);
  const budgetRank = (o: UcpOffer) => (q.preferMaxPriceCents === undefined || o.priceCents <= q.preferMaxPriceCents ? 0 : 1);
  const ranked = eligible.map((o, i) => ({ o, key: [pinRank(o), sizeRank(o), budgetRank(o), i] }))
    .sort((a, b) => lexCompare(a.key, b.key));
  const out: Picked[] = [];
  const seen = new Set<string>();
  for (const { o } of ranked) {
    if (out.length >= n) break;
    if (seen.has(o.sellerDomain)) continue;
    seen.add(o.sellerDomain);
    const note = sizeNote(o, eligible, q);
    out.push(note ? { offer: o, sizeNote: note } : { offer: o });
  }
  return out;
}

/**
 * When the wanted size is known, parses as a shoe size, and this product is sized but the variant is not the wanted
 * size: the sizes this store has for the product (eligible variants), as the store labels them.
 */
export function sizeNote(o: UcpOffer, eligible: readonly UcpOffer[], q: Pick<SearchConditions, "size" | "lang">): string | undefined {
  if (q.size === undefined) return undefined;
  const wanted = parseSize(q.size);
  if (!wanted || sizeMatches(o.sizeOptions ?? [], q.size)) return undefined;
  const label = (x: UcpOffer) => (x.sizeOptions ?? []).find((opt) => opt.split(/[\/,]/).some((c) => parseSize(c) !== undefined));
  const sameProduct = eligible.filter((x) => x.sellerDomain === o.sellerDomain && x.productTitle === o.productTitle);
  const labels = [...new Set(sameProduct.map(label).filter((l): l is string => l !== undefined))];
  if (labels.length === 0) return undefined; // not a sized product: size does not apply
  const order = (l: string) => {
    const p = parseSize(l.split(/[\/,]/)[0]!);
    const v = p && toSystem(p, wanted.system);
    return v === undefined ? Number.POSITIVE_INFINITY : Number(v);
  };
  labels.sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  const shown = labels.slice(0, 6);
  return /^zh/i.test(q.lang ?? "") ? `没有 ${q.size}，有 ${shown.join("、")}` : `No ${q.size}; has ${shown.join(", ")}`;
}

function lexCompare(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

/** public.count → 1..max; anything else → undefined (the caller rejects it). */
export function parseCount(v: string | undefined, max: number): number | undefined {
  if (v === undefined) return undefined;
  if (!/^\d{1,2}$/.test(v.trim())) return undefined;
  const n = Number(v.trim());
  return n >= 1 && n <= max ? n : undefined;
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
