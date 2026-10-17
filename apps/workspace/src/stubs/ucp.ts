// In-memory stub of UcpApi until packages/ucp (lane D) lands. Serves offers from sample-fixtures/ucp-offers.json
// (normalised UcpOffer[], not CLI output) and simulates cart → checkout → complete. `complete` returns
// requires_escalation by default (native_checkout is false almost everywhere); UCP_STUB_COMPLETE switches it.
import { readFileSync } from "node:fs";
import {
  UpstreamError,
  type UcpApi, type UcpCart, type UcpCheckout, type UcpDestination, type UcpOffer, type UcpSearchQuery,
} from "@agent-cookie/contract";
import type { UcpStubOutcome } from "../config.js";

export interface StubUcpCall { op: string; sellerDomain?: string; destination?: UcpDestination }

export class StubUcp implements UcpApi {
  readonly calls: StubUcpCall[] = [];
  private n = 0;
  constructor(private offers: UcpOffer[], private outcome: UcpStubOutcome = "requires_escalation") {}

  static fromFile(path: string, outcome: UcpStubOutcome): StubUcp {
    let offers: UcpOffer[] = [];
    try {
      offers = JSON.parse(readFileSync(path, "utf8")) as UcpOffer[];
    } catch {
      offers = [];
    }
    return new StubUcp(offers, outcome);
  }

  private offer(sellerDomain: string, variantId: string): UcpOffer {
    const o = this.offers.find((x) => x.sellerDomain === sellerDomain && x.variantId === variantId);
    if (!o) throw new UpstreamError("ucp: variant not found");
    return o;
  }

  async searchOffers(q: UcpSearchQuery): Promise<UcpOffer[]> {
    this.calls.push({ op: "search" });
    if (this.outcome === "error" && q.query === "__fail__") throw new UpstreamError("ucp: catalog search failed");
    return structuredClone(this.offers.slice(0, q.limit ?? 50));
  }

  async createCart(o: Pick<UcpOffer, "sellerDomain" | "variantId">): Promise<UcpCart> {
    this.calls.push({ op: "cart.create", sellerDomain: o.sellerDomain });
    const offer = this.offer(o.sellerDomain, o.variantId);
    return { cartId: `stub-cart-${++this.n}`, sellerDomain: offer.sellerDomain, continueUrl: offer.checkoutUrl, messages: [] };
  }

  async createCheckout(cart: UcpCart): Promise<UcpCheckout> {
    this.calls.push({ op: "checkout.create", sellerDomain: cart.sellerDomain });
    return { checkoutId: `stub-co-${++this.n}`, sellerDomain: cart.sellerDomain, status: "incomplete", continueUrl: cart.continueUrl,
      messages: [{ type: "info", code: "missing_fulfillment", content: "Shipping address required.", severity: "recoverable" }] };
  }

  async setDestination(co: UcpCheckout, destination: UcpDestination): Promise<UcpCheckout> {
    this.calls.push({ op: "checkout.update", sellerDomain: co.sellerDomain, destination });
    return { ...co, status: "ready_for_complete", messages: [] };
  }

  async complete(co: UcpCheckout): Promise<UcpCheckout> {
    this.calls.push({ op: "checkout.complete", sellerDomain: co.sellerDomain });
    const url = co.continueUrl ?? `https://${co.sellerDomain}/checkouts/${co.checkoutId}`;
    switch (this.outcome) {
      case "completed":
        return { ...co, status: "completed", orderId: `stub-order-${++this.n}`, continueUrl: undefined, messages: [] };
      case "sold_out":
        return { ...co, status: "incomplete", continueUrl: url, messages: [{ type: "error", code: "out_of_stock",
          content: "Sample: this variant sold out before checkout completed.", severity: "unrecoverable" }] };
      case "error":
        throw new UpstreamError("ucp: checkout complete failed", url);
      default:
        return { ...co, status: "requires_escalation", continueUrl: url, messages: [{ type: "info", code: "buyer_review",
          content: "The merchant needs the buyer to review and pay on its page.", severity: "requires_buyer_review" }] };
    }
  }
}
