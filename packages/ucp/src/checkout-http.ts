import { createHash } from "node:crypto";
import { UpstreamError, type UcpApi, type UcpCheckout } from "@agent-cookie/contract";

type ObjectValue = Record<string, unknown>;
type Payment = NonNullable<Parameters<UcpApi["complete"]>[1]>;
const object = (value: unknown): value is ObjectValue => value !== null && typeof value === "object" && !Array.isArray(value);
const VERSION = "2026-08-25";
const SAFE_ID = /^[A-Za-z0-9_.-]{1,128}$/;

/** Private server configuration, pending D2-contract review. Not part of the frozen public UcpApi. */
export interface AuthorizationHandler {
  name: string;
  id: string;
  version: typeof VERSION;
  instrumentType: string;
  credentialType: string;
}
export interface CheckoutAuthorization {
  authorizationId: string;
  checkoutId: string;
  sellerDomain: string;
  amount: number;
  currency: "USD";
  status: "authorized";
  providerRef: string;
}
export interface CheckoutReplay {
  provenance: "recorded-replay";
  source: "local-simulated-merchant";
  simulated: true;
  exchanges: Array<{ method: string; path: string; status: number; response: unknown }>;
}
export interface CheckoutHttpOptions {
  mode: "live" | "fixture";
  platformProfileUrl: string;
  /** A server-owned agreement: the handler MUST explicitly accept an authorization reference in credential.token. */
  merchants: Record<string, AuthorizationHandler>;
  resolveAuthorization: (checkout: UcpCheckout, payment: Payment) => Promise<CheckoutAuthorization>;
  signPayer: (input: { sellerDomain: string; authority: string; path: string; tag: "agent-payer-auth" }) => Promise<{
    signatureInput: string; signature: string;
  }>;
  onOutcome: (input: { authorizationId: string; checkoutId: string; outcome: "accepted" | "unknown"; owner: "merchant" | "unknown" }) => void | Promise<void>;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  replay?: CheckoutReplay;
  /** Exact loopback origin, permitted only with UCP_PAYMENT_SIMULATOR=1. Never inferred from a catalog result. */
  simulatorOrigin?: string;
}

export interface CheckoutHttpTransport {
  mode: "live" | "fixture";
  update(checkout: UcpCheckout, changes: (current: ObjectValue) => ObjectValue): Promise<ObjectValue | undefined>;
  complete(checkout: UcpCheckout, payment?: Payment): Promise<ObjectValue | undefined>;
}

/** Opt-in REST seam only. No public workspace wiring until provenance/payment disposition contracts are frozen. */
export function createCheckoutHttpTransport(options: CheckoutHttpOptions): CheckoutHttpTransport {
  const platform = new URL(options.platformProfileUrl);
  if (platform.protocol !== "https:" || platform.username || platform.password || /["\r\n]/.test(options.platformProfileUrl)) {
    throw new Error("ucp checkout: invalid platform profile");
  }
  const attempts = new Set<string>();
  let replayPosition = 0;
  const failure = (checkout: UcpCheckout, operation: string) => new UpstreamError(`ucp ${operation}: failed`, checkout.continueUrl);
  const originFor = (checkout: UcpCheckout): string => {
    if (!SAFE_ID.test(checkout.checkoutId)) throw failure(checkout, "checkout identity");
    if (options.simulatorOrigin !== undefined) {
      const candidate = new URL(options.simulatorOrigin);
      if (process.env.UCP_PAYMENT_SIMULATOR !== "1" || !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(options.simulatorOrigin) ||
          candidate.host !== checkout.sellerDomain) throw failure(checkout, "simulator origin");
      return candidate.origin;
    }
    if (!/^(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/.test(checkout.sellerDomain)) throw failure(checkout, "merchant origin");
    return `https://${checkout.sellerDomain}`;
  };
  const readResponse = async (response: Response): Promise<unknown> => {
    if (!response.body) throw new Error();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > 262_144) throw new Error();
        chunks.push(chunk.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    } finally { await reader.cancel().catch(() => {}); }
  };
  const request = async (checkout: UcpCheckout, url: URL, method: "GET" | "PUT" | "POST", body?: ObjectValue, key?: string) => {
    try {
      const signed = await options.signPayer({ sellerDomain: checkout.sellerDomain, authority: url.host, path: url.pathname, tag: "agent-payer-auth" });
      if (!signed.signatureInput.includes('tag="agent-payer-auth"') || !signed.signature || /[\r\n]/.test(signed.signatureInput + signed.signature)) throw new Error();
      const headers = { "Content-Type": "application/json", Accept: "application/json", "UCP-Agent": `profile="${options.platformProfileUrl}"`,
        "Signature-Input": signed.signatureInput, Signature: signed.signature, ...(key ? { "Idempotency-Key": key } : {}) };
      let response: Response;
      if (options.mode === "fixture") {
        const replay = options.replay;
        if (!replay || replay.provenance !== "recorded-replay" || replay.source !== "local-simulated-merchant" || replay.simulated !== true) throw new Error();
        const entry = replay.exchanges[replayPosition++];
        if (!entry || entry.method !== method || entry.path !== url.pathname) throw new Error();
        response = new Response(JSON.stringify(entry.response), { status: entry.status, headers: { "Content-Type": "application/json" } });
      } else {
        response = await (options.fetch ?? globalThis.fetch)(url, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}),
          redirect: "error", signal: AbortSignal.timeout(options.timeoutMs ?? 10_000) });
      }
      if (response.status === 404 && method === "GET" && url.pathname === "/.well-known/ucp") return undefined;
      const result = await readResponse(response);
      if (!response.ok || !object(result)) throw new Error();
      return result;
    } catch { throw failure(checkout, `checkout ${method.toLowerCase()}`); }
  };
  const hasHandler = (resource: ObjectValue, handler: AuthorizationHandler): boolean => {
    const ucp = object(resource.ucp) ? resource.ucp : undefined;
    const registry = ucp && object(ucp.payment_handlers) ? ucp.payment_handlers : undefined;
    const entries = registry?.[handler.name];
    return Array.isArray(entries) && entries.some((entry) => object(entry) && entry.id === handler.id && entry.version === handler.version);
  };
  const discover = async (checkout: UcpCheckout) => {
    if (!Object.hasOwn(options.merchants, checkout.sellerDomain)) return undefined;
    const handler = options.merchants[checkout.sellerDomain]!;
    if (handler.version !== VERSION || typeof handler.name !== "string" || ![handler.id, handler.instrumentType, handler.credentialType].every((value) => typeof value === "string" && SAFE_ID.test(value))) throw failure(checkout, "handler agreement");
    const origin = originFor(checkout);
    const profile = await request(checkout, new URL("/.well-known/ucp", origin), "GET");
    if (!profile || !hasHandler(profile, handler) || !object(profile.ucp) || profile.ucp.version !== VERSION) return undefined;
    const ucp = object(profile.ucp) ? profile.ucp : undefined;
    const services = ucp && object(ucp.services) ? ucp.services["dev.ucp.shopping"] : undefined;
    const service = Array.isArray(services) ? services.find((value) => object(value) && value.transport === "rest" && value.version === VERSION) : undefined;
    if (!object(service) || typeof service.endpoint !== "string") return undefined;
    let base: URL;
    try { base = new URL(service.endpoint); } catch { throw failure(checkout, "REST endpoint"); }
    if (base.origin !== origin || base.username || base.password || base.search || base.hash) throw failure(checkout, "REST endpoint");
    const resourceUrl = new URL(`${base.pathname.replace(/\/$/, "")}/checkout-sessions/${encodeURIComponent(checkout.checkoutId)}`, origin);
    const resource = await request(checkout, resourceUrl, "GET");
    if (!resource || resource.id !== checkout.checkoutId || !hasHandler(resource, handler) || !object(resource.ucp) || resource.ucp.version !== VERSION) return undefined;
    return { handler, resourceUrl, resource };
  };
  const envelope = (checkout: UcpCheckout, resource: ObjectValue): ObjectValue => ({ result: {
    id: checkout.checkoutId, status: typeof resource.status === "string" &&
      ["incomplete", "ready_for_complete", "completed", "requires_escalation", "canceled", "complete_in_progress"].includes(resource.status)
      ? resource.status : "requires_escalation",
    ...(object(resource.order) && typeof resource.order.id === "string" ? { order: { id: resource.order.id } } : {}),
    ...(checkout.continueUrl ? { continue_url: checkout.continueUrl } : {}),
    // Merchant text is not trusted to be free of credentials, provider references or address values.
    messages: Array.isArray(resource.messages) ? resource.messages.flatMap((message) => {
      if (!object(message)) return [];
      if (message.code === "out_of_stock") return [{ type: "error", code: "out_of_stock", content: "Item is out of stock", severity: "requires_buyer_input" }];
      if (message.code === "INSUFFICIENT_PERMISSIONS") return [{ type: "error", code: "INSUFFICIENT_PERMISSIONS", content: "Merchant checkout requires buyer action", severity: "requires_buyer_input" }];
      return [];
    }) : [],
  } });
  return {
    mode: options.mode,
    async update(checkout, buildChanges) {
      const discovered = await discover(checkout);
      if (!discovered) return undefined;
      if (discovered.resource.status === "complete_in_progress" || discovered.resource.status === "completed") throw failure(checkout, "checkout state");
      const state = discovered.resource;
      const changes = buildChanges(state);
      const previousBuyer = object(state.buyer) ? state.buyer : {};
      const result = await request(checkout, discovered.resourceUrl, "PUT", {
        ...state, ...changes, line_items: state.line_items,
        buyer: { ...previousBuyer, ...(object(changes.buyer) ? changes.buyer : {}) },
      }, createHash("sha256").update(`update:${checkout.sellerDomain}:${checkout.checkoutId}:${JSON.stringify(changes)}`).digest("hex"));
      if (result && Array.isArray(result.messages) && result.messages.some((message) => object(message) && message.code === "out_of_stock")) {
        return envelope(checkout, { ...result, status: "requires_escalation" });
      }
      if (!result || result.id !== checkout.checkoutId) throw failure(checkout, "checkout update");
      return envelope(checkout, result);
    },
    async complete(checkout, input) {
      if (!input) return undefined;
      checkout = { ...checkout };
      const payment = { authorizationId: input.authorizationId, amount: input.amount, currency: input.currency };
      const discovered = await discover(checkout);
      if (!discovered) return undefined;
      if (typeof payment.authorizationId !== "string" || !SAFE_ID.test(payment.authorizationId) || !Number.isSafeInteger(payment.amount) || payment.amount <= 0 || payment.currency !== "USD") throw failure(checkout, "payment binding");
      const { resource, handler, resourceUrl } = discovered;
      if (Array.isArray(resource.messages) && resource.messages.some((message) => object(message) && (message.type === "error" || message.code === "out_of_stock"))) {
        throw failure(checkout, "checkout requires escalation");
      }
      const total = Array.isArray(resource.totals) ? resource.totals.find((value) => object(value) && value.type === "total") : undefined;
      if (resource.status !== "ready_for_complete" || resource.currency !== "USD" || !object(total) || total.amount !== payment.amount) throw failure(checkout, "checkout total/state");
      let authorization: CheckoutAuthorization;
      try { authorization = await options.resolveAuthorization(checkout, payment); } catch { throw failure(checkout, "payment lookup"); }
      if (!object(authorization) || authorization.authorizationId !== payment.authorizationId || authorization.checkoutId !== checkout.checkoutId || authorization.sellerDomain !== checkout.sellerDomain ||
          authorization.status !== "authorized" || authorization.amount !== payment.amount || authorization.currency !== payment.currency ||
          typeof authorization.providerRef !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(authorization.providerRef) ||
          /^(tms_|pm_|tok_)/i.test(authorization.providerRef) || /^\d{12,19}$/.test(authorization.providerRef)) throw failure(checkout, "payment binding");
      const attempt = `${checkout.sellerDomain}:${checkout.checkoutId}:${payment.authorizationId}`;
      if (attempts.has(attempt) || attempts.has(`authorization:${payment.authorizationId}`)) throw failure(checkout, "payment already attempted");
      // Reserve before the first mutation. Ambiguous results require reconciliation, never blind retry/capture/reversal.
      attempts.add(attempt); attempts.add(`authorization:${payment.authorizationId}`);
      const instrument = { id: payment.authorizationId, handler_id: handler.id, type: handler.instrumentType,
        credential: { type: handler.credentialType, token: authorization.providerRef } };
      try {
        const result = await request(checkout, new URL(`${resourceUrl.pathname}/complete`, resourceUrl), "POST", { payment: { instruments: [instrument] } },
          createHash("sha256").update(attempt).digest("hex"));
        const instruments = result && object(result.payment) ? result.payment.instruments : undefined;
        const accepted = Array.isArray(instruments) && instruments.some((value) => object(value) && value.id === instrument.id && value.handler_id === handler.id && value.type === instrument.type && value.selected === true && !Object.hasOwn(value, "credential"));
        if (!result || result.id !== checkout.checkoutId || result.status !== "completed" || !object(result.order) || typeof result.order.id !== "string" ||
            !SAFE_ID.test(result.order.id) || result.order.id.includes(authorization.providerRef) || !accepted ||
            (Array.isArray(result.messages) && result.messages.some((message) => object(message) && (message.type === "error" || message.code === "out_of_stock")))) throw new Error();
        await options.onOutcome({ authorizationId: payment.authorizationId, checkoutId: checkout.checkoutId, outcome: "accepted", owner: "merchant" });
        return envelope(checkout, result);
      } catch {
        try {
          await options.onOutcome({ authorizationId: payment.authorizationId, checkoutId: checkout.checkoutId, outcome: "unknown", owner: "unknown" });
        } catch { /* The caller still receives a sanitized reconciliation-required failure, never a false success. */ }
        throw failure(checkout, "payment completion needs reconciliation");
      }
    },
  };
}
