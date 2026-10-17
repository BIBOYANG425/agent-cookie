import { describe, expect, it } from "vitest";
import { allowedBases, autoFields, canRead, canWrite, purposeFields, readDecision } from "../src/policy.js";
import { FIELDS } from "../src/types.js";

describe("policy (plan v0.3 §5)", () => {
  it("auto fields allow with any purpose or none", () => {
    for (const f of ["lang", "tone", "length", "shoe_size", "budget", "deadline"] as const) {
      expect(canRead("shoe", f)).toBe("allow");
      expect(canRead("shoe", f, "anything")).toBe("allow");
    }
    expect(autoFields("shoe")).toEqual(["lang", "tone", "length", "shoe_size", "budget", "deadline"]);
    expect(autoFields("personal")).toEqual([...FIELDS]);
  });

  it("purpose fields allow only with the matching purpose", () => {
    expect(canRead("shoe", "shipping_address", "checkout")).toBe("allow");
    expect(canRead("shoe", "shipping_address", "browsing")).toBe("deny");
    expect(canRead("shoe", "shipping_address")).toBe("deny");
    expect(readDecision("shoe", "shipping_address", "browsing")).toBe("PURPOSE_MISMATCH");
    expect(readDecision("shoe", "shipping_address")).toBe("PURPOSE_MISMATCH");
    expect(purposeFields("shoe")).toEqual(["shipping_address", "payment_method"]);
    expect(purposeFields("personal")).toEqual([]);
  });

  it("unlisted combinations deny with SCOPE_DENIED, never PURPOSE_MISMATCH", () => {
    // personal has no purpose fields; a merchant category never reads something outside its two columns.
    expect(readDecision("personal", "shipping_address", "checkout")).toBe("allow"); // personal: everything is auto
    // There is no field outside shoe's columns in v0.3, so simulate the table's "deny" row through readMode on
    // a category/field pair that is deny by construction: a field name not in the table.
    expect(readDecision("shoe", "not_a_field" as never, "checkout")).toBe("SCOPE_DENIED");
    expect(canRead("shoe", "not_a_field" as never, "checkout")).toBe("deny");
  });

  it("payment_method is purpose=payment for every merchant category and never auto", () => {
    expect(canRead("shoe", "payment_method", "payment")).toBe("allow");
    expect(readDecision("shoe", "payment_method", "checkout")).toBe("PURPOSE_MISMATCH");
    expect(autoFields("shoe")).not.toContain("payment_method");
  });

  it("write policy: shoe writes only shoe_size as observed; personal writes everything, may state", () => {
    expect(canWrite("shoe", "shoe_size")).toBe(true);
    expect(canWrite("shoe", "shipping_address")).toBe(false);
    expect(canWrite("shoe", "budget")).toBe(false);
    expect(canWrite("shoe", "vip" as never)).toBe(false);
    for (const f of FIELDS) expect(canWrite("personal", f)).toBe(true);
    expect(allowedBases("shoe")).toEqual(["observed"]);
    expect(allowedBases("personal")).toEqual(["observed", "stated"]);
  });
});
