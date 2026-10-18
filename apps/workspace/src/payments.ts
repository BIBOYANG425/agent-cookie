// Lane D payment stage (A21; plan §5 "支付：为什么不存卡号"). With AGENT_COOKIE_PAY=fake the workspace authorizes the
// price of a quote the user ACCEPTED, on the user's behalf, with the card's payment_method token reference, through
// @agent-cookie/pay's createPayments. On or off independently of the jar hooks (payment may be on while the jar is off).
//
// Provider slot: Visa (TAP payer-auth today; a Visa payment-authorization sandbox when credentials exist); Stripe not
// wired. The only provider today is @agent-cookie/pay's fakeProvider. The Visa leg that exists is the Trusted Agent
// Protocol signature lane D's hooks put on requests to merchants (services/delivery.ts); no Visa authorization call
// exists here.
//
// Hard rules kept: the token reference is read from the card here and goes only to the provider; the provider's
// reference stays in SQLite (payment_authorizations); merchants see the authorization RESULT (id, amount, status) and
// never either reference; every authorization writes a receipt with the amount (git first, then SQLite); single use
// per quote is a UNIQUE row, so it survives a restart. Everything here is deterministic code over stored rows.
import type { AuthorizePayment, Receipt } from "@agent-cookie/contract";
import {
  createPayments, fakeProvider,
  type InternalAuthorization, type PaymentContext, type PaymentProvider, type PaymentReceipt, type PaymentStore,
} from "@agent-cookie/pay";
import type { Clock } from "./clock.js";
import type { Config } from "./config.js";
import type { IntentRow, Store } from "./db.js";
import { isTokenReference } from "./guards.js";
import { newId } from "./ids.js";
import { parseBudgetCents } from "./ucp-filter.js";
import type { CardService } from "./services/card.js";
import { persistStrict, writeMeta, type Ctx } from "./services/context.js";

/** The configured provider, or undefined when payment is off (AGENT_COOKIE_PAY unset or "off"). */
export function paymentProvider(config: Config): PaymentProvider | undefined {
  return config.pay === "fake" ? fakeProvider() : undefined;
}

/** createPayments' store, on SQLite: authorizations and quote reservations survive a restart and are wiped by reset. */
export class SqlitePaymentStore implements PaymentStore {
  constructor(private store: Store, private clock: Clock) {}
  get(id: string): InternalAuthorization | undefined {
    return this.store.paymentAuthorization(id);
  }
  put(record: InternalAuthorization): void {
    this.store.putPaymentAuthorization(record);
  }
  findByQuote(quoteId: string): InternalAuthorization | undefined {
    return this.store.paymentAuthorizationForQuote(quoteId);
  }
  reserveQuote(quoteId: string, id: string): boolean {
    return this.store.reservePaymentQuote(quoteId, id, this.clock.nowIso());
  }
  releaseQuote(quoteId: string): void {
    this.store.releasePaymentQuote(quoteId);
  }
}

/**
 * The budget an authorization may not exceed, in integer cents (deterministic; never a model's number):
 *   1. the budget stated in the intent's own public values, if any;
 *   2. else the card's `budget`;
 *   3. else the quote's own price — the user accepted exactly that amount, so nothing above it is authorized.
 * Values are parsed with parseBudgetCents (dollars → cents), the same parser the search's hard budget filter uses;
 * an unparseable value counts as absent and the next rule applies.
 */
export function paymentBudgetCents(intent: Pick<IntentRow, "public">, cardBudget: string | undefined, quotePrice: number): number {
  return parseBudgetCents(intent.public.budget) ?? parseBudgetCents(cardBudget) ?? quotePrice;
}

/** deps.laneD.authorizePayment: createPayments over the workspace's own rows. */
export function createAuthorizePayment(ctx: Ctx, card: CardService, provider: PaymentProvider): AuthorizePayment {
  const { store, clock } = ctx;

  // Everything comes from stored rows; the caller's sessionId/quoteId are only keys. Missing anything → null (404).
  const getContext = async ({ sessionId, quoteId }: { sessionId: string; quoteId: string }): Promise<PaymentContext | null> => {
    const q = store.quote(quoteId);
    const session = store.session(sessionId);
    if (!q || !session || q.sessionId !== sessionId) return null;
    const intent = store.intent(q.intentId);
    if (!intent || intent.userId !== session.userId) return null;
    // The card itself (not overlaid by the intent): the token reference and the card's budget.
    const values = card.values(session.userId);
    const ref = values.payment_method;
    if (!ref || !isTokenReference(ref)) return null;
    return {
      // "accepted" = the user accepted this quote: accepted_at is set at accept and never cleared, while the status column
      // moves on to the accept's outcome (handoff, blocked, …) once it is decided.
      quoteStatus: q.acceptedAt ? "accepted" : q.status,
      quoteAgentId: q.agentId,
      sessionAgentId: session.agentId,
      budget: paymentBudgetCents(intent, values.budget, q.price),
      paymentMethodRef: ref,
    };
  };

  // "每次放行写回执": the same path as every other receipt — git first (persistStrict), then SQLite. Field name and
  // amount only; neither reference is in it.
  const onReceipt = async (r: PaymentReceipt): Promise<void> => {
    const q = store.quote(r.quoteId);
    const session = store.session(r.sessionId);
    if (!session) throw new Error("payment receipt for an unknown session");
    const receipt: Receipt = { id: newId("r"), sessionId: r.sessionId, agentId: r.agentId, fields: [...r.fields], purpose: r.purpose, amount: r.amount,
      createdAt: clock.nowIso(), ...(q ? { intentId: q.intentId } : {}), policyId: ctx.policy.id() };
    await persistStrict(ctx, "receipt", "workspace", (repo) => repo.appendReceipt(receipt, writeMeta(ctx, "workspace", receipt)));
    store.insertReceipt({ ...receipt, userId: session.userId });
  };

  return createPayments({ provider, getContext, onReceipt, store: new SqlitePaymentStore(store, clock), now: () => clock.now(),
    newId: () => newId("pa") }).authorizePayment;
}
