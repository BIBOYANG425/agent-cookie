import Stripe from "stripe";
import type { PaymentBillTo } from "./contract.js";

export interface PaymentAuthorizeInput {
  /** Integer cents. */
  amount: number;
  currency: "USD";
  /** The card's payment_method token reference; it goes to the provider and nowhere else. */
  paymentMethodRef: string;
  idempotencyKey: string;
  /** Optional billing address for providers that check it (Visa Acceptance billTo). Never card data. */
  billTo?: PaymentBillTo;
}

export interface PaymentProvider {
  /** Simulation provenance; never a claim that Visa's servers accepted a request. */
  label?: "Visa Acceptance simulator";
  simulated?: true;
  authorize(input: PaymentAuthorizeInput): Promise<{
    label?: "Visa Acceptance simulator";
    simulated?: true;
    providerRef: string;
    status: "authorized" | "declined";
    /** A provider's decline reason CODE only (never its message text); internal, never shown to a merchant. */
    reason?: string;
    /**
     * Integer cents the provider's RESPONSE says it authorized, when it says (Visa Acceptance
     * orderInformation.amountDetails.authorizedAmount). A reversal must name this amount, not the requested one.
     */
    authorizedAmount?: number;
  }>;
  /** `amount`/`currency` (additive): the authorized amount, for providers whose capture names it (Visa Acceptance). */
  capture(providerRef: string, amount?: number, currency?: "USD"): Promise<void>;
  /**
   * Optional (additive): release an unused authorization's hold. `amount` is the amount the authorization response
   * authorized (createPayments passes the recorded `authorizedAmount`). A provider without it cannot release holds.
   */
  reverse?(providerRef: string, amount: number, currency: "USD"): Promise<void>;
}

export interface FakePaymentProvider extends PaymentProvider {
  authorizeCalls: PaymentAuthorizeInput[];
  captureCalls: string[];
  reverseCalls: Array<{ providerRef: string; amount: number; currency: "USD" }>;
}

export function fakeProvider({
  decline = false,
  captureError = false,
  reverseError = false,
}: {
  decline?: boolean;
  captureError?: boolean;
  reverseError?: boolean;
} = {}): FakePaymentProvider {
  const authorizeCalls: FakePaymentProvider["authorizeCalls"] = [];
  const captureCalls: string[] = [];
  const reverseCalls: FakePaymentProvider["reverseCalls"] = [];
  return {
    authorize: async (input) => {
      authorizeCalls.push({ ...input });
      return {
        providerRef: `fake_pi_${input.idempotencyKey}`,
        status: decline ? "declined" : "authorized",
      };
    },
    capture: async (providerRef) => {
      captureCalls.push(providerRef);
      if (captureError) throw new Error("fake capture failure");
    },
    // A recorded call, so the workspace's reversal path runs the same way with the fake provider as with Visa.
    reverse: async (providerRef, amount, currency) => {
      reverseCalls.push({ providerRef, amount, currency });
      if (reverseError) throw new Error("fake reverse failure");
    },
    authorizeCalls,
    captureCalls,
    reverseCalls,
  };
}

export function stripeProvider({ secretKey }: { secretKey: string }): PaymentProvider {
  if (!secretKey.startsWith("sk_test_")) {
    throw new Error("Stripe test-mode secret key required");
  }
  const stripe = new Stripe(secretKey);
  return {
    authorize: async ({ amount, currency, paymentMethodRef, idempotencyKey }) => {
      try {
        const intent = await stripe.paymentIntents.create(
          {
            amount,
            currency: currency.toLowerCase(),
            payment_method: paymentMethodRef,
            confirm: true,
            capture_method: "manual",
            automatic_payment_methods: { enabled: true, allow_redirects: "never" },
          },
          { idempotencyKey },
        );
        return {
          providerRef: intent.id,
          status: intent.status === "requires_capture" ? "authorized" : "declined",
        };
      } catch (error) {
        if (error instanceof Stripe.errors.StripeCardError) {
          return {
            providerRef: error.payment_intent?.id ?? `declined_${idempotencyKey}`,
            status: "declined",
          };
        }
        throw error;
      }
    },
    capture: async (providerRef) => {
      await stripe.paymentIntents.capture(providerRef);
    },
  };
}
