import { describe, expect, it } from "vitest";
import { LaneError } from "../src/contract.js";
import { createPayments, type InternalAuthorization, type PaymentStore } from "../src/payments.js";
import { fakeProvider, stripeProvider } from "../src/providers.js";

function setup({
  provider = fakeProvider(),
  quoteStatus = "accepted",
  quoteAgentId = "merchant-a",
  sessionAgentId = "merchant-a",
  budget = 5_000,
  captureReceipt,
}: {
  provider?: ReturnType<typeof fakeProvider>;
  quoteStatus?: string;
  quoteAgentId?: string;
  sessionAgentId?: string;
  budget?: number;
  captureReceipt?: (receipt: unknown) => void;
} = {}) {
  const receipts: unknown[] = [];
  let nextId = 0;
  const payments = createPayments({
    provider,
    getContext: async () => ({
      quoteStatus,
      quoteAgentId,
      sessionAgentId,
      budget,
      paymentMethodRef: "pm_card_visa",
    }),
    onReceipt: async (receipt) => {
      receipts.push(receipt);
      captureReceipt?.(receipt);
    },
    now: () => 1_700_000_000_000,
    newId: () => `authorization-${++nextId}`,
  });
  return { ...payments, provider, receipts };
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}

describe("payment authorization", () => {
  it("authorizes a quote, emits an amount receipt, and never exposes provider secrets", async () => {
    const payments = setup();
    const result = await payments.authorizePayment({
      sessionId: "session-a",
      quoteId: "quote-a",
      amount: 2_450,
      currency: "USD",
    });
    expect(payments.provider.authorizeCalls).toEqual([{
      amount: 2_450,
      currency: "USD",
      paymentMethodRef: "pm_card_visa",
      idempotencyKey: "authorization-1",
    }]);
    expect(payments.receipts).toEqual([{
      sessionId: "session-a",
      quoteId: "quote-a",
      agentId: "merchant-a",
      fields: ["payment_method"],
      purpose: "payment",
      amount: 2_450,
    }]);
    expect(JSON.stringify(result)).not.toContain("paymentMethodRef");
    expect(JSON.stringify(result)).not.toContain("providerRef");
    expect(JSON.stringify(payments.get(result.id))).not.toContain("paymentMethodRef");
    expect(JSON.stringify(payments.get(result.id))).not.toContain("providerRef");
    const captured = await payments.usePayment({
      authorizationId: result.id,
      agentId: "merchant-a",
    });
    expect(captured.status).toBe("used");
    expect(JSON.stringify(captured)).not.toContain("paymentMethodRef");
    expect(JSON.stringify(captured)).not.toContain("providerRef");
  });

  it("checks context, acceptance, merchant scope, budget and one authorization per quote", async () => {
    const noContext = createPayments({
      provider: fakeProvider(),
      getContext: async () => null,
      newId: () => "id",
    });
    await expectCode(noContext.authorizePayment({
      sessionId: "s",
      quoteId: "missing",
      amount: 100,
      currency: "USD",
    }), "NOT_FOUND");

    const wrongMerchant = setup({ quoteAgentId: "merchant-a", sessionAgentId: "merchant-b" });
    await expectCode(wrongMerchant.authorizePayment({
      sessionId: "s",
      quoteId: "q",
      amount: 100,
      currency: "USD",
    }), "SCOPE_DENIED");

    const unaccepted = setup({ quoteStatus: "pending" });
    await expectCode(unaccepted.authorizePayment({
      sessionId: "s",
      quoteId: "q",
      amount: 100,
      currency: "USD",
    }), "SCOPE_DENIED");

    const overBudget = setup({ budget: 99 });
    await expectCode(overBudget.authorizePayment({
      sessionId: "s",
      quoteId: "q",
      amount: 100,
      currency: "USD",
    }), "OVER_BUDGET");

    const invalidCurrency = setup();
    await expectCode(invalidCurrency.authorizePayment({
      sessionId: "s",
      quoteId: "q",
      amount: 100,
      currency: "EUR" as unknown as "USD",
    }), "SCOPE_DENIED");

    const duplicate = setup();
    const input = { sessionId: "s", quoteId: "q", amount: 100, currency: "USD" as const };
    await duplicate.authorizePayment(input);
    await expectCode(duplicate.authorizePayment(input), "AUTHORIZATION_USED");
  });

  it("keeps quote reservations in the shared store and releases failed reservations", async () => {
    const records = new Map<string, InternalAuthorization>();
    const reservations = new Map<string, string>();
    const store: PaymentStore = {
      get: (id) => records.get(id),
      put: (record) => { records.set(record.id, record); },
      findByQuote: (quoteId) => Array.from(records.values())
        .find((record) => record.quoteId === quoteId),
      reserveQuote: (quoteId, id) => {
        if (reservations.has(quoteId) || store.findByQuote(quoteId)) return false;
        reservations.set(quoteId, id);
        return true;
      },
      releaseQuote: (quoteId) => { reservations.delete(quoteId); },
    };
    const getContext = async () => ({
      quoteStatus: "accepted",
      quoteAgentId: "merchant-a",
      sessionAgentId: "merchant-a",
      budget: 1_000,
      paymentMethodRef: "pm_card_visa",
    });
    const input = { sessionId: "s", quoteId: "shared-quote", amount: 100, currency: "USD" as const };
    const first = createPayments({
      provider: fakeProvider(),
      getContext,
      store,
      newId: () => "first-authorization",
    });
    const second = createPayments({
      provider: fakeProvider(),
      getContext,
      store,
      newId: () => "second-authorization",
    });
    await first.authorizePayment(input);
    await expectCode(second.authorizePayment(input), "AUTHORIZATION_USED");

    let shouldFail = true;
    const retryable = createPayments({
      provider: {
        authorize: async () => {
          if (shouldFail) {
            shouldFail = false;
            throw new Error("temporary provider failure");
          }
          return { providerRef: "provider-ref", status: "authorized" };
        },
        capture: async () => {},
      },
      getContext,
      newId: () => "retry-authorization",
    });
    const retryInput = { ...input, quoteId: "retry-quote" };
    await expectCode(retryable.authorizePayment(retryInput), "UPSTREAM_ERROR");
    await expect(retryable.authorizePayment(retryInput)).resolves.toMatchObject({
      status: "authorized",
    });
  });

  it("declines upstream and prevents repeated capture with concurrent calls", async () => {
    const declined = setup({ provider: fakeProvider({ decline: true }) });
    const denied = await declined.authorizePayment({
      sessionId: "s",
      quoteId: "q",
      amount: 100,
      currency: "USD",
    });
    expect(denied.status).toBe("declined");
    expect(declined.receipts).toEqual([]);
    await expectCode(
      declined.usePayment({ authorizationId: denied.id, agentId: "merchant-a" }),
      "UPSTREAM_ERROR",
    );

    const success = setup();
    const authorized = await success.authorizePayment({
      sessionId: "s",
      quoteId: "q",
      amount: 100,
      currency: "USD",
    });
    const results = await Promise.allSettled([
      success.usePayment({ authorizationId: authorized.id, agentId: "merchant-a" }),
      success.usePayment({ authorizationId: authorized.id, agentId: "merchant-a" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(success.provider.captureCalls).toHaveLength(1);
    await expectCode(
      success.usePayment({ authorizationId: authorized.id, agentId: "merchant-a" }),
      "AUTHORIZATION_USED",
    );
  });

  it("maps unknown, wrong-agent and provider-capture errors to lane errors", async () => {
    const failedCapture = setup({ provider: fakeProvider({ captureError: true }) });
    const authorized = await failedCapture.authorizePayment({
      sessionId: "s",
      quoteId: "q",
      amount: 100,
      currency: "USD",
    });
    await expectCode(
      failedCapture.usePayment({ authorizationId: authorized.id, agentId: "wrong" }),
      "SCOPE_DENIED",
    );
    await expectCode(
      failedCapture.usePayment({ authorizationId: "missing", agentId: "merchant-a" }),
      "NOT_FOUND",
    );
    await expectCode(
      failedCapture.usePayment({ authorizationId: authorized.id, agentId: "merchant-a" }),
      "UPSTREAM_ERROR",
    );
    expect(failedCapture.get(authorized.id)?.status).toBe("authorized");
  });
});

describe.skipIf(!process.env.STRIPE_SECRET_KEY)("Stripe integration", () => {
  it("authorizes and captures with pm_card_visa", async () => {
    const payments = createPayments({
      provider: stripeProvider({ secretKey: process.env.STRIPE_SECRET_KEY! }),
      getContext: async () => ({
        quoteStatus: "accepted",
        quoteAgentId: "merchant",
        sessionAgentId: "merchant",
        budget: 500,
        paymentMethodRef: "pm_card_visa",
      }),
      newId: () => `lane-d-${Date.now()}`,
    });
    const authorized = await payments.authorizePayment({
      sessionId: "stripe-session",
      quoteId: `stripe-quote-${Date.now()}`,
      amount: 100,
      currency: "USD",
    });
    expect(["authorized", "declined"]).toContain(authorized.status);
    if (authorized.status === "authorized") {
      await expect(
        payments.usePayment({ authorizationId: authorized.id, agentId: "merchant" }),
      ).resolves.toMatchObject({ status: "used" });
    }
  });
});

it("includes the lane error HTTP status", () => {
  expect(new LaneError("OVER_BUDGET").status).toBe(403);
});
