// Intents → matching → introductions → quotes → accept. UCP stores are reached through UcpApi via per-domain
// proxy agents ("ucp:<domain>") that go through the same session, grant, field and receipt path as any merchant.
import {
  GRANT_TTL_MS, QUOTE_POLL_MAX_MS, UpstreamError, WorkspaceError,
  type AcceptResult, type Agent, type Field, type Quote, type Receipt, type UcpCheckout, type UcpMessage, type UcpOffer,
} from "@agent-cookie/contract";
import type { IntentRow, QuoteRow } from "../db.js";
import { fail, type AuthedAgent } from "../http.js";
import { newId } from "../ids.js";
import { containsCardNumber, publicEntryProblem } from "../guards.js";
import { parseAddress, parseBudgetCents, pickSellers } from "../ucp-filter.js";
import type { CardService } from "./card.js";
import { overridable } from "./card.js";
import { persistStrict, writeMeta, type Ctx } from "./context.js";
import type { FieldService } from "./fields.js";
import type { NoteService } from "./notes.js";
import type { Introduction, SessionService } from "./sessions.js";

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
  out.source = q.source ?? "live";
  return out;
}

/** Upstream error text reaches the user; local paths and file-system errors from a fixture replay never do (B22). */
export function publicUpstreamMessage(message: string): string {
  if (/ENOENT|EACCES|no such file/i.test(message)) return "The store's response for this step is not available.";
  if (needsBuyer(message)) return "The store needs you to sign in and pay on its own page.";
  // Absolute file paths (not URLs: a path right after "//" or ":" is part of a link and stays).
  return message.replace(/(?<![:/\w.])\/(?:home|tmp|usr|var|Users|private|opt|etc|root)\/[^\s'"()\[\]]*/g, "<path>").slice(0, 300);
}

/** UCP's AUTH_REQUIRED family: the store will only finish with the buyer present — hand off to its page (UCP REFERENCE). */
function needsBuyer(message: string): boolean {
  return /INSUFFICIENT_PERMISSIONS|AUTH_REQUIRED|AuthenticationRequired|requires? (?:buyer )?authentication|JWT is required/i.test(message);
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function messageText(messages: UcpMessage[]): string | undefined {
  const t = messages.map((m) => m.content).filter(Boolean).join(" ");
  return t || undefined;
}

export class CommerceService {
  constructor(private ctx: Ctx, private card: CardService, private sessions: SessionService, private fields: FieldService, private notes: NoteService,
    private pinned: readonly string[] = []) {}

  /**
   * Prepare every introduction (UCP search, handshake signing) without writing; commit intent, proxies, sessions,
   * grants, quotes and Tier 0 receipts in ONE transaction; only then deliver. A failure anywhere before the commit
   * leaves no state behind, so a retry with the same Idempotency-Key starts clean.
   */
  async createIntent(personal: AuthedAgent, userId: string, input: IntentInput): Promise<{ intentId: string; expiresAt: string; introduced: number }> {
    for (const [k, v] of Object.entries(input.public)) {
      // The public part is sent to every matched merchant; sensitive fields are read later, by purpose, from the card.
      if (PURPOSE_KEYS.has(k)) fail("MISSING_FIELD", "intent public values may not carry purpose fields");
      const problem = publicEntryProblem(k, v);
      if (problem) fail("MISSING_FIELD", problem);
    }
    if (input.text && containsCardNumber(input.text)) fail("MISSING_FIELD", "card numbers are never stored");
    const { store, clock } = this.ctx;
    const intent: IntentRow = { id: newId("i"), userId, agentId: personal.agentId, kind: input.kind, public: input.public,
      createdAt: clock.nowIso(), expiresAt: clock.isoIn(GRANT_TTL_MS) };
    if (input.text) intent.text = input.text;

    interface Plan extends Introduction { newAgent?: Agent; quote?: QuoteRow; receipt?: Receipt; values?: Partial<Record<Field, string>> }
    const plans: Plan[] = [];
    for (const agent of store.agents()) {
      if (agent.category === "personal" || agent.domain || !agent.capabilities.includes(input.kind)) continue;
      if (agent.callbackUrl) {
        plans.push(await this.sessions.prepare(userId, agent, intent, "callback"));
      } else if (agent.chatEndpoint) {
        const x = await this.sessions.prepare(userId, agent, intent, "tier0");
        const values = this.card.values(userId, intent);
        // Every Tier 0 delivery discloses auto values: the receipt is committed before the attempt.
        const receipt: Receipt = { id: newId("r"), sessionId: x.session.sessionId, agentId: agent.agentId,
          fields: this.ctx.delivery.tier0Fields(agent, x.handshake, values), purpose: "tier0", createdAt: clock.nowIso() };
        plans.push({ ...x, receipt, values });
      }
    }
    let ucpNote: { result: string; reason: string } | undefined;
    if (Object.hasOwn(UCP_KINDS, input.kind)) {
      const values = this.card.values(userId, intent);
      const maxPriceCents = parseBudgetCents(values.budget);
      let offers: UcpOffer[] | undefined;
      try {
        offers = await this.ctx.ucp.searchOffers({ query: intent.public.query ?? UCP_KINDS[input.kind]!, intentText: intent.text,
          maxPriceCents, shipsTo: "US", limit: 50 });
      } catch (err) {
        ucpNote = { result: "failed", reason: err instanceof WorkspaceError ? err.code : "error" };
      }
      if (offers) {
        const picked = pickSellers(offers, { shoeSize: values.shoe_size, maxPriceCents, shipsTo: "US" }, 2, this.pinned);
        ucpNote = { result: "ok", reason: `offers=${offers.length} picked=${picked.length}` };
        for (const offer of picked) {
          const existing = store.agentByDomain(offer.sellerDomain);
          const proxy: Agent = existing ?? { agentId: `ucp:${offer.sellerDomain}`, name: `${offer.sellerName} (UCP proxy)`, category: "shoe",
            capabilities: Object.keys(UCP_KINDS), domain: offer.sellerDomain, createdAt: clock.nowIso() };
          const x = await this.sessions.prepare(userId, proxy, intent, "ucp");
          const title = `${offer.productTitle}${offer.variantTitle ? ` · ${offer.variantTitle}` : ""}`;
          const quote: QuoteRow = { id: newId("q"), intentId: intent.id, agentId: proxy.agentId, sessionId: x.session.sessionId,
            text: `${title} · ${dollars(offer.priceCents)} · ${offer.sellerName}`, price: offer.priceCents, currency: "USD",
            etaDate: offer.etaDate ?? null, title, seller: offer.sellerDomain, variantId: offer.variantId, status: "open", createdAt: clock.nowIso(),
            source: this.ctx.config.ucpMode === "live" ? "live" : "fixture" };
          const url = offer.checkoutUrl ?? offer.url;
          if (url) quote.checkoutUrl = url;
          plans.push({ ...x, quote, ...(existing ? {} : { newAgent: proxy }) });
        }
      }
    }

    store.tx(() => {
      store.insertIntent(intent);
      this.ctx.log({ event: "intent.create", actor: personal.agentId, object: intent.id, result: "ok", reason: input.kind });
      if (ucpNote) this.ctx.log({ event: "ucp.search", actor: "workspace", object: intent.id, ...ucpNote });
      for (const p of plans) {
        if (p.newAgent) {
          store.insertAgent(p.newAgent);
          this.ctx.log({ event: "ucp.proxy", actor: "workspace", object: p.newAgent.agentId, result: "registered" });
        }
        this.sessions.commit(p, intent);
        if (p.quote) store.insertQuote(p.quote);
        if (p.receipt) store.insertReceipt({ ...p.receipt, userId });
      }
    });

    for (const p of plans) {
      if (p.channel === "callback") {
        void this.ctx.delivery.callback(p.agent, { type: "introduce", sessionId: p.session.sessionId, handshake: p.handshake,
          intent: { id: intent.id, kind: intent.kind, public: intent.public, expiresAt: intent.expiresAt } });
      } else if (p.channel === "tier0" && p.receipt) {
        // The Tier 0 prefix carries values: deliver only once its receipt is durable in git.
        const receipt = p.receipt;
        try {
          await persistStrict(this.ctx, "receipt", "workspace", (r) => r.appendReceipt(receipt, writeMeta(this.ctx, "workspace", receipt)));
        } catch (err) {
          if (err instanceof WorkspaceError && err.code === "NOT_FOUND") throw err;
          this.ctx.log({ event: "tier0.deliver", actor: "workspace", object: p.agent.agentId, result: "skipped", reason: "receipt not durable" });
          continue;
        }
        void this.ctx.delivery.tier0(p.agent, p.handshake, p.values ?? {}, intent.text);
      }
    }
    return { intentId: intent.id, expiresAt: intent.expiresAt, introduced: plans.length };
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
      if (complete || this.ctx.closing() || Date.now() - started >= wait) return { intentId, quotes: rows.map(toQuote), complete };
      await new Promise((r) => setTimeout(r, Math.min(250, wait - (Date.now() - started))));
    }
  }

  async submitQuote(agent: AuthedAgent, input: { intentId: string; text: string; price: number; etaDate: string | null; etaText?: string; title?: string; checkoutUrl?: string }): Promise<Quote> {
    const intent = this.ctx.store.intent(input.intentId);
    const session = intent && this.ctx.store.sessionFor(intent.userId, agent.agentId);
    if (!intent || !session || !this.ctx.store.intentSession(intent.id, session.sessionId)) fail("NOT_FOUND");
    // The grant issued for THIS intent must be live (not just any grant of the session), and so must the intent.
    this.sessions.access(agent, session.sessionId, { intentId: intent.id });
    if (Date.parse(intent.expiresAt) <= this.ctx.clock.now()) fail("GRANT_EXPIRED");
    const q: QuoteRow = { id: newId("q"), intentId: intent.id, agentId: agent.agentId, sessionId: session.sessionId, text: input.text,
      price: input.price, currency: "USD", etaDate: input.etaDate, status: "open", createdAt: this.ctx.clock.nowIso(), source: "live" };
    if (input.etaText) q.etaText = input.etaText;
    if (input.title) q.title = input.title;
    if (input.checkoutUrl) q.checkoutUrl = input.checkoutUrl;
    this.ctx.store.insertQuote(q);
    this.ctx.log({ event: "quote.submit", actor: agent.agentId, object: q.id, result: "ok", reason: intent.id });
    return toQuote(q);
  }

  private inflight = new Map<string, Promise<AcceptResult>>();

  /**
   * Accept a quote. Concurrent accepts of one quote share one run; a decided quote returns its stored result.
   * Nothing goes upstream unless the intent and the merchant's grant for it are still live. On accept the
   * merchant's grant for this intent widens to shipping_address for purpose "checkout" — the only way a
   * purpose field is ever released.
   */
  async accept(personal: AuthedAgent, userId: string, quoteId: string): Promise<AcceptResult> {
    const q = this.ctx.store.quote(quoteId);
    const intent = q && this.ctx.store.intent(q.intentId);
    if (!q || !intent || intent.userId !== userId) fail("NOT_FOUND");
    const running = this.inflight.get(q.id);
    if (running) return running;
    if (q.result) return q.result;
    const run = this.decide(personal, intent, q).finally(() => this.inflight.delete(q.id));
    this.inflight.set(q.id, run);
    return run;
  }

  private async decide(personal: AuthedAgent, intent: IntentRow, q: QuoteRow): Promise<AcceptResult> {
    const agent = this.ctx.store.agent(q.agentId);
    if (!agent) fail("NOT_FOUND");
    const asMerchant: AuthedAgent = { ...agent, role: "merchant" };
    let result: AcceptResult;
    let gate: AcceptResult | undefined;
    if (Date.parse(intent.expiresAt) <= this.ctx.clock.now()) {
      gate = { status: "blocked", quoteId: q.id, code: "GRANT_EXPIRED", message: "This offer expired. Search again." };
    } else {
      try {
        this.sessions.access(asMerchant, q.sessionId, { intentId: intent.id });
      } catch (err) {
        if (!(err instanceof WorkspaceError)) throw err;
        gate = { status: "blocked", quoteId: q.id, code: err.code,
          message: err.code === "GRANT_REVOKED" ? "You cut this merchant off; nothing was sent." : "This offer expired. Search again." };
      }
    }
    if (gate) {
      result = gate;
    } else {
      this.ctx.store.markQuoteAccepted(q.id, this.ctx.clock.nowIso());
      this.ctx.log({ event: "quote.accept", actor: personal.agentId, object: q.id, result: "ok", reason: agent.agentId });
      const session = this.ctx.store.session(q.sessionId)!;
      if (agent.domain) {
        const widened = this.sessions.widen(session, intent.id, ["shipping_address"], "checkout");
        result = await this.ucpCheckout(asMerchant, q);
        if (result.status !== "ordered" && result.status !== "handoff") this.sessions.withdraw(widened.id);
      } else if (agent.callbackUrl) {
        const widened = this.sessions.widen(session, intent.id, ["shipping_address"], "checkout");
        const r = await this.ctx.delivery.callback(agent, { type: "accepted", sessionId: q.sessionId, quoteId: q.id });
        if (r.ok) {
          result = { status: "handoff", quoteId: q.id, ...(q.checkoutUrl ? { continueUrl: q.checkoutUrl } : {}),
            message: q.checkoutUrl ? "Finish and pay on the merchant's page." : "The merchant was notified and continues the checkout." };
        } else {
          this.sessions.withdraw(widened.id);
          result = { status: "failed", quoteId: q.id, code: "UPSTREAM_ERROR", message: "The merchant could not be reached; nothing was sent.",
            ...(q.checkoutUrl ? { continueUrl: q.checkoutUrl } : {}) };
        }
      } else {
        result = { status: "failed", quoteId: q.id, code: "UPSTREAM_ERROR", message: "This merchant cannot be reached; nothing was sent." };
      }
    }
    this.ctx.store.setQuoteResult(q.id, result);
    this.ctx.log({ event: "quote.result", actor: "workspace", object: q.id, result: result.status, reason: result.code ?? "" });
    return result;
  }

  /**
   * cart → checkout → address (purpose=checkout, receipt) → destination → complete. The address is read only once
   * the merchant has a live checkout for the chosen variant; any unrecoverable message (sold out) or cancel stops
   * the flow before the address leaves. Statuses are reported as they are (A18).
   */
  private async ucpCheckout(proxy: AuthedAgent, q: QuoteRow): Promise<AcceptResult> {
    const ucp = this.ctx.ucp;
    const receipts: Receipt[] = [];
    let co: UcpCheckout | undefined;
    let cartUrl: string | undefined;
    const url = () => co?.continueUrl ?? cartUrl ?? q.checkoutUrl;
    const withUrl = (r: AcceptResult): AcceptResult => (url() && r.continueUrl === undefined ? { ...r, continueUrl: url()! } : r);
    const stopped = (messages: UcpMessage[], status?: string) =>
      status === "canceled" || messages.some((m) => m.type === "error" && m.severity === "unrecoverable");
    const done = (r: AcceptResult): AcceptResult => (receipts.length > 0 ? { ...r, receipts } : r);
    // Warnings (low stock, sold-out notices) from any step reach the user verbatim, even when a later step does not
    // repeat them (plan T4: 售罄 warning 原样转给用户). Info messages are per-step state and are not carried.
    const warnings: UcpMessage[] = [];
    const heard = (ms: UcpMessage[]) => {
      for (const m of ms) if (m.type === "warning" && m.content && !warnings.some((w) => w.content === m.content)) warnings.push(m);
    };
    const say = (ms: UcpMessage[]) => messageText([...warnings.filter((w) => !ms.some((m) => m.content === w.content)), ...ms]);
    try {
      if (!q.variantId) throw new UpstreamError("quote has no variant");
      const cart = await ucp.createCart({ sellerDomain: proxy.domain!, variantId: q.variantId });
      cartUrl = cart.continueUrl;
      heard(cart.messages);
      if (stopped(cart.messages)) {
        return done(withUrl({ status: "failed", quoteId: q.id, code: "UPSTREAM_ERROR", message: say(cart.messages) ?? "The merchant refused the cart." }));
      }
      co = await ucp.createCheckout(cart);
      heard(co.messages);
      if (stopped(co.messages, co.status)) {
        return done(withUrl({ status: "failed", quoteId: q.id, code: "UPSTREAM_ERROR", message: say(co.messages) ?? `checkout ${co.status}` }));
      }
      // fixtures/README: a Sample address is never sent to a real store. In live mode, hand off before reading it.
      const onCard = this.card.values(this.ctx.store.session(q.sessionId)!.userId).shipping_address;
      if (this.ctx.config.ucpMode === "live" && onCard && /\bsample\b/i.test(onCard)) {
        return done(url()
          ? { status: "handoff", quoteId: q.id, continueUrl: url()!, message: "The card holds a Sample address, so none was sent. Enter a real address on the merchant's page." }
          : { status: "blocked", quoteId: q.id, code: "MISSING_FIELD", message: "The card holds a Sample address, so none was sent." });
      }
      const read = await this.fields.read(proxy, q.sessionId, ["shipping_address"], "checkout");
      if (read.receipt) receipts.push(read.receipt);
      const address = read.fields.shipping_address;
      if (!address) {
        return done(url()
          ? { status: "handoff", quoteId: q.id, continueUrl: url()!, message: "Add the shipping address on the merchant's page to finish." }
          : { status: "failed", quoteId: q.id, code: "UPSTREAM_ERROR", message: "No shipping address and no merchant page to finish on." });
      }
      co = await ucp.setDestination(co, parseAddress(address));
      heard(co.messages);
      if (stopped(co.messages, co.status)) {
        return done(withUrl({ status: "failed", quoteId: q.id, code: "UPSTREAM_ERROR", message: say(co.messages) ?? `checkout ${co.status}` }));
      }
      try {
        co = await ucp.complete(co);
      } catch (err) {
        // The checkout exists with the destination set; the store only refuses to finalize without the buyer.
        // That is the escalation case: the user pays on the merchant's page (handoff), not a failure.
        const u = err instanceof UpstreamError ? err.continueUrl ?? url() : undefined;
        if (err instanceof UpstreamError && u && needsBuyer(err.message)) {
          const result: AcceptResult = { status: "handoff", quoteId: q.id, continueUrl: u,
            message: [messageText(warnings), publicUpstreamMessage(err.message)].filter(Boolean).join(" ") };
          await this.lastOrder(proxy, q);
          return done(result);
        }
        throw err;
      }
    } catch (err) {
      if (err instanceof UpstreamError) {
        const u = err.continueUrl ?? url();
        return done({ status: "failed", quoteId: q.id, code: "UPSTREAM_ERROR",
          message: [messageText(warnings), publicUpstreamMessage(err.message)].filter(Boolean).join(" "), ...(u ? { continueUrl: u } : {}) });
      }
      if (err instanceof WorkspaceError) return done({ status: "blocked", quoteId: q.id, code: err.code, message: err.message });
      throw err;
    }
    const message = say(co.messages);
    let result: AcceptResult;
    if (stopped(co.messages, co.status)) {
      result = withUrl({ status: "failed", quoteId: q.id, code: "UPSTREAM_ERROR", message: message ?? `checkout ${co.status}` });
    } else if (co.status === "completed") {
      // Completed means the order exists; never tell the user to pay again, even without an order id.
      result = { status: "ordered", quoteId: q.id, orderId: co.orderId ?? co.checkoutId, message: message ?? "Order placed." };
    } else if (url()) {
      const why: Record<string, string> = {
        requires_escalation: "Review and pay on the merchant's page to finish the order.",
        complete_in_progress: "The merchant is still completing the order. Check its page before paying again.",
      };
      result = { status: "handoff", quoteId: q.id, continueUrl: url()!, message: message ?? why[co.status] ?? "Finish on the merchant's page." };
    } else {
      result = { status: "failed", quoteId: q.id, code: "UPSTREAM_ERROR", message: message ?? `checkout ended as ${co.status}` };
    }
    if (result.status === "ordered" || result.status === "handoff") await this.lastOrder(proxy, q);
    return done(result);
  }

  /** The proxy's own cookie note: what this returning customer ordered last (demo beat 2:05). */
  private async lastOrder(proxy: AuthedAgent, q: QuoteRow): Promise<void> {
    try {
      await this.notes.write(proxy, q.sessionId, "last_order", q.title ?? q.text);
    } catch (err) {
      this.ctx.log({ event: "note.write", actor: proxy.agentId, object: q.sessionId, result: "failed", reason: err instanceof WorkspaceError ? err.code : "error" });
    }
  }

}

export { overridable };
