import { describe, expect, it } from "vitest";
import { canRead, canWrite, autoFields, purposeFields } from "../src/policy.js";

describe("policy", () => {
  it("auto fields allow with any purpose", () => {
    expect(canRead("shoe", "shoe_size")).toBe("allow");
    expect(canRead("shoe", "shoe_size", "anything")).toBe("allow");
  });
  it("purpose fields allow only with a matching purpose", () => {
    expect(canRead("shoe", "shipping_address", "checkout")).toBe("allow");
    expect(canRead("shoe", "shipping_address", "browsing")).toBe("PURPOSE_MISMATCH");
    expect(canRead("shoe", "shipping_address")).toBe("PURPOSE_MISMATCH");
    expect(canRead("pharmacy", "date_of_birth", "prescription")).toBe("allow");
  });
  it("unlisted combinations deny", () => {
    expect(canRead("shoe", "date_of_birth", "checkout")).toBe("SCOPE_DENIED");
    expect(canRead("pharmacy", "shoe_size")).toBe("SCOPE_DENIED");
  });
  it("write policy is per category", () => {
    expect(canWrite("shoe", "shoe_size")).toBe(true);
    expect(canWrite("shoe", "date_of_birth")).toBe(false);
    expect(canWrite("hotel", "budget")).toBe(false);
    expect(canWrite("personal", "diet")).toBe(true);
  });
  it("payment_method is purpose=payment for every merchant category", () => {
    for (const c of ["shoe", "pharmacy", "hotel"] as const) {
      expect(canRead(c, "payment_method", "payment")).toBe("allow");
      expect(canRead(c, "payment_method", "checkout")).toBe("PURPOSE_MISMATCH");
      expect(purposeFields(c)).toContain("payment_method");
      expect(autoFields(c)).not.toContain("payment_method");
    }
  });
});
