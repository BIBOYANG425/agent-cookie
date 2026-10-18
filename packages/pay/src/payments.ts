import { randomUUID } from "node:crypto";
import type { AuthorizePayment, PaymentAuthorization } from "./contract.js";
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
  get: (id: string) => PaymentAuthorization | undefined;
} {
  const authorizePayment: AuthorizePayment = async ({ sessionId, quoteId, amount, currency }) => {
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
    let authorization: { providerRef: string; status: "authorized" | "declined" };
    try {
      authorization = await provider.authorize({
        amount,
        currency,
        paymentMethodRef: context.paymentMethodRef,
        idempotencyKey: id,
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
    };
    store.put(record);

    if (record.status === "authorized") {
      await onReceipt?.({
        sessionId,
        quoteId,
        agentId: context.quoteAgentId,
        fields: ["payment_method"],
        purpose: "payment",
        amount,
      });
    }
    return publicAuthorization(record);
  };

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
    if (record.status === "used") throw new LaneError("AUTHORIZATION_USED");

    record.status = "used";
    store.put(record);
    try {
      await provider.capture(record.providerRef);
    } catch {
      record.status = "authorized";
      store.put(record);
      throw new LaneError("UPSTREAM_ERROR");
    }
    return publicAuthorization(record);
  };

  return {
    authorizePayment,
    usePayment,
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
