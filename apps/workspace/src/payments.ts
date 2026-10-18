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
//
// Simulated provenance (lane D, D1): when the provider is lane D's Visa Acceptance simulator (apps/visa-sim, loopback,
// VISA_ACCEPTANCE_SIMULATOR=1), every authorization it answers and its payment receipt carry `provider: "Visa
// Acceptance simulator"` and `simulated: true`. The marks are fixed on the row when the authorization is first recorded
// and read back from it on every later result (reversal, a re-asked accept, after a restart), whatever the provider is
// by then.
import { PAYMENT_SIMULATOR_LABEL, type AuthorizePayment, type PaymentAuthorization, type Receipt, type ReversePayment } from "@agent-cookie/contract";
import {
  createPayments, fakeProvider, visaProvider,
  type InternalAuthorization, type PaymentContext, type PaymentProvider, type PaymentReceipt, type PaymentStore,
} from "@agent-cookie/pay";
import type { Clock } from "./clock.js";
import type { Config } from "./config.js";
import type { IntentRow, PaymentProvenance, Store } from "./db.js";
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

const SIMULATED: PaymentProvenance = { provider: PAYMENT_SIMULATOR_LABEL, simulated: true };

/** The marks a record carries, checked: both or nothing, and only the known simulator. */
export function provenanceOf(x: { provider?: unknown; simulated?: unknown } | undefined): PaymentProvenance {
  return x?.simulated === true && x.provider === PAYMENT_SIMULATOR_LABEL ? { ...SIMULATED } : {};
}

/**
 * D1: the marks the configured provider puts on what it answers. Lane D's visaProvider marks itself `label: "Visa
 * Acceptance simulator", simulated: true` on the simulator origin; the workspace's own config pointing at the simulator
 * marks it too. Either is enough, so a simulated authorization is never shown unmarked. Read structurally: a provider
 * type that predates the marks does not declare them.
 */
export function providerProvenance(provider: PaymentProvider, config: Config): PaymentProvenance {
  const marks = provider as { label?: unknown; simulated?: unknown };
  return marks.simulated === true || marks.label === PAYMENT_SIMULATOR_LABEL || config.visa?.simulator ? { ...SIMULATED } : {};
}

/** createPayments' store, on SQLite: authorizations and quote reservations survive a restart and are wiped by reset. */
export class SqlitePaymentStore implements PaymentStore {
  /** `provenance`: the marks of the provider answering now (providerProvenance). */
  constructor(private store: Store, private clock: Clock, private provenance: PaymentProvenance = {}) {}
  get(id: string): InternalAuthorization | undefined {
    return this.store.paymentAuthorization(id);
  }
  /**
   * The marks are the provider's that answered: fixed when the authorization is first recorded (the current provider's,
   * or the record's own when it is marked) and kept from the row on every later write (used, reversed).
   */
  put(record: InternalAuthorization): void {
    const recorded = this.store.paymentAuthorization(record.id);
    const { provider: _provider, simulated: _simulated, ...rest } = record;
    const marks = recorded ? provenanceOf(recorded) : this.provenance.simulated ? this.provenance : provenanceOf(record);
    this.store.putPaymentAuthorization({ ...rest, ...marks });
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

/**
 * deps.laneD.authorizePayment and deps.laneD.reversePayment: createPayments over the workspace's own rows.
 * `paymentProvenance`: the configured provider's marks (commerce.ts tells the user and the log a simulator answered).
 */
export function createPaymentHooks(ctx: Ctx, card: CardService, provider: PaymentProvider):
  { authorizePayment: AuthorizePayment; reversePayment: ReversePayment; paymentProvenance: PaymentProvenance } {
  const { store, clock } = ctx;
  const provenance = providerProvenance(provider, ctx.config);
  // Every result leaves with the marks of its stored row (createPayments' own result may not carry them).
  const marked = (a: PaymentAuthorization): PaymentAuthorization => {
    const row = store.paymentAuthorization(a.id);
    const { provider: _provider, simulated: _simulated, ...rest } = a;
    return { ...rest, ...provenanceOf(row ?? a) };
  };

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
    // The authorization's row is recorded before its receipt (createPayments): its marks are the receipt's.
    const row = store.paymentAuthorizationForQuote(r.quoteId);
    const receipt: Receipt = { id: newId("r"), sessionId: r.sessionId, agentId: r.agentId, fields: [...r.fields], purpose: r.purpose, amount: r.amount,
      createdAt: clock.nowIso(), ...(q ? { intentId: q.intentId } : {}), policyId: ctx.policy.id(), ...(row ? provenanceOf(row) : provenance) };
    await persistStrict(ctx, "receipt", "workspace", (repo) => repo.appendReceipt(receipt, writeMeta(ctx, "workspace", receipt)));
    store.insertReceipt({ ...receipt, userId: session.userId });
  };

  const payments = createPayments({ provider, getContext, onReceipt, store: new SqlitePaymentStore(store, clock, provenance), now: () => clock.now(),
    newId: () => newId("pa") });
  return {
    authorizePayment: async (a) => marked(await payments.authorizePayment(a)),
    reversePayment: async (a) => {
      const r = await payments.reverseAuthorization(a);
      return { ...r, authorization: marked(r.authorization) };
    },
    paymentProvenance: provenance,
  };
}
