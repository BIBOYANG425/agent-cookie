import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { UcpOffer, UcpSearchQuery } from "@agent-cookie/contract";
import {
  createLiveRunner,
  createUcpInternal,
  scrubFixture,
  writeRecordedEnvelope,
  type UcpRunner,
} from "./internal.js";
import { sizeMatch } from "./size.js";

const defaultLimit = 50;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const pinnedNote = "Test fixture only; not used to pick offers in live mode.";

export interface RecordOptions {
  query: string;
  budget?: number;
  size?: string;
  color?: string;
  intent?: string;
  titleKeyword?: string;
  country: string;
  limit: number;
  out?: string;
  searchOnly: boolean;
}

export function recordingOptions(args: string[]): RecordOptions {
  let query: string | undefined;
  let budget: number | undefined;
  let size: string | undefined;
  let color: string | undefined;
  let intent: string | undefined;
  let titleKeyword: string | undefined;
  let country = "US";
  let limit = defaultLimit;
  let out: string | undefined;
  let searchOnly = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--search-only") {
      searchOnly = true;
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
    if (arg === "--query") query = value;
    else if (arg === "--budget") {
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("--budget must be a non-negative whole USD amount");
      budget = parsed;
    } else if (arg === "--size") size = value;
    else if (arg === "--color") color = value;
    else if (arg === "--intent") intent = value;
    else if (arg === "--title-keyword") titleKeyword = value;
    else if (arg === "--country") country = value;
    else if (arg === "--limit") {
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error("--limit must be a positive integer");
      limit = parsed;
    } else if (arg === "--out") out = value;
    else throw new Error(`Unknown option: ${arg}`);
    index += 1;
  }

  if (!query) throw new Error("--query is required");
  return {
    query,
    budget,
    ...(size ? { size } : {}),
    ...(color ? { color } : {}),
    ...(intent !== undefined ? { intent } : {}),
    ...(titleKeyword ? { titleKeyword } : {}),
    country,
    limit,
    ...(out ? { out } : {}),
    searchOnly,
  };
}

function slug(value: string): string {
  return value.trim().toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "") || "query";
}

function effectiveIntent(options: RecordOptions): string {
  const intent = options.intent ?? options.query;
  const signals = [
    options.size && !intent.toLowerCase().includes(options.size.toLowerCase()) ? `size: ${options.size}` : undefined,
    options.color && !intent.toLowerCase().includes(options.color.toLowerCase()) ? `color: ${options.color}` : undefined,
  ].filter((signal): signal is string => Boolean(signal));
  return signals.length > 0 ? `${intent} (${signals.join(", ")})` : intent;
}

export function buildSearchInput(options: RecordOptions): UcpSearchQuery {
  return {
    query: options.query,
    intentText: effectiveIntent(options),
    ...(options.size ? { size: options.size } : {}),
    ...(options.color ? { color: options.color } : {}),
    ...(options.budget !== undefined ? { maxPriceCents: Math.round(options.budget * 100) } : {}),
    shipsTo: options.country,
    limit: options.limit,
  };
}

function selectOffers(
  offers: UcpOffer[],
  options: RecordOptions,
  maxPriceCents?: number,
): Array<{ offer: UcpOffer; matchedSize?: string }> {
  const ranked = offers.flatMap((offer, index) => {
    if (
      offer.currency !== "USD"
      || !offer.available
      || (maxPriceCents !== undefined && offer.priceCents > maxPriceCents)
    ) return [];
    const match = options.size ? sizeMatch(offer.sizeOptions, options.size) : "match";
    if (match === "mismatch") return [];
    const matchedSize = options.size && match === "match"
      ? offer.sizeOptions.find((label) => sizeMatch([label], options.size!) === "match")
      : undefined;
    return [{ offer, index, sizeRank: match === "match" ? 0 : 1, matchedSize }];
  }).sort((a, b) =>
    a.sizeRank - b.sizeRank
    || Number(a.offer.nativeCheckout) - Number(b.offer.nativeCheckout)
    || a.index - b.index
  );

  const selected: Array<{ offer: UcpOffer; matchedSize?: string }> = [];
  const sellers = new Set<string>();
  for (const item of ranked) {
    if (sellers.has(item.offer.sellerDomain)) continue;
    sellers.add(item.offer.sellerDomain);
    selected.push({ offer: item.offer, ...(item.matchedSize ? { matchedSize: item.matchedSize } : {}) });
    if (selected.length === 2) break;
  }
  return selected;
}

async function record(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "--") args.shift();
  const options = recordingOptions(args);
  const searchInput = buildSearchInput(options);
  const liveRunner = createLiveRunner();
  const capturedEnvelopes: Array<{ args: string[]; envelope: unknown }> = [];
  const capturedRunner: UcpRunner = async (args) => {
    const envelope = await liveRunner(args);
    capturedEnvelopes.push({ args: [...args], envelope });
    return envelope;
  };
  const api = createUcpInternal({ mode: "live" }, capturedRunner);
  const offers = await api.searchOffers(searchInput);
  const selected = selectOffers(offers, options, searchInput.maxPriceCents);

  if (options.searchOnly) {
    const titleKeyword = options.titleKeyword ? new RegExp(options.titleKeyword, "i") : undefined;
    console.log(JSON.stringify({
      query: options.query,
      intent: searchInput.intentText,
      budget: options.budget ?? null,
      size: options.size ?? null,
      color: options.color ?? null,
      totalOffers: offers.length,
      distinctSellers: new Set(offers.map((offer) => offer.sellerDomain)).size,
      ...(titleKeyword ? {
        titleKeywordCount: {
          pattern: options.titleKeyword,
          count: offers.filter((offer) => titleKeyword.test(offer.productTitle)).length,
        },
      } : {}),
      picked: selected.map(({ offer }) => ({
        seller: offer.sellerDomain,
        title: offer.productTitle,
        variantTitle: offer.variantTitle,
        priceUsd: offer.priceCents / 100,
        sizeOptions: offer.sizeOptions,
        colorOptions: offer.colorOptions ?? [],
        nativeCheckout: offer.nativeCheckout,
      })),
    }, null, 2));
    return;
  }
  if (selected.length !== 2) {
    const budget = options.budget === undefined ? "" : ` within $${options.budget}`;
    throw new Error(`Matched ${selected.length} distinct sellers for "${options.query}"${budget}; need 2`);
  }

  const destination = {
    name: "Agent Cookie Demo",
    line1: "1 Ferry Building",
    line2: "Ferry Building",
    city: "San Francisco",
    region: "CA",
    postalCode: "94111",
    country: options.country,
    raw: `Agent Cookie Demo, 1 Ferry Building, Ferry Building, San Francisco, CA 94111, ${options.country}`,
  };
  const summaries = [];
  for (const { offer } of selected) {
    const cart = await api.createCart(offer);
    const checkout = await api.createCheckout(cart);
    const updated = await api.setDestination(checkout, destination, { email: "demo@agent-cookie.dev" });
    summaries.push({ variantId: offer.variantId, ...(await api.complete(updated)) });
  }

  const pinned = {
    recordedAt: new Date().toISOString(),
    query: options.query,
    ...(options.budget !== undefined ? { budget: options.budget } : {}),
    ...(options.size ? { size: options.size } : {}),
    ...(options.color ? { color: options.color } : {}),
    testOnly: true,
    note: pinnedNote,
    offers: selected.map(({ offer, matchedSize }) => ({
      variantId: offer.variantId,
      seller: offer.sellerDomain,
      title: offer.productTitle,
      price: offer.priceCents,
      ...(matchedSize ? { size: matchedSize } : {}),
      nativeCheckout: offer.nativeCheckout,
    })),
  };
  const outputDir = resolve(repositoryRoot, options.out ?? join("fixtures", "ucp", "test", slug(options.query)));
  mkdirSync(outputDir, { recursive: true });
  for (const item of capturedEnvelopes) writeRecordedEnvelope(outputDir, item.args, item.envelope);
  writeFileSync(join(outputDir, "pinned.json"), `${JSON.stringify(pinned, null, 2)}\n`, { mode: 0o644 });
  console.log(JSON.stringify(scrubFixture({ pinned, complete: summaries }), null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void record().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    if (error instanceof Error && "stdout" in error) {
      console.error(JSON.stringify(scrubFixture({
        stdout: (error as Error & { stdout?: unknown }).stdout,
        stderr: (error as Error & { stderr?: unknown }).stderr,
      }), null, 2));
    }
    process.exitCode = 1;
  });
}
