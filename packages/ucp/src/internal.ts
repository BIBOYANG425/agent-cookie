import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { UcpError } from "./errors.js";
import type { UcpAddress, UcpApi, UcpMessage, UcpOffer, UcpRunner } from "./types.js";

type JsonRecord = Record<string, unknown>;
type Operation =
  | "catalog-search"
  | "cart-create"
  | "checkout-create"
  | "checkout-update"
  | "checkout-complete";

interface InternalOptions {
  mode?: "live" | "fixture";
  run?: UcpRunner;
  fixturesDir?: string;
  env?: NodeJS.ProcessEnv;
}

interface InternalClient {
  api: UcpApi;
  searchEnvelopes(): JsonRecord[];
}

const require = createRequire(import.meta.url);
const moduleDir = dirname(fileURLToPath(import.meta.url));
const defaultFixturesDir = resolve(moduleDir, "../../../fixtures/ucp");
const maxSearchPages = 3;
let profileInitPromise: Promise<void> | undefined;
let cachedUcpBin: string | undefined;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireEnvelope(value: unknown): JsonRecord {
  if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, "result")) {
    throw new UcpError("UCP response did not contain a result", scrubFixture(value));
  }
  if (!isRecord(value.result)) {
    throw new UcpError("UCP response result was not an object", scrubFixture(value));
  }
  return value;
}

function parseJsonEnvelope(stdout: string, stderr: string): JsonRecord {
  let envelope: unknown;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw new UcpError("UCP CLI returned invalid JSON", scrubFixture({ stdout, stderr }));
  }
  return requireEnvelope(envelope);
}

function resolveCliPackageJson(): string {
  try {
    return require.resolve("@shopify/ucp-cli/package.json");
  } catch {
    let directory = dirname(require.resolve("@shopify/ucp-cli"));
    while (true) {
      const packagePath = join(directory, "package.json");
      if (existsSync(packagePath)) {
        const metadata = JSON.parse(readFileSync(packagePath, "utf8")) as {
          name?: string;
        };
        if (metadata.name === "@shopify/ucp-cli") return packagePath;
      }
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    throw new UcpError("Unable to resolve @shopify/ucp-cli package.json");
  }
}

function resolveCliBin(): string {
  if (cachedUcpBin) return cachedUcpBin;
  const packagePath = resolveCliPackageJson();
  const metadata = JSON.parse(readFileSync(packagePath, "utf8")) as {
    bin?: string | Record<string, string>;
  };
  const relativeBin = typeof metadata.bin === "string" ? metadata.bin : metadata.bin?.ucp;
  if (!relativeBin) throw new UcpError("The UCP CLI package has no bin.ucp entry");
  cachedUcpBin = resolve(dirname(packagePath), relativeBin);
  return cachedUcpBin;
}

function execUcp(args: string[], env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolveOutput, reject) => {
    execFile(
      process.execPath,
      [resolveCliBin(), ...args],
      {
        env: { ...process.env, ...env, OPT_OUT_INSTRUMENTATION: "true" },
        timeout: 60_000,
        maxBuffer: 16 * 1024 * 1024,
        encoding: "utf8",
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new UcpError("UCP CLI process failed", scrubFixture({
            stdout,
            stderr,
            error: error.message,
          })));
          return;
        }
        resolveOutput({ stdout, stderr });
      },
    );
  });
}

export function createLiveRunner(
  env: NodeJS.ProcessEnv = process.env,
  execute: typeof execUcp = execUcp,
): UcpRunner {
  return async (args) => {
    if (!profileInitPromise) {
      profileInitPromise = (async () => {
        const { stdout, stderr } = await execute(
          ["profile", "init", "--name", "agent", "--format", "json"],
          env,
        );
        let profile: unknown;
        try {
          profile = JSON.parse(stdout);
        } catch {
          throw new UcpError(
            "UCP profile init returned invalid JSON",
            scrubFixture({ stdout, stderr }),
          );
        }
        if (!isRecord(profile) || profile.name !== "agent" || profile.code || profile.error) {
          throw new UcpError("UCP profile init failed", scrubFixture({ profile, stderr }));
        }
      })().catch((error: unknown) => {
        profileInitPromise = undefined;
        throw error;
      });
    }
    await profileInitPromise;
    const { stdout, stderr } = await execute(args, env);
    return parseJsonEnvelope(stdout, stderr);
  };
}

function fixtureBusiness(business: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(business)) {
    throw new UcpError("Invalid fixture business name", business);
  }
  return business;
}

function fixturePath(
  fixturesDir: string,
  operation: Operation,
  business: string,
  page: number,
): string {
  const name = page > 1
    ? `${operation}.p${page}.json`
    : `${operation}.${fixtureBusiness(business)}.json`;
  const specific = join(fixturesDir, name);
  if (existsSync(specific)) return specific;
  if (page === 1 && business !== "global") {
    const globalSpecific = join(fixturesDir, `${operation}.global.json`);
    if (existsSync(globalSpecific)) return globalSpecific;
  }
  return join(fixturesDir, `${operation}.json`);
}

function readFixture(
  fixturesDir: string,
  operation: Operation,
  business: string,
  page: number,
): JsonRecord {
  const path = fixturePath(fixturesDir, operation, business, page);
  try {
    return JSON.parse(readFileSync(path, "utf8")) as JsonRecord;
  } catch (error) {
    throw new UcpError("Unable to read UCP fixture", { path, error });
  }
}

function record(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function valueAt(object: JsonRecord | undefined, ...keys: string[]): unknown {
  if (!object) return undefined;
  for (const key of keys) {
    if (object[key] !== undefined && object[key] !== null) return object[key];
  }
  return undefined;
}

function messagesFrom(value: unknown): UcpMessage[] {
  const source = record(value);
  const result = record(source?.result);
  const messages = valueAt(result, "messages") ?? valueAt(source, "messages");
  return Array.isArray(messages) ? messages as UcpMessage[] : [];
}

function continueUrlFrom(value: unknown): string | undefined {
  const source = record(value);
  const result = record(source?.result) ?? source;
  const checkout = record(result?.checkout);
  return stringValue(valueAt(result, "continue_url", "continueUrl", "checkout_url"))
    ?? stringValue(valueAt(checkout, "continue_url", "continueUrl", "url"));
}

function isBareOrigin(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.pathname === "/" && parsed.search === "";
  } catch {
    return false;
  }
}

function preferredContinueUrl(
  candidate: string | undefined,
  cached: string | undefined,
): string | undefined {
  return candidate && !isBareOrigin(candidate) ? candidate : cached;
}

function parsePossibleJson(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const stdout = value.stdout;
  if (typeof stdout === "string") {
    try {
      return JSON.parse(stdout);
    } catch {
      return value;
    }
  }
  return value;
}

function messagesFromFailure(error: unknown): UcpMessage[] {
  const response = error instanceof UcpError ? parsePossibleJson(error.detail) : undefined;
  const messages = messagesFrom(response);
  const envelope = record(response);
  if (
    envelope
    && !Object.prototype.hasOwnProperty.call(envelope, "result")
    && stringValue(envelope.code)
    && stringValue(envelope.message)
  ) {
    return [
      ...messages,
      {
        type: "error",
        code: envelope.code as string,
        content: envelope.message as string,
      },
    ];
  }
  const errorMessage = error instanceof UcpError
    && error.message === "UCP request failed"
    && error.detail instanceof Error
    ? error.detail.message
    : error instanceof Error ? error.message : "UCP request failed";
  return [
    ...messages,
    { type: "error", code: "UPSTREAM_ERROR", content: errorMessage },
  ];
}

function continueUrlFromFailure(error: unknown): string | undefined {
  if (error instanceof UcpError) {
    return continueUrlFrom(parsePossibleJson(error.detail));
  }
  return undefined;
}

function numericBudget(budget: number | string | null | undefined): number | undefined {
  if (budget === undefined || budget === null) return undefined;
  const parsed = typeof budget === "number" ? budget : Number(budget);
  if (!Number.isFinite(parsed)) throw new UcpError("Budget must be a finite number", budget);
  return Math.round(parsed * 100);
}

function parseSizeToken(token: string): { number: number; region: string } | undefined {
  const match = /^(?:(US|EU|UK)\s*)?(\d+(?:\.\d+)?)(?:\s*(US|EU|UK))?$/i.exec(token.trim());
  if (!match) return undefined;
  const prefix = match[1]?.toLowerCase();
  const suffix = match[3]?.toLowerCase();
  if (prefix && suffix && prefix !== suffix) return undefined;
  const number = Number(match[2]);
  return { number, region: prefix ?? suffix ?? (number >= 30 ? "eu" : "us") };
}

function matchesSize(label: string, requestedSize: string): boolean {
  const requested = requestedSize.split(/[\/,]/).map(parseSizeToken).filter(Boolean);
  if (requested.length === 0) return false;
  return label.split(/[\/,]/).some((part) => {
    const parsed = parseSizeToken(part);
    return parsed !== undefined && requested.some((size) =>
      size!.number === parsed.number && size!.region === parsed.region
    );
  });
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function findEtaDate(variant: JsonRecord): string | null {
  const direct = [
    variant.eta_date,
    variant.etaDate,
    variant.delivery_date,
    variant.deliveryDate,
    variant.estimated_delivery_date,
    variant.estimatedDeliveryDate,
    variant.delivery_estimate_date,
    variant.deliveryEstimateDate,
  ];
  for (const value of direct) {
    if (isDate(value)) return value;
  }
  for (const key of ["delivery_estimate", "deliveryEstimate", "delivery", "eta"]) {
    const estimate = record(variant[key]);
    if (!estimate) continue;
    for (const [name, value] of Object.entries(estimate)) {
      if (/date|eta|delivery/i.test(name) && isDate(value)) return value;
    }
  }
  return null;
}

function etaTextFrom(variant: JsonRecord): string | undefined {
  const direct = stringValue(valueAt(
    variant,
    "eta_text",
    "etaText",
    "delivery_estimate_text",
    "deliveryEstimateText",
  ));
  if (direct) return direct;
  const estimate = record(valueAt(variant, "delivery_estimate", "deliveryEstimate"));
  return stringValue(valueAt(estimate, "text", "description"));
}

function searchInput(
  input: { shoe_size: string; budget?: number | string | null },
  cursor?: string,
): JsonRecord {
  const max = numericBudget(input.budget);
  const filters: JsonRecord = { available: true, ships_to: { country: "US" } };
  if (max !== undefined) filters.price = { max };
  return {
    query: "trail running shoes",
    context: { address_country: "US", currency: "USD" },
    filters,
    pagination: {
      ...(cursor ? { cursor } : {}),
      limit: 50,
    },
  };
}

function buildOffers(
  envelope: JsonRecord,
  requestedSize: string,
  maxPrice: number | undefined,
  deadline: string | null | undefined,
  selectedSellers: Set<string>,
): UcpOffer[] {
  const result = record(envelope.result);
  const products = Array.isArray(result?.products) ? result.products : [];
  const offers: UcpOffer[] = [];
  const deadlineTime = deadline ? Date.parse(deadline) : Number.NaN;
  for (const productValue of products) {
    const product = record(productValue);
    if (!product || !Array.isArray(product.variants)) continue;
    for (const variantValue of product.variants) {
      const variant = record(variantValue);
      if (!variant) continue;
      const price = record(variant.price);
      const availability = record(variant.availability);
      const seller = record(variant.seller);
      const sellerDomain = stringValue(seller?.domain);
      const productId = stringValue(product.id);
      const variantId = stringValue(variant.id);
      const amount = price?.amount;
      if (
        price?.currency !== "USD"
        || availability?.available !== true
        || typeof amount !== "number"
        || (maxPrice !== undefined && amount > maxPrice)
        || !sellerDomain
        || !productId
        || !variantId
        || selectedSellers.has(sellerDomain)
      ) continue;
      // Shipping is only provided by the catalog request filter, not per variant.
      const options = Array.isArray(variant.options) ? variant.options : [];
      const matchedOption = options.map(record).find((option) =>
        typeof option?.name === "string"
        && /size/i.test(option.name)
        && typeof option.label === "string"
        && matchesSize(option.label, requestedSize)
      );
      if (!matchedOption || typeof matchedOption.label !== "string") continue;
      const etaDate = findEtaDate(variant);
      if (etaDate && Number.isFinite(deadlineTime) && Date.parse(etaDate) > deadlineTime) continue;
      selectedSellers.add(sellerDomain);
      offers.push({
        variantId,
        productId,
        title: stringValue(variant.title) ?? stringValue(product.title) ?? "",
        seller: sellerDomain,
        ...(stringValue(seller?.name) ? { sellerName: stringValue(seller?.name) } : {}),
        ...(stringValue(seller?.url) ? { sellerUrl: stringValue(seller?.url) } : {}),
        price: amount,
        currency: "USD",
        size: matchedOption.label,
        etaDate,
        ...(etaTextFrom(variant) ? { etaText: etaTextFrom(variant) } : {}),
        ...(stringValue(variant.url) ? { url: stringValue(variant.url) } : {}),
        ...(stringValue(variant.checkout_url)
          ? { checkoutUrl: stringValue(variant.checkout_url) }
          : {}),
      });
      break;
    }
  }
  return offers;
}

function extractResourceId(result: JsonRecord, kind: "cart" | "checkout"): string {
  const plural = record(result[kind]);
  const direct = stringValue(valueAt(result, `${kind}_id`, `${kind}Id`))
    ?? stringValue(valueAt(plural, "id"))
    ?? stringValue(result[kind]);
  const id = direct ?? stringValue(result.id);
  if (!id) throw new UcpError(`UCP ${kind} response did not contain an id`, result);
  return id;
}

function checkoutMethods(result: JsonRecord): JsonRecord[] {
  const checkout = record(result.checkout);
  const fulfillment = record(result.fulfillment) ?? record(checkout?.fulfillment);
  const methods = valueAt(fulfillment, "methods")
    ?? valueAt(result, "fulfillment_methods")
    ?? valueAt(checkout, "fulfillment_methods");
  return Array.isArray(methods) ? methods.map(record).filter((item): item is JsonRecord => Boolean(item)) : [];
}

function destinationPayload(
  email: string,
  address: UcpAddress,
  checkout: JsonRecord,
): JsonRecord {
  const methods = checkoutMethods(checkout);
  const selected = methods.find((method) => method.type === "shipping") ?? methods[0];
  const lineItems = Array.isArray(checkout.line_items) ? checkout.line_items : [];
  const lineItemIds = Array.isArray(selected?.line_item_ids)
    ? selected.line_item_ids
    : lineItems.map(record).map((item) => stringValue(item?.id)).filter(Boolean);
  const shippingMethod: JsonRecord = {
    type: "shipping",
    ...(stringValue(selected?.id) ? { id: selected.id } : {}),
    line_item_ids: lineItemIds,
    destinations: [{
      first_name: address.firstName,
      last_name: address.lastName,
      street_address: address.streetAddress,
      ...(address.extendedAddress ? { extended_address: address.extendedAddress } : {}),
      address_locality: address.locality,
      address_region: address.region,
      postal_code: address.postalCode,
      address_country: address.country,
      ...(address.phoneNumber ? { phone_number: address.phoneNumber } : {}),
    }],
  };
  return { line_items: lineItems, buyer: { email }, fulfillment: { methods: [shippingMethod] } };
}

function orderIdFrom(result: JsonRecord): string | undefined {
  const order = record(result.order);
  return stringValue(valueAt(result, "order_id", "orderId"))
    ?? stringValue(valueAt(order, "id", "order_id", "orderId"));
}

function operationArgs(args: string[]): { operation: Operation; business: string } {
  const operation = `${args[0]}-${args[1]}` as Operation;
  let business = "global";
  for (let index = 0; index < args.length - 1; index += 1) {
    if (args[index] === "--business") business = args[index + 1]!;
  }
  return { operation, business };
}

export function createUcpInternal(options: InternalOptions = {}): InternalClient {
  const env = options.env ?? process.env;
  const mode = options.mode ?? (env.AGENT_COOKIE_UCP === "fixture" ? "fixture" : "live");
  const fixturesDir = resolve(
    options.fixturesDir ?? env.AGENT_COOKIE_UCP_FIXTURES ?? defaultFixturesDir,
  );
  const runner = mode === "live"
    ? options.run ?? createLiveRunner(env)
    : undefined;
  const checkoutMetadata = new Map<string, JsonRecord>();
  const checkoutContinueUrls = new Map<string, string>();
  const cartMetadata = new Map<string, JsonRecord>();
  const searchResults: JsonRecord[] = [];

  async function call(
    operation: Operation,
    business: string,
    args: string[],
    page = 1,
  ): Promise<JsonRecord> {
    let envelope: unknown;
    try {
      envelope = mode === "fixture"
        ? readFixture(fixturesDir, operation, business, page)
        : await runner!(args);
      return requireEnvelope(envelope);
    } catch (error) {
      if (error instanceof UcpError) throw error;
      throw new UcpError("UCP request failed", error);
    }
  }

  const api: UcpApi = {
    async searchOffers({ shoe_size, budget, deadline }) {
      const maxPrice = numericBudget(budget);
      const selectedSellers = new Set<string>();
      const offers: UcpOffer[] = [];
      let cursor: string | undefined;
      for (let page = 1; page <= maxSearchPages; page += 1) {
        const input = searchInput({ shoe_size, budget }, cursor);
        const args = [
          "catalog",
          "search",
          "--input",
          JSON.stringify(input),
          "--profile",
          "agent",
          "--format",
          "json",
        ];
        const envelope = await call("catalog-search", "global", args, page);
        searchResults.push(envelope);
        offers.push(...buildOffers(envelope, shoe_size, maxPrice, deadline, selectedSellers));
        if (offers.length >= 2) break;
        const pagination = record(record(envelope.result)?.pagination);
        cursor = stringValue(pagination?.cursor);
        if (!cursor || pagination?.has_next_page === false) break;
      }
      return offers.slice(0, 2);
    },

    async createCart({ seller, variantId, quantity = 1 }) {
      const args = [
        "cart",
        "create",
        "--business",
        seller,
        "--input",
        JSON.stringify({ line_items: [{ item: { id: variantId }, quantity }] }),
        "--profile",
        "agent",
        "--format",
        "json",
      ];
      const envelope = await call("cart-create", seller, args);
      const result = record(envelope.result)!;
      const cartId = extractResourceId(result, "cart");
      cartMetadata.set(cartId, result);
      return { cartId, messages: messagesFrom(result) };
    },

    async createCheckout({ seller, cartId }) {
      const args = [
        "checkout",
        "create",
        "--business",
        seller,
        "--input",
        JSON.stringify({
          cart_id: cartId,
          ...(Array.isArray(cartMetadata.get(cartId)?.line_items)
            ? { line_items: cartMetadata.get(cartId)!.line_items }
            : {}),
        }),
        "--profile",
        "agent",
        "--format",
        "json",
      ];
      const envelope = await call("checkout-create", seller, args);
      const result = record(envelope.result)!;
      const checkoutId = extractResourceId(result, "checkout");
      checkoutMetadata.set(checkoutId, result);
      const continueUrl = continueUrlFrom(result);
      if (continueUrl) checkoutContinueUrls.set(checkoutId, continueUrl);
      return {
        checkoutId,
        ...(continueUrl ? { continueUrl } : {}),
        messages: messagesFrom(result),
      };
    },

    async setDestination({ seller, checkoutId, email, address }) {
      const payload = destinationPayload(email, address, checkoutMetadata.get(checkoutId) ?? {});
      const args = [
        "checkout",
        "update",
        checkoutId,
        "--business",
        seller,
        "--input",
        JSON.stringify(payload),
        "--profile",
        "agent",
        "--format",
        "json",
      ];
      const envelope = await call("checkout-update", seller, args);
      const result = record(envelope.result)!;
      const responseUrl = continueUrlFrom(result);
      if (responseUrl && !isBareOrigin(responseUrl)) {
        checkoutContinueUrls.set(checkoutId, responseUrl);
      }
      const continueUrl = preferredContinueUrl(
        responseUrl,
        checkoutContinueUrls.get(checkoutId),
      );
      return {
        ...(continueUrl ? { continueUrl } : {}),
        messages: messagesFrom(result),
      };
    },

    async complete({ seller, checkoutId }) {
      try {
        const args = [
          "checkout",
          "complete",
          checkoutId,
          "--business",
          seller,
          "--input",
          JSON.stringify({ payment: {} }),
          "--profile",
          "agent",
          "--format",
          "json",
        ];
        const envelope = await call("checkout-complete", seller, args);
        const result = record(envelope.result)!;
        const status = stringValue(valueAt(result, "status"))
          ?? stringValue(valueAt(record(result.checkout), "status"));
        const continueUrl = preferredContinueUrl(
          continueUrlFrom(result),
          checkoutContinueUrls.get(checkoutId),
        );
        const messages = messagesFrom(result);
        if (status === "completed") {
          return {
            status: "ordered",
            ...(orderIdFrom(result) ? { orderId: orderIdFrom(result) } : {}),
            messages,
          };
        }
        if (status === "requires_escalation" && continueUrl) {
          return { status: "handoff", continueUrl, messages };
        }
        return {
          status: "failed",
          ...(continueUrl ? { continueUrl } : {}),
          messages,
        };
      } catch (error) {
        const continueUrl = preferredContinueUrl(
          continueUrlFromFailure(error),
          checkoutContinueUrls.get(checkoutId),
        );
        return {
          status: "failed",
          ...(continueUrl ? { continueUrl } : {}),
          messages: messagesFromFailure(error),
        };
      }
    },
  };

  return {
    api,
    searchEnvelopes: () => [...searchResults],
  };
}

export function scrubFixture(value: unknown, key = ""): unknown {
  if (/(?:authorization|access[_-]?token|refresh[_-]?token|api[_-]?key|secret|password|cookie|bearer|^key$)/i.test(key)) {
    return "[REDACTED]";
  }
  if (typeof value === "string") {
    return value.replace(/([?&](?:_gsid|access_token|auth_token|token|key)=)[^&#\s]+/gi, "$1REDACTED");
  }
  if (Array.isArray(value)) return value.map((item) => scrubFixture(item));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, item]) => [childKey, scrubFixture(item, childKey)]),
    );
  }
  return value;
}

export function writeRecordedEnvelope(
  fixturesDir: string,
  args: string[],
  envelope: unknown,
  searchPage: number,
): void {
  const { operation, business } = operationArgs(args);
  const file = operation === "catalog-search"
    ? searchPage === 1 ? "catalog-search.global.json" : `catalog-search.p${searchPage}.json`
    : `${operation}.${fixtureBusiness(business)}.json`;
  mkdirSync(fixturesDir, { recursive: true });
  writeFileSync(
    join(fixturesDir, file),
    `${JSON.stringify(scrubFixture(envelope), null, 2)}\n`,
    { mode: 0o644 },
  );
}

export function nativeCheckoutByVariant(envelopes: JsonRecord[]): Map<string, boolean> {
  const eligibility = new Map<string, boolean>();
  for (const envelope of envelopes) {
    const products = record(envelope.result)?.products;
    if (!Array.isArray(products)) continue;
    for (const productValue of products) {
      const variants = record(productValue)?.variants;
      if (!Array.isArray(variants)) continue;
      for (const variantValue of variants) {
        const variant = record(variantValue);
        const id = stringValue(variant?.id);
        if (id) eligibility.set(id, record(variant?.eligible)?.native_checkout === true);
      }
    }
  }
  return eligibility;
}

export { type JsonRecord };
