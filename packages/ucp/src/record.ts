import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createLiveRunner,
  createUcpInternal,
  nativeCheckoutByVariant,
  scrubFixture,
  writeRecordedEnvelope,
} from "./internal.js";
import { UcpError } from "./errors.js";
import type { UcpRunner } from "./types.js";

const defaultSize = "9";
const defaultBudget = 200;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const fixturesDir = join(repositoryRoot, "fixtures", "ucp");
const destination = {
  firstName: "Agent Cookie",
  lastName: "Demo",
  streetAddress: "1 Ferry Building",
  extendedAddress: "Ferry Building",
  locality: "San Francisco",
  region: "CA",
  postalCode: "94111",
  country: "US" as const,
};

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

async function record(): Promise<void> {
  const { size, budget } = recordingOptions(process.argv.slice(2));
  mkdirSync(fixturesDir, { recursive: true });
  let searchPage = 0;
  const liveRunner = createLiveRunner();
  const captured: UcpRunner = async (args) => {
    try {
      const envelope = await liveRunner(args);
      if (args[0] === "catalog" && args[1] === "search") searchPage += 1;
      writeRecordedEnvelope(fixturesDir, args, envelope, searchPage);
      return envelope;
    } catch (error) {
      if (error instanceof UcpError && error.detail !== undefined) {
        const detail = error.detail as { stdout?: unknown };
        if (typeof detail.stdout === "string") {
          try {
            writeRecordedEnvelope(fixturesDir, args, JSON.parse(detail.stdout), searchPage);
          } catch {
            console.error(JSON.stringify(scrubFixture(error.detail), null, 2));
          }
        } else {
          console.error(JSON.stringify(scrubFixture(error.detail), null, 2));
        }
      }
      throw error;
    }
  };
  const client = createUcpInternal({ mode: "live", run: captured });
  const offers = await client.api.searchOffers({ shoe_size: size, budget });
  if (offers.length !== 2) {
    throw new Error(`Expected two matching offers, received ${offers.length}`);
  }
  const nativeCheckout = nativeCheckoutByVariant(client.searchEnvelopes());

  const summaries = [];
  for (const offer of offers) {
    const cart = await client.api.createCart({
      seller: offer.seller,
      variantId: offer.variantId,
    });
    const checkout = await client.api.createCheckout({
      seller: offer.seller,
      cartId: cart.cartId,
    });
    await client.api.setDestination({
      seller: offer.seller,
      checkoutId: checkout.checkoutId,
      email: "demo@agent-cookie.dev",
      address: destination,
    });
    if (nativeCheckout.get(offer.variantId) === true) {
      summaries.push({
        variantId: offer.variantId,
        status: "skipped-native-checkout",
        messages: [],
      });
      continue;
    }
    const result = await client.api.complete({
      seller: offer.seller,
      checkoutId: checkout.checkoutId,
    });
    summaries.push({ variantId: offer.variantId, ...result });
  }

  const pinned = {
    recordedAt: new Date().toISOString(),
    size,
    budget,
    offers: offers.map(({ variantId, seller, title, price, size: matchedSize }) => ({
      variantId,
      seller,
      title,
      price,
      size: matchedSize,
    })),
  };
  writeFileSync(join(fixturesDir, "pinned.json"), `${JSON.stringify(pinned, null, 2)}\n`, {
    mode: 0o644,
  });
  console.log(JSON.stringify({ pinned, complete: summaries }, null, 2));
}

void record().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  if (error instanceof UcpError && error.detail !== undefined) {
    console.error(JSON.stringify(scrubFixture(error.detail), null, 2));
  }
  process.exitCode = 1;
});
