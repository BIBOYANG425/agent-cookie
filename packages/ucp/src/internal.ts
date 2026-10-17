import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { UpstreamError } from "@agent-cookie/contract";
import type {
  UcpApi,
  UcpCart,
  UcpCheckout,
  UcpDestination,
  UcpMessage,
  UcpOffer,
  UcpOptions,
} from "@agent-cookie/contract";

type JsonRecord = Record<string, unknown>;
type Operation =
  | "catalog-search"
  | "cart-create"
  | "checkout-create"
  | "checkout-update"
  | "checkout-complete";

export type UcpRunner = (args: string[]) => Promise<unknown>;

type ExecResult = { stdout: string; stderr: string };
class InvalidJsonResponseError extends Error {}
class FixtureReadError extends Error {}

export type UcpExecutor = (
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  bin?: string,
) => Promise<ExecResult>;

const require = createRequire(import.meta.url);
const moduleDir = dirname(fileURLToPath(import.meta.url));
const defaultFixturesDir = resolve(moduleDir, "../../../fixtures/ucp");
let profileInitPromise: Promise<void> | undefined;
let cachedUcpBin: string | undefined;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function setProcessOutput(error: Error, stdout: string, stderr: string): Error {
  Object.assign(error, { stdout, stderr });
  return error;
}

function resolveCliPackageJson(): string {
  try {
    return require.resolve("@shopify/ucp-cli/package.json");
  } catch {
    let directory = dirname(require.resolve("@shopify/ucp-cli"));
    while (true) {
      const packagePath = join(directory, "package.json");
      if (existsSync(packagePath)) {
        const metadata = JSON.parse(readFileSync(packagePath, "utf8")) as { name?: string };
        if (metadata.name === "@shopify/ucp-cli") return packagePath;
      }
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    throw new Error("Unable to resolve @shopify/ucp-cli package.json");
  }
}

function resolveCliBin(): string {
  if (cachedUcpBin) return cachedUcpBin;
  const packagePath = resolveCliPackageJson();
  const metadata = JSON.parse(readFileSync(packagePath, "utf8")) as {
    bin?: string | Record<string, string>;
  };
  const relativeBin = typeof metadata.bin === "string" ? metadata.bin : metadata.bin?.ucp;
  if (!relativeBin) throw new Error("The UCP CLI package has no bin.ucp entry");
  cachedUcpBin = resolve(dirname(packagePath), relativeBin);
  return cachedUcpBin;
}

const execUcp: UcpExecutor = (args, env, timeoutMs, bin) =>
  new Promise((resolveOutput, reject) => {
    const command = bin ?? process.execPath;
    const commandArgs = bin ? args : [resolveCliBin(), ...args];
    execFile(command, commandArgs, {
      env: { ...process.env, ...env, OPT_OUT_INSTRUMENTATION: "true" },
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      encoding: "utf8",
    }, (error, stdout, stderr) => {
      if (error) {
        reject(setProcessOutput(error, stdout, stderr));
        return;
      }
      resolveOutput({ stdout, stderr });
    });
  });

function parseJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    throw new InvalidJsonResponseError("invalid JSON response");
  }
}

export function createLiveRunner(
  env: NodeJS.ProcessEnv = process.env,
  options: { timeoutMs?: number; bin?: string; execute?: UcpExecutor } = {},
): UcpRunner {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const execute = options.execute ?? execUcp;
  return async (args) => {
    if (!profileInitPromise) {
      profileInitPromise = (async () => {
        const { stdout } = await execute(
          ["profile", "init", "--name", "agent", "--format", "json"],
          env,
          timeoutMs,
          options.bin,
        );
        const profile = parseJson(stdout);
        if (!isRecord(profile) || profile.name !== "agent" || profile.code || profile.error) {
          throw new Error("ucp profile init failed");
        }
      })().catch((error: unknown) => {
        profileInitPromise = undefined;
        throw error;
      });
    }
    await profileInitPromise;
    try {
      const { stdout } = await execute(args, env, timeoutMs, options.bin);
      return parseJson(stdout);
    } catch (error) {
      const response = responseFromError(error);
      if (isErrorEnvelope(response)) return response;
      throw error;
    }
  };
}

function fixtureBusiness(business: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(business)) throw new Error("Invalid fixture business name");
  return business;
}

function fixturePath(fixturesDir: string, operation: Operation, business: string): string {
  const specific = join(fixturesDir, `${operation}.${fixtureBusiness(business)}.json`);
  if (existsSync(specific)) return specific;
  if (business !== "global") {
    const global = join(fixturesDir, `${operation}.global.json`);
    if (existsSync(global)) return global;
  }
  const generic = join(fixturesDir, `${operation}.json`);
  return existsSync(generic) ? generic : specific;
}

function readFixture(fixturesDir: string, operation: Operation, business: string): unknown {
  const path = fixturePath(fixturesDir, operation, business);
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    const filename = basename(path);
    const code = record(error)?.code;
    if (code === "ENOENT") {
      throw new FixtureReadError(`ucp ${operation}: fixture ${filename} missing`);
    }
    if (error instanceof SyntaxError) {
      throw new FixtureReadError(`ucp ${operation}: fixture ${filename} invalid JSON`);
    }
    throw new FixtureReadError(`ucp ${operation}: ${safeFailureCode(error)}`);
  }
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

function preferredContinueUrl(candidate: string | undefined, fallback: string | undefined): string | undefined {
  return candidate && !isBareOrigin(candidate) ? candidate : fallback;
}

function responseFromError(error: unknown): unknown {
  const stdout = record(error)?.stdout;
  if (typeof stdout !== "string") return undefined;
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    return undefined;
  }
}

function isErrorEnvelope(value: unknown): value is JsonRecord {
  const envelope = record(value);
  return Boolean(
    envelope
    && !Object.prototype.hasOwnProperty.call(envelope, "result")
    && stringValue(envelope.code)
    && stringValue(envelope.message)
  );
}

function safeFailureCode(error: unknown): string {
  if (error instanceof InvalidJsonResponseError) return "invalid JSON response";
  const code = record(error)?.code;
  if (typeof code === "string" && /^[A-Z][A-Z0-9_]*$/.test(code)) return code;
  if (typeof code === "number" && Number.isSafeInteger(code)) return `process exited ${code}`;
  return "failed";
}

function upstreamFailure(operation: Operation, error: unknown, fallback?: string): UpstreamError {
  const response = responseFromError(error);
  if (isErrorEnvelope(response)) {
    const envelope = response;
    return new UpstreamError(
      `ucp ${operation}: ${envelope.code}: ${envelope.message}`,
      preferredContinueUrl(continueUrlFrom(envelope), fallback),
    );
  }
  return new UpstreamError(
    `ucp ${operation}: ${safeFailureCode(error)}`,
    preferredContinueUrl(continueUrlFrom(response), fallback),
  );
}

function responseEnvelope(
  value: unknown,
  operation: Operation,
  fallback?: string,
  handoffInsufficientPermissions = false,
): JsonRecord {
  const envelope = record(value);
  if (!envelope || !Object.prototype.hasOwnProperty.call(envelope, "result")) {
    if (
      envelope
      && stringValue(envelope.code)
      && stringValue(envelope.message)
    ) {
      const code = stringValue(envelope.code)!;
      const message = stringValue(envelope.message)!;
      const continueUrl = preferredContinueUrl(continueUrlFrom(envelope), fallback);
      if (handoffInsufficientPermissions && code === "INSUFFICIENT_PERMISSIONS") {
        return {
          ...envelope,
          result: {
            status: "requires_escalation",
            ...(continueUrl ? { continue_url: continueUrl } : {}),
            messages: [
              ...messagesFrom(envelope),
              {
                type: "error",
                code,
                content: message,
                severity: "requires_buyer_input",
              },
            ],
          },
        };
      }
      throw new UpstreamError(
        `ucp ${operation}: ${code}: ${message}`,
        continueUrl,
      );
    }
    throw new UpstreamError(
      `ucp ${operation}: failed`,
      preferredContinueUrl(continueUrlFrom(envelope), fallback),
    );
  }
  if (!isRecord(envelope.result)) {
    throw new UpstreamError(
      `ucp ${operation}: failed`,
      preferredContinueUrl(continueUrlFrom(envelope), fallback),
    );
  }
  return envelope;
}

function callArgs(operation: string[]): string[] {
  return [...operation, "--profile", "agent", "--format", "json"];
}

function extractResourceId(result: JsonRecord, kind: "cart" | "checkout"): string | undefined {
  const nested = record(result[kind]);
  const direct = stringValue(valueAt(result, `${kind}_id`, `${kind}Id`))
    ?? stringValue(valueAt(nested, "id"))
    ?? stringValue(result[kind]);
  return direct ?? stringValue(result.id);
}

function checkoutMethods(result: JsonRecord): JsonRecord[] {
  const checkout = record(result.checkout);
  const fulfillment = record(result.fulfillment) ?? record(checkout?.fulfillment);
  const methods = valueAt(fulfillment, "methods")
    ?? valueAt(result, "fulfillment_methods")
    ?? valueAt(checkout, "fulfillment_methods");
  return Array.isArray(methods)
    ? methods.map(record).filter((item): item is JsonRecord => Boolean(item))
    : [];
}

function destinationPayload(
  address: UcpDestination,
  checkout: JsonRecord,
  email?: string,
): JsonRecord {
  const methods = checkoutMethods(checkout);
  const selected = methods.find((method) => method.type === "shipping") ?? methods[0];
  const lineItems = Array.isArray(checkout.line_items) ? checkout.line_items : [];
  const lineItemIds = Array.isArray(selected?.line_item_ids)
    ? selected.line_item_ids
    : lineItems.map(record).map((item) => stringValue(item?.id)).filter(Boolean);
  const destination: JsonRecord = {
    street_address: address.line1,
    ...(address.line2 ? { extended_address: address.line2 } : {}),
    address_locality: address.city,
    address_region: address.region,
    postal_code: address.postalCode,
    address_country: address.country,
  };
  const name = address.name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (name.length > 0) {
    destination.first_name = name[0];
    destination.last_name = name.slice(1).join(" ") || name[0];
  }
  return {
    line_items: lineItems,
    ...(email ? { buyer: { email } } : {}),
    fulfillment: {
      methods: [{
        type: "shipping",
        ...(stringValue(selected?.id) ? { id: selected.id } : {}),
        line_item_ids: lineItemIds,
        destinations: [destination],
      }],
    },
  };
}

function orderIdFrom(result: JsonRecord): string | undefined {
  const order = record(result.order);
  return stringValue(valueAt(result, "order_id", "orderId"))
    ?? stringValue(valueAt(order, "id", "order_id", "orderId"));
}

function statusFrom(result: JsonRecord): UcpCheckout["status"] {
  const raw = valueAt(result, "status") ?? valueAt(record(result.checkout), "status");
  return raw as UcpCheckout["status"];
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
    if (typeof value === "string" && value.trim() && Number.isFinite(Date.parse(value))) return value;
  }
  for (const key of ["delivery_estimate", "deliveryEstimate", "delivery", "eta"]) {
    const estimate = record(variant[key]);
    if (!estimate) continue;
    for (const [name, value] of Object.entries(estimate)) {
      if (/date|eta|delivery/i.test(name) && typeof value === "string" && Number.isFinite(Date.parse(value))) {
        return value;
      }
    }
  }
  return null;
}

function normalizeOffers(envelope: JsonRecord, shipsTo: string): UcpOffer[] {
  const products = Array.isArray(record(envelope.result)?.products)
    ? record(envelope.result)!.products as unknown[]
    : [];
  const offers: UcpOffer[] = [];
  for (const productValue of products) {
    const product = record(productValue);
    if (!product || !Array.isArray(product.variants)) continue;
    for (const variantValue of product.variants) {
      const variant = record(variantValue);
      if (!variant) continue;
      const variantId = stringValue(variant.id);
      const seller = record(variant.seller);
      const sellerDomain = stringValue(seller?.domain);
      if (!variantId || !sellerDomain) continue;
      const price = record(variant.price);
      const priceCents = price?.amount;
      if (typeof priceCents !== "number" || !Number.isSafeInteger(priceCents) || priceCents < 0) continue;
      const availability = record(variant.availability);
      const currency = stringValue(price?.currency) ?? "";
      if (currency !== "USD" || availability?.available !== true) continue;
      const options = Array.isArray(variant.options) ? variant.options : [];
      offers.push({
        sellerDomain,
        sellerName: stringValue(seller?.name) ?? "",
        productTitle: stringValue(product.title) ?? "",
        variantId,
        variantTitle: stringValue(variant.title) ?? "",
        priceCents,
        currency,
        available: true,
        // UCP catalog responses have no per-variant shipping field; this reflects the request filter.
        shipsTo: [shipsTo],
        sizeOptions: options.flatMap((value) => {
          const option = record(value);
          return typeof option?.name === "string"
            && /size/i.test(option.name)
            && typeof option.label === "string"
            ? [option.label]
            : [];
        }),
        colorOptions: options.flatMap((value) => {
          const option = record(value);
          return typeof option?.name === "string"
            && /colou?r/i.test(option.name)
            && typeof option.label === "string"
            ? [option.label]
            : [];
        }),
        nativeCheckout: record(variant.eligible)?.native_checkout === true,
        etaDate: findEtaDate(variant),
        ...(stringValue(variant.checkout_url) ? { checkoutUrl: stringValue(variant.checkout_url) } : {}),
        ...(stringValue(variant.url) ? { url: stringValue(variant.url) } : {}),
      });
    }
  }
  return offers;
}

function operationBusiness(args: string[]): { operation: Operation; business: string } {
  const operation = `${args[0]}-${args[1]}` as Operation;
  let business = "global";
  for (let index = 0; index < args.length - 1; index += 1) {
    if (args[index] === "--business") business = args[index + 1]!;
  }
  return { operation, business };
}

export function createUcpInternal(options: UcpOptions, injectedRunner?: UcpRunner): UcpApi {
  const env = process.env;
  const mode = options.mode;
  const fixturesDir = resolve(
    options.fixturesDir ?? env.AGENT_COOKIE_UCP_FIXTURES ?? defaultFixturesDir,
  );
  const runner = mode === "live"
    ? injectedRunner ?? createLiveRunner(env, { timeoutMs: options.timeoutMs, bin: options.bin })
    : undefined;
  const cartMetadata = new Map<string, JsonRecord>();
  const checkoutMetadata = new Map<string, JsonRecord>();
  const checkoutContinueUrls = new Map<string, string>();

  async function call(
    operation: Operation,
    business: string,
    args: string[],
    fallback?: string,
    handoffInsufficientPermissions = false,
  ): Promise<JsonRecord> {
    let response: unknown;
    try {
      response = mode === "fixture"
        ? readFixture(fixturesDir, operation, business)
        : await runner!(args);
    } catch (error) {
      if (error instanceof FixtureReadError) {
        throw new UpstreamError(error.message, fallback);
      }
      throw upstreamFailure(operation, error, fallback);
    }
    return responseEnvelope(response, operation, fallback, handoffInsufficientPermissions);
  }

  const api: UcpApi = {
    async searchOffers(query) {
      const baseIntent = query.intentText ?? query.query;
      const intentParts = [baseIntent];
      const signals = [
        query.size && !baseIntent.toLowerCase().includes(query.size.toLowerCase()) ? `size: ${query.size}` : undefined,
        query.color && !baseIntent.toLowerCase().includes(query.color.toLowerCase()) ? `color: ${query.color}` : undefined,
      ].filter((signal): signal is string => Boolean(signal));
      if (signals.length > 0) intentParts.push(`(${signals.join(", ")})`);
      const input = {
        query: query.query,
        context: {
          address_country: query.shipsTo,
          currency: "USD",
          intent: intentParts.join(" "),
        },
        filters: {
          available: true,
          ships_to: { country: query.shipsTo },
          ...(query.maxPriceCents != null ? { price: { max: query.maxPriceCents } } : {}),
        },
        pagination: { limit: query.limit ?? 50 },
      };
      const envelope = await call(
        "catalog-search",
        "global",
        callArgs(["catalog", "search", "--input", JSON.stringify(input)]),
      );
      return normalizeOffers(envelope, query.shipsTo);
    },

    async createCart(offer, quantity = 1) {
      const args = callArgs([
        "cart",
        "create",
        "--business",
        offer.sellerDomain,
        "--input",
        JSON.stringify({ line_items: [{ item: { id: offer.variantId }, quantity }] }),
      ]);
      const envelope = await call("cart-create", offer.sellerDomain, args);
      const result = record(envelope.result)!;
      const cartId = extractResourceId(result, "cart");
      if (!cartId) throw new UpstreamError("ucp cart-create: failed");
      cartMetadata.set(cartId, result);
      const continueUrl = continueUrlFrom(result);
      const cart: UcpCart = {
        cartId,
        sellerDomain: offer.sellerDomain,
        ...(continueUrl ? { continueUrl } : {}),
        messages: messagesFrom(result),
      };
      return cart;
    },

    async createCheckout(cart) {
      const fallback = cart.continueUrl;
      const cartResult = cartMetadata.get(cart.cartId);
      const lineItems = Array.isArray(cartResult?.line_items) ? cartResult.line_items : [];
      const args = callArgs([
        "checkout",
        "create",
        "--business",
        cart.sellerDomain,
        "--input",
        JSON.stringify({ cart_id: cart.cartId, line_items: lineItems }),
      ]);
      const envelope = await call("checkout-create", cart.sellerDomain, args, fallback);
      const result = record(envelope.result)!;
      const checkoutId = extractResourceId(result, "checkout");
      if (!checkoutId) {
        throw new UpstreamError(
          "ucp checkout-create: failed",
          preferredContinueUrl(continueUrlFrom(result), fallback),
        );
      }
      checkoutMetadata.set(checkoutId, result);
      const continueUrl = preferredContinueUrl(continueUrlFrom(result), fallback);
      if (continueUrl) checkoutContinueUrls.set(checkoutId, continueUrl);
      return {
        checkoutId,
        sellerDomain: cart.sellerDomain,
        status: statusFrom(result),
        ...(continueUrl ? { continueUrl } : {}),
        messages: messagesFrom(result),
      };
    },

    async setDestination(checkout, destination, buyer) {
      const fallback = preferredContinueUrl(
        checkout.continueUrl,
        checkoutContinueUrls.get(checkout.checkoutId),
      );
      const args = callArgs([
        "checkout",
        "update",
        checkout.checkoutId,
        "--business",
        checkout.sellerDomain,
        "--input",
        JSON.stringify(destinationPayload(
          destination,
          checkoutMetadata.get(checkout.checkoutId) ?? {},
          buyer?.email,
        )),
      ]);
      const envelope = await call("checkout-update", checkout.sellerDomain, args, fallback);
      const result = record(envelope.result)!;
      const continueUrl = preferredContinueUrl(continueUrlFrom(result), fallback);
      if (continueUrl) checkoutContinueUrls.set(checkout.checkoutId, continueUrl);
      return {
        checkoutId: checkout.checkoutId,
        sellerDomain: checkout.sellerDomain,
        status: statusFrom(result),
        ...(continueUrl ? { continueUrl } : {}),
        messages: messagesFrom(result),
      };
    },

    async complete(checkout) {
      const fallback = preferredContinueUrl(
        checkout.continueUrl,
        checkoutContinueUrls.get(checkout.checkoutId),
      );
      const args = callArgs([
        "checkout",
        "complete",
        checkout.checkoutId,
        "--business",
        checkout.sellerDomain,
        "--input",
        JSON.stringify({ payment: {} }),
      ]);
      const envelope = await call("checkout-complete", checkout.sellerDomain, args, fallback, true);
      const result = record(envelope.result)!;
      const continueUrl = preferredContinueUrl(continueUrlFrom(result), fallback);
      const orderId = orderIdFrom(result);
      return {
        checkoutId: checkout.checkoutId,
        sellerDomain: checkout.sellerDomain,
        status: statusFrom(result),
        ...(orderId ? { orderId } : {}),
        ...(continueUrl ? { continueUrl } : {}),
        messages: messagesFrom(result),
      };
    },
  };

  return api;
}

export function scrubFixture(value: unknown, key = ""): unknown {
  if (/(?:authorization|access[_-]?token|refresh[_-]?token|api[_-]?key|secret|password|cookie|bearer|^key$)/i.test(key)) {
    return "[REDACTED]";
  }
  if (typeof value === "string") {
    return value
      .replace(/([?&](?:_gsid|access_token|auth_token|token|key)=)[^&#\s]+/gi, "$1REDACTED")
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, (email) =>
        email.toLowerCase() === "demo@agent-cookie.dev" ? email : "[REDACTED]"
      );
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
): void {
  const { operation, business } = operationBusiness(args);
  const file = operation === "catalog-search"
    ? "catalog-search.global.json"
    : `${operation}.${fixtureBusiness(business)}.json`;
  mkdirSync(fixturesDir, { recursive: true });
  writeFileSync(
    join(fixturesDir, file),
    `${JSON.stringify(scrubFixture(envelope), null, 2)}\n`,
    { mode: 0o644 },
  );
}
