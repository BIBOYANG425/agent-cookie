// Intents → matching → introductions → quotes → accept. UCP stores are reached through UcpApi via per-domain
// proxy agents ("ucp:<domain>") that go through the same session, grant, field and receipt path as any merchant.
import {
  GRANT_TTL_MS, QUOTE_POLL_MAX_MS, UpstreamError, WorkspaceError,
  type AcceptResult, type Agent, type Quote, type Receipt, type UcpCheckout, type UcpMessage, type UcpOffer,
} from "@agent-cookie/contract";
import type { IntentRow, QuoteRow } from "../db.js";
import { fail, type AuthedAgent } from "../http.js";
import { newId } from "../ids.js";
import { parseAddress, parseBudgetCents, pickSellers } from "../ucp-filter.js";
import type { CardService } from "./card.js";
import { overridable } from "./card.js";
import { persist, writeMeta, type Ctx } from "./context.js";
import type { FieldService } from "./fields.js";
import type { NoteService } from "./notes.js";
import type { SessionService } from "./sessions.js";

/** Intent kinds served by the UCP catalog, with the default search query. */
export const UCP_KINDS: Record<string, string> = { trail_shoes: "trail running shoes" };

const PURPOSE_KEYS = new Set(["shipping_address", "payment_method"]);

export interface IntentInput { kind: string; public: Record<string, string>; text?: string }

export function toQuote(q: QuoteRow): Quote {
  const out: Quote = { id: q.id, intentId: q.intentId, agentId: q.agentId, text: q.text, price: q.price, currency: "USD", etaDate: q.etaDate ?? null };
  if (q.etaText !== undefined) out.etaText = q.etaText;
  if (q.title !== undefined) out.title = q.title;
  if (q.seller !== undefined) out.seller = q.seller;
  if (q.variantId !== undefined) out.variantId = q.variantId;
  if (q.checkoutUrl !== undefined) out.checkoutUrl = q.checkoutUrl;
  return out;
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function messageText(messages: UcpMessage[]): string | undefined {
  const t = messages.map((m) => m.content).filter(Boolean).join(" ");
  return t || undefined;
}

export class CommerceService {
  constructor(private ctx: Ctx, private card: CardService, private sessions: SessionService, private fields: FieldService, private notes: NoteService) {}

  async createIntent(personal: AuthedAgent, userId: string, input: IntentInput): Promise<{ intentId: string; expiresAt: string; introduced: number }> {
    for (const k of Object.keys(input.public)) {
      // The public part is sent to every matched merchant; sensitive fields are read later, by purpose, from the card.
      if (PURPOSE_KEYS.has(k)) fail("MISSING_FIELD", "intent public values may not carry purpose fields");
    }
    const { store, clock } = this.ctx;
    const intent: IntentRow = { id: newId("i"), userId, agentId: personal.agentId, kind: input.kind, public: input.public,
      createdAt: clock.nowIso(), expiresAt: clock.isoIn(GRANT_TTL_MS) };
    if (input.text) intent.text = input.text;
    store.insertIntent(intent);
    this.ctx.log({ event: "intent.create", actor: personal.agentId, object: intent.id, result: "ok", reason: input.kind });

    let introduced = 0;
    for (const agent of store.agents()) {
      if (agent.category === "personal" || agent.domain || !agent.capabilities.includes(input.kind)) continue;
      if (agent.callbackUrl) {
        const { session, handshake } = await this.sessions.introduce(userId, agent, intent, "callback");
        void this.ctx.delivery.callback(agent, { type: "introduce", sessionId: session.sessionId, handshake,
          intent: { id: intent.id, kind: intent.kind, public: intent.public, expiresAt: intent.expiresAt } });
        introduced++;
      } else if (agent.chatEndpoint) {
        const { session, handshake } = await this.sessions.introduce(userId, agent, intent, "tier0");
        const values = this.card.values(userId, intent.id);
        const fields = this.ctx.delivery.tier0Fields(agent, handshake, values);
        // Every Tier 0 delivery is a disclosure of auto values: receipt first, then the attempt.
        const receipt: Receipt = { id: newId("r"), sessionId: session.sessionId, agentId: agent.agentId, fields, purpose: "tier0", createdAt: clock.nowIso() };
        store.insertReceipt({ ...receipt, userId });
        await persist(this.ctx, "receipt", "workspace", (r) => r.appendReceipt(receipt, writeMeta(this.ctx, "workspace", receipt)));
        void this.ctx.delivery.tier0(agent, handshake, values, intent.text);
        introduced++;
      }
    }
    if (UCP_KINDS[input.kind] !== undefined) introduced += await this.ucpMatch(userId, intent);
    return { intentId: intent.id, expiresAt: intent.expiresAt, introduced };
  }

  /** Catalog search → deterministic filter → first two distinct sellers → proxy session + grant + quote each (A09). */
  private async ucpMatch(userId: string, intent: IntentRow): Promise<number> {
    const values = this.card.values(userId, intent.id);
    const maxPriceCents = parseBudgetCents(values.budget);
    let offers: UcpOffer[];
    try {
      offers = await this.ctx.ucp.searchOffers({ query: intent.public.query ?? UCP_KINDS[intent.kind]!, intentText: intent.text,
        maxPriceCents, shipsTo: "US", limit: 50 });
    } catch (err) {
      this.ctx.log({ event: "ucp.search", actor: "workspace", object: intent.id, result: "failed", reason: err instanceof WorkspaceError ? err.code : "error" });
      return 0;
    }
    const picked = pickSellers(offers, { shoeSize: values.shoe_size, maxPriceCents, shipsTo: "US" });
    this.ctx.log({ event: "ucp.search", actor: "workspace", object: intent.id, result: "ok", reason: `offers=${offers.length} picked=${picked.length}` });
    for (const offer of picked) {
      const proxy = this.ensureProxy(offer);
      const { session } = await this.sessions.introduce(userId, proxy, intent, "ucp");
      const title = `${offer.productTitle}${offer.variantTitle ? ` · ${offer.variantTitle}` : ""}`;
      const q: QuoteRow = { id: newId("q"), intentId: intent.id, agentId: proxy.agentId, sessionId: session.sessionId,
        text: `${title} · ${dollars(offer.priceCents)} · ${offer.sellerName}`, price: offer.priceCents, currency: "USD",
        etaDate: offer.etaDate ?? null, title, seller: offer.sellerDomain, variantId: offer.variantId, status: "open", createdAt: this.ctx.clock.nowIso() };
      const url = offer.checkoutUrl ?? offer.url;
      if (url) q.checkoutUrl = url;
      this.ctx.store.insertQuote(q);
    }
    return picked.length;
  }

  private ensureProxy(offer: UcpOffer): Agent {
    const existing = this.ctx.store.agentByDomain(offer.sellerDomain);
    if (existing) return existing;
    const proxy: Agent = { agentId: `ucp:${offer.sellerDomain}`, name: `${offer.sellerName} (UCP proxy)`, category: "shoe",
      capabilities: Object.keys(UCP_KINDS), domain: offer.sellerDomain, createdAt: this.ctx.clock.nowIso() };
    this.ctx.store.insertAgent(proxy);
    this.ctx.log({ event: "ucp.proxy", actor: "workspace", object: proxy.agentId, result: "registered" });
    return proxy;
  }

  async quotes(userId: string, intentId: string, waitMs: number): Promise<{ intentId: string; quotes: Quote[]; complete: boolean }> {
    const intent = this.ctx.store.intent(intentId);
    if (!intent || intent.userId !== userId) fail("NOT_FOUND");
    const wait = Math.max(0, Math.min(waitMs, QUOTE_POLL_MAX_MS));
    const expected = new Set(this.ctx.store.intentSessions(intentId).filter((x) => x.channel !== "tier0").map((x) => x.agentId));
    const started = Date.now();
    for (;;) {
      const rows = this.ctx.store.quotesForIntent(intentId);
      const quoted = new Set(rows.map((q) => q.agentId));
      const complete = [...expected].every((a) => quoted.has(a));
      if (complete || Date.now() - started >= wait) return { intentId, quotes: rows.map(toQuote), complete };
      await new Promise((r) => setTimeout(r, Math.min(250, wait - (Date.now() - started))));
    }
  }

  async submitQuote(agent: AuthedAgent, input: { intentId: string; text: string; price: number; etaDate: string | null; etaText?: string; title?: string; checkoutUrl?: string }): Promise<Quote> {
    const intent = this.ctx.store.intent(input.intentId);
    const session = intent && this.ctx.store.sessionFor(intent.userId, agent.agentId);
    if (!intent || !session || !this.ctx.store.intentSession(intent.id, session.sessionId)) fail("NOT_FOUND");
    this.sessions.access(agent, session.sessionId);
    const q: QuoteRow = { id: newId("q"), intentId: intent.id, agentId: agent.agentId, sessionId: session.sessionId, text: input.text,
      price: input.price, currency: "USD", etaDate: input.etaDate, status: "open", createdAt: this.ctx.clock.nowIso() };
    if (input.etaText) q.etaText = input.etaText;
    if (input.title) q.title = input.title;
    if (input.checkoutUrl) q.checkoutUrl = input.checkoutUrl;
    this.ctx.store.insertQuote(q);
    this.ctx.log({ event: "quote.submit", actor: agent.agentId, object: q.id, result: "ok", reason: intent.id });
    return toQuote(q);
  }

  /** Accept a quote. Marks it accepted first — that is what grounds the merchant's later purpose=checkout read. */
  async accept(personal: AuthedAgent, userId: string, quoteId: string): Promise<AcceptResult> {
    const q = this.ctx.store.quote(quoteId);
    const intent = q && this.ctx.store.intent(q.intentId);
    if (!q || !intent || intent.userId !== userId) fail("NOT_FOUND");
    if (q.result) return { ...q.result, receipts: this.recentReceipts(userId) };
    const agent = this.ctx.store.agent(q.agentId);
    if (!agent) fail("NOT_FOUND");
    this.ctx.store.markQuoteAccepted(q.id, this.ctx.clock.nowIso());
    this.ctx.log({ event: "quote.accept", actor: personal.agentId, object: q.id, result: "ok", reason: agent.agentId });

    let result: AcceptResult;
    if (agent.domain) {
      result = await this.ucpCheckout(agent, q);
    } else if (agent.callbackUrl) {
      const r = await this.ctx.delivery.callback(agent, { type: "accepted", sessionId: q.sessionId, quoteId: q.id });
      result = r.ok
        ? { status: "handoff", quoteId: q.id, ...(q.checkoutUrl ? { continueUrl: q.checkoutUrl } : {}), message: "The merchant was notified and continues the checkout." }
        : { status: "failed", quoteId: q.id, code: "UPSTREAM_ERROR", message: "The merchant could not be reached.", ...(q.checkoutUrl ? { continueUrl: q.checkoutUrl } : {}) };
    } else {
      result = { status: "failed", quoteId: q.id, code: "UPSTREAM_ERROR", message: "The merchant cannot be reached." };
    }
    this.ctx.store.setQuoteResult(q.id, result);
    this.ctx.log({ event: "quote.result", actor: "workspace", object: q.id, result: result.status, reason: result.code ?? "" });
    return { ...result, receipts: this.recentReceipts(userId) };
  }

  /** cart → checkout → address (purpose=checkout, receipt) → destination → complete. Truthful mapping only (A18). */
  private async ucpCheckout(proxy: Agent, q: QuoteRow): Promise<AcceptResult> {
    const ucp = this.ctx.ucp;
    const asMerchant: AuthedAgent = { ...proxy, role: "merchant" };
    let co: UcpCheckout | undefined;
    const fallbackUrl = () => co?.continueUrl ?? q.checkoutUrl;
    try {
      if (!q.variantId) throw new UpstreamError("quote has no variant");
      const cart = await ucp.createCart({ sellerDomain: proxy.domain!, variantId: q.variantId });
      co = await ucp.createCheckout(cart);
      const read = await this.fields.read(asMerchant, q.sessionId, ["shipping_address"], "checkout");
      const address = read.fields.shipping_address;
      if (!address) {
        const url = fallbackUrl();
        return url
          ? { status: "handoff", quoteId: q.id, continueUrl: url, message: "Add the shipping address on the merchant's page to finish." }
          : { status: "failed", quoteId: q.id, code: "UPSTREAM_ERROR", message: "No shipping address and no merchant page to finish on." };
      }
      co = await ucp.setDestination(co, parseAddress(address));
      co = await ucp.complete(co);
    } catch (err) {
      if (err instanceof UpstreamError) {
        const url = err.continueUrl ?? fallbackUrl();
        return { status: "failed", quoteId: q.id, code: "UPSTREAM_ERROR", message: err.message, ...(url ? { continueUrl: url } : {}) };
      }
      if (err instanceof WorkspaceError) return { status: "blocked", quoteId: q.id, code: err.code, message: err.message };
      throw err;
    }
    const message = messageText(co.messages);
    const fatal = co.messages.some((m) => m.type === "error" && m.severity === "unrecoverable") || co.status === "canceled";
    let result: AcceptResult;
    if (co.status === "completed" && co.orderId && !fatal) {
      result = { status: "ordered", quoteId: q.id, orderId: co.orderId, ...(message ? { message } : {}) };
    } else if (!fatal && fallbackUrl()) {
      result = { status: "handoff", quoteId: q.id, continueUrl: fallbackUrl()!, message: message ?? "Pay on the merchant's page to finish the order." };
    } else {
      const url = fallbackUrl();
      result = { status: "failed", quoteId: q.id, code: "UPSTREAM_ERROR", message: message ?? `checkout ended as ${co.status}`, ...(url ? { continueUrl: url } : {}) };
    }
    if (result.status === "ordered" || result.status === "handoff") {
      try {
        await this.notes.write(asMerchant, q.sessionId, "last_order", q.title ?? q.text);
      } catch (err) {
        this.ctx.log({ event: "note.write", actor: proxy.agentId, object: q.sessionId, result: "failed", reason: err instanceof WorkspaceError ? err.code : "error" });
      }
    }
    return result;
  }

  private recentReceipts(userId: string): Receipt[] {
    return this.ctx.store.receiptsForUser(userId, 3).map(({ userId: _u, ...r }) => r);
  }
}

export { overridable };
