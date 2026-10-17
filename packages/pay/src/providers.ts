import Stripe from "stripe";

export interface PaymentProvider {
  authorize(input: {
    amount: number;
    currency: "USD";
    paymentMethodRef: string;
    idempotencyKey: string;
  }): Promise<{ providerRef: string; status: "authorized" | "declined" }>;
  capture(providerRef: string): Promise<void>;
}

export interface FakePaymentProvider extends PaymentProvider {
  authorizeCalls: Array<{
    amount: number;
    currency: "USD";
    paymentMethodRef: string;
    idempotencyKey: string;
  }>;
  captureCalls: string[];
}

export function fakeProvider({
  decline = false,
  captureError = false,
}: {
  decline?: boolean;
  captureError?: boolean;
} = {}): FakePaymentProvider {
  const authorizeCalls: FakePaymentProvider["authorizeCalls"] = [];
  const captureCalls: string[] = [];
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
    authorizeCalls,
    captureCalls,
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
