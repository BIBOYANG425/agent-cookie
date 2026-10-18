// Lane D payment stage (A21; plan §5 "支付：为什么不存卡号"). With AGENT_COOKIE_PAY=fake|visa the workspace authorizes the
// price of a quote the user ACCEPTED, on the user's behalf, with the card's payment_method token reference, through
// @agent-cookie/pay's createPayments. On or off independently of the jar hooks (payment may be on while the jar is off).
//
// Providers: "fake" is @agent-cookie/pay's fakeProvider; "visa" is its Visa Acceptance (Cybersource) REST provider
// against the sandbox host only (apitest.cybersource.com), with the card's payment_method holding `tms_<TMS
// payment-instrument id>`. Its request shapes were written offline and are marked UNVERIFIED in packages/pay/src/visa.ts.
// Stripe is present in @agent-cookie/pay but not wired. The other Visa leg is the Trusted Agent Protocol signature
// lane D's hooks put on requests to merchants (services/delivery.ts).
//
// A hold the store cannot consume is released: today's UCP adapter passes no payment to complete, so after complete the
// workspace reverses the authorization (reversePayment) and the result says no hold remains (services/commerce.ts).
//
// The provider receives the shipping address as the billing address for the authorization; this is the workspace acting
// for the user toward its own payment provider, logged by field name (`payment.authorize` reason
// `billto=shipping_address`), never a merchant release, so it writes no receipt.
//
// Hard rules kept: the token reference is read from the card here and goes only to the provider; the provider's
// reference stays in SQLite (payment_authorizations); merchants see the authorization RESULT (id, amount, status) and
// never either reference; every authorization writes a receipt with the amount (git first, then SQLite); single use
// per quote is a UNIQUE row, so it survives a restart. Everything here is deterministic code over stored rows.
import type { AuthorizePayment, Receipt, ReversePayment } from "@agent-cookie/contract";
import {
  createPayments, fakeProvider, visaProvider,
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
  if (config.pay === "fake") return fakeProvider();
  // loadConfig already required the three variables and refused any host but the sandbox; visaProvider checks again.
  if (config.pay === "visa" && config.visa) return visaProvider(config.visa);
  return undefined;
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

/** deps.laneD.authorizePayment and deps.laneD.reversePayment: createPayments over the workspace's own rows. */
export function createPaymentHooks(ctx: Ctx, card: CardService, provider: PaymentProvider): { authorizePayment: AuthorizePayment; reversePayment: ReversePayment } {
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

  const payments = createPayments({ provider, getContext, onReceipt, store: new SqlitePaymentStore(store, clock), now: () => clock.now(),
    newId: () => newId("pa") });
  return { authorizePayment: payments.authorizePayment, reversePayment: payments.reverseAuthorization };
}
