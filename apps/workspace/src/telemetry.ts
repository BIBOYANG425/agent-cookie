// Sentry, two products (plan §4 SENTRY_DSN, T8): tracing (a transaction per request, a child span per UCP call) and
// logs (activity events, UCP outcomes). Off unless SENTRY_DSN is set; without init every call here is a no-op.
// Privacy: nothing that could carry a card value leaves the process — no request/response bodies, headers, cookies,
// query strings, user info or stack-frame variables. Spans carry route templates, UCP operation names, seller
// domains and outcomes. Trace headers are never propagated to merchants: one trace id on the requests to two stores
// would link the user across them and defeat the pairwise session ids.
import * as Sentry from "@sentry/node";
import type { UcpApi } from "@agent-cookie/contract";
import type { ActivityInput } from "./activity.js";

export interface TelemetryOptions {
  dsn: string;
  environment: string;
  tracesSampleRate: number;
  /** Tests capture envelopes offline. */
  transport?: Sentry.NodeOptions["transport"];
}

export function initTelemetry(o: TelemetryOptions): void {
  Sentry.init({
    dsn: o.dsn,
    environment: o.environment,
    tracesSampleRate: o.tracesSampleRate,
    tracePropagationTargets: [],
    dataCollection: {
      userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false,
      databaseQueryData: false, stackFrameVariables: false,
    },
    ...(o.transport ? { transport: o.transport } : {}),
  });
}

export const flushTelemetry = (timeoutMs = 2000): Promise<boolean> => Sentry.flush(timeoutMs);

/** Root span for one HTTP request; the name is set to the route template once routing is done. */
/** Each request is its own trace in its own isolation scope (no trace id shared between requests or users). */
export function requestSpan<T>(method: string, fn: (rename: (route: string, status: number) => void) => Promise<T>): Promise<T> {
  return Sentry.withIsolationScope(() => Sentry.startNewTrace(() =>
    Sentry.startSpan({ name: method, op: "http.server", forceTransaction: true, attributes: { "http.request.method": method } },
      (span) => fn((route, status) => {
        Sentry.updateSpanName(span, `${method} ${route}`);
        span.setAttributes({ "http.route": route, "http.response.status_code": status });
        Sentry.setHttpStatus(span, status);
      }))));
}

/** Activity rows as Sentry logs. `object` (session / quote ids) stays local: ids are not sent to a third party. */
export function logActivity(e: ActivityInput): void {
  const attrs = { event: e.event, actor: e.actor, result: e.result, reason: e.reason ?? "" };
  if (/^(failed|error|unsigned)$/.test(e.result) || /^5\d\d$/.test(e.result)) Sentry.logger.warn("activity", attrs);
  else Sentry.logger.info("activity", attrs);
}

export function captureUnhandled(err: unknown): void {
  Sentry.captureException(err);
}

/** Every UcpApi call as a child span `ucp.<op>` (plus a log line), with the seller domain and the outcome. */
export function tracedUcp(ucp: UcpApi, mode: string): UcpApi {
  const span = <T>(op: string, seller: string | undefined, call: () => Promise<T>): Promise<T> => {
    const attributes = { "ucp.op": op, "ucp.mode": mode, ...(seller ? { "ucp.seller": seller } : {}) };
    return Sentry.startSpan({ name: `ucp.${op}`, op: "ucp", attributes }, async (s) => {
      const started = Date.now();
      try {
        const r = await call();
        const status = typeof r === "object" && r !== null && "status" in r && typeof r.status === "string" ? r.status : undefined;
        if (status) s.setAttribute("ucp.status", status);
        if (Array.isArray(r)) s.setAttribute("ucp.offers", r.length);
        Sentry.logger.info(`ucp.${op}`, { ...attributes, ok: true, ms: Date.now() - started, ...(status ? { "ucp.status": status } : {}) });
        return r;
      } catch (err) {
        Sentry.logger.warn(`ucp.${op}`, { ...attributes, ok: false, ms: Date.now() - started });
        throw err;
      }
    });
  };
  return {
    searchOffers: (q) => span("searchOffers", undefined, () => ucp.searchOffers(q)),
    createCart: (offer, quantity) => span("createCart", offer.sellerDomain, () => ucp.createCart(offer, quantity)),
    createCheckout: (cart) => span("createCheckout", cart.sellerDomain, () => ucp.createCheckout(cart)),
    setDestination: (co, destination, buyer) => span("setDestination", co.sellerDomain, () => ucp.setDestination(co, destination, buyer)),
    complete: (co) => span("complete", co.sellerDomain, () => ucp.complete(co)),
  };
}
