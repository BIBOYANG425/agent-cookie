import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { UcpOffer } from "@agent-cookie/contract";
import {
  createLiveRunner,
  createUcpInternal,
  scrubFixture,
  writeRecordedEnvelope,
  type UcpRunner,
} from "./internal.js";
import { sizeMatches } from "./size.js";

const defaultSize = "9";
const defaultBudget = 200;
const defaultLimit = 50;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const fixturesDir = join(repositoryRoot, "fixtures", "ucp");

function recordingOptions(args: string[]): {
  size: string;
  budget: number;
  intentText?: string;
  limit: number;
} {
  let size = defaultSize;
  let budget = defaultBudget;
  let intentText: string | undefined;
  let limit = defaultLimit;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--size" && args[index + 1]) size = args[++index]!;
    else if (args[index] === "--budget" && args[index + 1]) {
      const parsed = Number(args[++index]);
      if (!Number.isFinite(parsed)) throw new Error("--budget must be a number of whole USD");
      budget = parsed;
    } else if (args[index] === "--intent" && args[index + 1]) {
      intentText = args[++index]!;
    } else if (args[index] === "--limit" && args[index + 1]) {
      const parsed = Number(args[++index]);
      if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error("--limit must be a positive integer");
      limit = parsed;
    }
  }
  return { size, budget, ...(intentText ? { intentText } : {}), limit };
}

function selectOffers(
  offers: UcpOffer[],
  size: string,
  maxPriceCents: number,
): Array<{ offer: UcpOffer; size: string }> {
  const selected: Array<{ offer: UcpOffer; size: string }> = [];
  const sellers = new Set<string>();
  for (const offer of offers) {
    const matchedSize = offer.sizeOptions.find((label) => sizeMatches([label], size));
    if (
      selected.length >= 2
      || sellers.has(offer.sellerDomain)
      || offer.currency !== "USD"
      || !offer.available
      || offer.priceCents > maxPriceCents
      || offer.nativeCheckout
      || !matchedSize
    ) continue;
    sellers.add(offer.sellerDomain);
    selected.push({ offer, size: matchedSize });
  }
  return selected;
}

async function record(): Promise<void> {
  const { size, budget, intentText, limit } = recordingOptions(process.argv.slice(2));
  const maxPriceCents = Math.round(budget * 100);
  const liveRunner = createLiveRunner();
  const capturedEnvelopes: Array<{ args: string[]; envelope: unknown }> = [];
  const capturedRunner: UcpRunner = async (args) => {
    const envelope = await liveRunner(args);
    capturedEnvelopes.push({ args: [...args], envelope });
    return envelope;
  };
  const api = createUcpInternal({ mode: "live" }, capturedRunner);
  const offers = selectOffers(
    await api.searchOffers({
      query: "trail running shoes",
      ...(intentText ? { intentText } : {}),
      maxPriceCents,
      shipsTo: "US",
      limit,
    }),
    size,
    maxPriceCents,
  );
  if (offers.length !== 2) {
    throw new Error(`Matched ${offers.length} distinct non-native sellers for size ${size} within $${budget}; need 2`);
  }

  const destination = {
    name: "Agent Cookie Demo",
    line1: "1 Ferry Building",
    line2: "Ferry Building",
    city: "San Francisco",
    region: "CA",
    postalCode: "94111",
    country: "US",
    raw: "Agent Cookie Demo, 1 Ferry Building, Ferry Building, San Francisco, CA 94111, US",
  };
  const summaries = [];
  for (const { offer } of offers) {
    const cart = await api.createCart(offer);
    const checkout = await api.createCheckout(cart);
    const updated = await api.setDestination(checkout, destination, { email: "demo@agent-cookie.dev" });
    if (offer.nativeCheckout) {
      summaries.push({ variantId: offer.variantId, status: "skipped-native-checkout", messages: [] });
      continue;
    }
    summaries.push({ variantId: offer.variantId, ...(await api.complete(updated)) });
  }

  const pinned = {
    recordedAt: new Date().toISOString(),
    size,
    budget,
    offers: offers.map(({ offer, size: matchedSize }) => ({
      variantId: offer.variantId,
      seller: offer.sellerDomain,
      title: offer.productTitle,
      price: offer.priceCents,
      size: matchedSize,
      nativeCheckout: offer.nativeCheckout,
    })),
  };
  mkdirSync(fixturesDir, { recursive: true });
  for (const item of capturedEnvelopes) writeRecordedEnvelope(fixturesDir, item.args, item.envelope);
  writeFileSync(join(fixturesDir, "pinned.json"), `${JSON.stringify(pinned, null, 2)}\n`, { mode: 0o644 });
  console.log(JSON.stringify({ pinned, complete: summaries }, null, 2));
}

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
