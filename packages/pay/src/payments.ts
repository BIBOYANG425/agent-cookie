import { randomUUID } from "node:crypto";
import type { AuthorizePayment, PaymentAuthorization, ReversePayment } from "./contract.js";
import { LaneError } from "./contract.js";
import type { PaymentProvider } from "./providers.js";

export interface PaymentContext {
  quoteStatus: string;
  quoteAgentId: string;
  sessionAgentId: string;
  budget: number;
  paymentMethodRef: string;
}

export interface PaymentReceipt {
  sessionId: string;
  /** The accepted quote the authorization is for (the workspace attributes the receipt to its intent). */
  quoteId: string;
  agentId: string;
  fields: ["payment_method"];
  purpose: "payment";
  amount: number;
}

export interface InternalAuthorization extends PaymentAuthorization {
  providerRef: string;
  paymentMethodRef: string;
  agentId: string;
  /**
   * Integer cents the provider's response authorized (the requested amount when the response does not say). What a
   * reversal releases. Internal like providerRef: never in the public result. Absent on rows written before it existed.
   */
  authorizedAmount?: number;
}

export interface PaymentStore {
  get(id: string): InternalAuthorization | undefined;
  put(record: InternalAuthorization): void;
  findByQuote(quoteId: string): InternalAuthorization | undefined;
  reserveQuote(quoteId: string, id: string): boolean;
  releaseQuote(quoteId: string): void;
}

const publicAuthorization = (record: InternalAuthorization): PaymentAuthorization => ({
  id: record.id,
  sessionId: record.sessionId,
  quoteId: record.quoteId,
  amount: record.amount,
  currency: record.currency,
  status: record.status,
  createdAt: record.createdAt,
});

export function createPayments({
  provider,
  getContext,
  onReceipt,
  now = Date.now,
  newId = randomUUID,
  store = new MapPaymentStore(),
}: {
  provider: PaymentProvider;
  getContext: (input: { sessionId: string; quoteId: string }) => Promise<PaymentContext | null>;
  onReceipt?: (receipt: PaymentReceipt) => void | Promise<void>;
  now?: () => number;
  newId?: () => string;
  store?: PaymentStore;
}): {
  authorizePayment: AuthorizePayment;
  usePayment: (input: { authorizationId: string; agentId: string }) => Promise<PaymentAuthorization>;
  reverseAuthorization: ReversePayment;
  get: (id: string) => PaymentAuthorization | undefined;
} {
  if (provider.simulated) {
    throw new LaneError("SCOPE_DENIED", "Visa Acceptance simulator: workspace provenance contract not wired");
  }
  const authorizePayment: AuthorizePayment = async ({ sessionId, quoteId, amount, currency, billTo }) => {
    const context = await getContext({ sessionId, quoteId });
    if (!context) throw new LaneError("NOT_FOUND");
    if (context.quoteStatus !== "accepted" || context.quoteAgentId !== context.sessionAgentId) {
      throw new LaneError("SCOPE_DENIED");
    }
    if (currency !== "USD") throw new LaneError("SCOPE_DENIED");
    if (amount > context.budget) throw new LaneError("OVER_BUDGET");

    if (store.findByQuote(quoteId)) throw new LaneError("AUTHORIZATION_USED");
    const id = newId();
    if (!store.reserveQuote(quoteId, id)) throw new LaneError("AUTHORIZATION_USED");
    let authorization: { providerRef: string; status: "authorized" | "declined"; authorizedAmount?: number };
    try {
      authorization = await provider.authorize({
        amount,
        currency,
        paymentMethodRef: context.paymentMethodRef,
        idempotencyKey: id,
        ...(billTo ? { billTo } : {}),
      });
    } catch {
      store.releaseQuote(quoteId);
      throw new LaneError("UPSTREAM_ERROR");
    }
    const record: InternalAuthorization = {
      id,
      sessionId,
      quoteId,
      amount,
      currency: "USD",
      status: authorization.status,
      createdAt: new Date(now()).toISOString(),
      providerRef: authorization.providerRef,
      paymentMethodRef: context.paymentMethodRef,
      agentId: context.quoteAgentId,
      ...(authorization.status === "authorized" ? { authorizedAmount: authorization.authorizedAmount ?? amount } : {}),
    };
    store.put(record);

    if (record.status === "authorized") {
      try {
        await onReceipt?.({
          sessionId,
          quoteId,
          agentId: context.quoteAgentId,
          fields: ["payment_method"],
          purpose: "payment",
          amount,
        });
      } catch {
        // No authorization stands without its receipt: undo the hold (best effort), mark the record reversed when the
        // provider confirmed, and fail the call. A failed or missing reversal leaves the record authorized, so the
        // caller can see that a hold may remain. The receipt hook's own error is dropped (it may carry paths).
        if (provider.reverse) {
          try {
            await provider.reverse(record.providerRef, record.authorizedAmount ?? record.amount, record.currency);
            record.status = "reversed";
            store.put(record);
          } catch {
            // best effort
          }
        }
        throw new LaneError("UPSTREAM_ERROR", "the payment receipt could not be written; the authorization was not kept");
      }
    }
    return publicAuthorization(record);
  };

  // Reversals in flight, by authorization id: concurrent calls share one provider call, and a capture cannot start
  // while one runs. The record turns `reversed` only once the provider confirmed.
  const reversing = new Map<string, ReturnType<ReversePayment>>();

  const usePayment = async ({
    authorizationId,
    agentId,
  }: {
    authorizationId: string;
    agentId: string;
  }): Promise<PaymentAuthorization> => {
    const record = store.get(authorizationId);
    if (!record) throw new LaneError("NOT_FOUND");
    if (record.agentId !== agentId) throw new LaneError("SCOPE_DENIED");
    if (record.status === "declined") throw new LaneError("UPSTREAM_ERROR");
    // A reversed authorization holds nothing any more: it is spent like a used one.
    if (record.status === "used" || record.status === "reversed") throw new LaneError("AUTHORIZATION_USED");
    if (reversing.has(record.id)) throw new LaneError("AUTHORIZATION_USED");

    record.status = "used";
    store.put(record);
    try {
      await provider.capture(record.providerRef, record.amount, record.currency);
    } catch {
      record.status = "authorized";
      store.put(record);
      throw new LaneError("UPSTREAM_ERROR");
    }
    return publicAuthorization(record);
  };

  /**
   * Release the hold of an authorization nobody took (the store did not consume the delegated payment). Calls
   * `provider.reverse` once when the provider has it and marks the record `reversed`; a provider without it leaves the
   * record `authorized` and says so (`not_supported`). A provider failure leaves the record `authorized` and throws
   * UPSTREAM_ERROR with no provider text. Reversing a reversed authorization returns it without a provider call.
   */
  const reverseAuthorization: ReversePayment = ({ authorizationId }) => {
    const running = reversing.get(authorizationId);
    if (running) return running;
    const run = (async () => {
      const record = store.get(authorizationId);
      if (!record) throw new LaneError("NOT_FOUND");
      if (record.status === "reversed") return { authorization: publicAuthorization(record), outcome: "reversed" as const };
      // Captured: a refund, not a reversal. Declined: nothing is held.
      if (record.status === "used") throw new LaneError("AUTHORIZATION_USED");
      if (record.status !== "authorized") throw new LaneError("SCOPE_DENIED");
      if (!provider.reverse) return { authorization: publicAuthorization(record), outcome: "not_supported" as const };
      try {
        // The amount the authorization response authorized (less than requested on a partial approval).
        await provider.reverse(record.providerRef, record.authorizedAmount ?? record.amount, record.currency);
      } catch {
        throw new LaneError("UPSTREAM_ERROR");
      }
      record.status = "reversed";
      store.put(record);
      return { authorization: publicAuthorization(record), outcome: "reversed" as const };
    })().finally(() => reversing.delete(authorizationId));
    reversing.set(authorizationId, run);
    return run;
  };

  return {
    authorizePayment,
    usePayment,
    reverseAuthorization,
    get: (id) => {
      const record = store.get(id);
      return record ? publicAuthorization(record) : undefined;
    },
  };
}

class MapPaymentStore implements PaymentStore {
  private readonly records = new Map<string, InternalAuthorization>();
  private readonly quoteReservations = new Map<string, string>();

  get(id: string): InternalAuthorization | undefined {
    return this.records.get(id);
  }

  put(record: InternalAuthorization): void {
    this.records.set(record.id, record);
  }

  findByQuote(quoteId: string): InternalAuthorization | undefined {
    return Array.from(this.records.values()).find((record) => record.quoteId === quoteId);
  }

  reserveQuote(quoteId: string, id: string): boolean {
    if (this.quoteReservations.has(quoteId) || this.findByQuote(quoteId)) return false;
    this.quoteReservations.set(quoteId, id);
    return true;
  }

  releaseQuote(quoteId: string): void {
    this.quoteReservations.delete(quoteId);
  }
}
