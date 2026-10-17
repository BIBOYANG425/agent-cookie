import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { UpstreamError } from "@agent-cookie/contract";
import type { UcpOffer } from "@agent-cookie/contract";
import {
  createLiveRunner,
  createUcpInternal,
  scrubFixture,
  writeRecordedEnvelope,
  type UcpRunner,
} from "./internal.js";

const defaultSize = "9";
const defaultBudget = 200;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const fixturesDir = join(repositoryRoot, "fixtures", "ucp");

function recordingOptions(args: string[]): { size: string; budget: number } {
  let size = defaultSize;
  let budget = defaultBudget;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--size" && args[index + 1]) size = args[++index]!;
    else if (args[index] === "--budget" && args[index + 1]) {
      const parsed = Number(args[++index]);
      if (!Number.isFinite(parsed)) throw new Error("--budget must be a number of whole USD");
      budget = parsed;
    }
  }
  return { size, budget };
}

function parseSize(raw: string): { number: number; region: string } | undefined {
  const match = /^(?:(US|EU|UK)\s*)?(\d+(?:\.\d+)?)(?:\s*(US|EU|UK))?$/i.exec(raw.trim());
  if (!match) return undefined;
  const prefix = match[1]?.toLowerCase();
  const suffix = match[3]?.toLowerCase();
  if (prefix && suffix && prefix !== suffix) return undefined;
  const number = Number(match[2]);
  return { number, region: prefix ?? suffix ?? (number >= 30 ? "eu" : "us") };
}

function matchingSize(offer: UcpOffer, requestedSize: string): string | undefined {
  const requested = requestedSize.split(/[\/,]/).map(parseSize).filter(Boolean);
  for (const label of offer.sizeOptions) {
    for (const token of label.split(/[\/,]/)) {
      const parsed = parseSize(token);
      if (parsed && requested.some((size) =>
        size!.number === parsed.number && size!.region === parsed.region
      )) return label;
    }
  }
  return undefined;
}

function selectOffers(
  offers: UcpOffer[],
  size: string,
  maxPriceCents: number,
): Array<{ offer: UcpOffer; size: string }> {
  const selected: Array<{ offer: UcpOffer; size: string }> = [];
  const sellers = new Set<string>();
  for (const offer of offers) {
    const matchedSize = matchingSize(offer, size);
    if (
      selected.length >= 2
      || sellers.has(offer.sellerDomain)
      || offer.currency !== "USD"
      || !offer.available
      || offer.priceCents > maxPriceCents
      || !matchedSize
    ) continue;
    sellers.add(offer.sellerDomain);
    selected.push({ offer, size: matchedSize });
  }
  return selected;
}

async function record(): Promise<void> {
  const { size, budget } = recordingOptions(process.argv.slice(2));
  const maxPriceCents = Math.round(budget * 100);
  mkdirSync(fixturesDir, { recursive: true });
  const liveRunner = createLiveRunner();
  const captured: UcpRunner = async (args) => {
    const envelope = await liveRunner(args);
    writeRecordedEnvelope(fixturesDir, args, envelope);
    return envelope;
  };
  const api = createUcpInternal({ mode: "live" }, captured);
  const offers = selectOffers(
    await api.searchOffers({ query: "trail running shoes", shipsTo: "US", maxPriceCents }),
    size,
    maxPriceCents,
  );
  if (offers.length !== 2) {
    throw new Error(`Expected two matching offers, received ${offers.length}`);
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
    try {
      summaries.push({ variantId: offer.variantId, ...(await api.complete(updated)) });
    } catch (error) {
      if (!(error instanceof UpstreamError)) throw error;
      summaries.push({ variantId: offer.variantId, status: "failed", continueUrl: error.continueUrl });
    }
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
    })),
  };
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
