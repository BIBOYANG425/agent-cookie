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
  const quoteAuthorizationIds = new Map<string, string>();
  const authorizePayment: AuthorizePayment = async ({ sessionId, quoteId, amount, currency }) => {
    const context = await getContext({ sessionId, quoteId });
    if (!context) throw new LaneError("NOT_FOUND");
    if (context.quoteStatus !== "accepted" || context.quoteAgentId !== context.sessionAgentId) {
      throw new LaneError("SCOPE_DENIED");
    }
    if (currency !== "USD") throw new LaneError("SCOPE_DENIED");
    if (amount > context.budget) throw new LaneError("OVER_BUDGET");

    if (quoteAuthorizationIds.has(quoteId)) throw new LaneError("AUTHORIZATION_USED");

    const id = newId();
    quoteAuthorizationIds.set(quoteId, id);
    let authorization: { providerRef: string; status: "authorized" | "declined" };
    try {
      authorization = await provider.authorize({
        amount,
        currency,
        paymentMethodRef: context.paymentMethodRef,
        idempotencyKey: id,
      });
    } catch {
      quoteAuthorizationIds.delete(quoteId);
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

  get(id: string): InternalAuthorization | undefined {
    return this.records.get(id);
  }

  put(record: InternalAuthorization): void {
    this.records.set(record.id, record);
  }
}
