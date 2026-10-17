import { describe, expect, it } from "vitest";
import { base32, deriveSessionId, merchantKeyFor } from "../src/session.js";

const SECRET = "sample-user-secret-do-not-use";

describe("session (A03, A22)", () => {
  it("is deterministic: same user + same merchantKey → same 8-char id, across resets and re-registrations", () => {
    const a = deriveSessionId(SECRET, "shoebacca.com");
    const b = deriveSessionId(SECRET, "shoebacca.com");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-hj-km-np-tv-z]{8}$/);
  });

  it("is pairwise: two merchants get different ids and neither is derivable from the other", () => {
    const a = deriveSessionId(SECRET, "shoebacca.com");
    const b = deriveSessionId(SECRET, "marathonsports.com");
    expect(a).not.toBe(b);
    // No shared prefix structure: the ids share no positional characters beyond chance.
    const c = deriveSessionId(SECRET, "shoebacca.com.");
    expect(c).not.toBe(a);
    // Different users never collide on the same merchant.
    expect(deriveSessionId("other-secret", "shoebacca.com")).not.toBe(a);
  });

  it("merchantKey prefers domain over agentId (UCP proxies survive re-registration)", () => {
    expect(merchantKeyFor({ agentId: "ucp:shoebacca.com", domain: "shoebacca.com" })).toBe("shoebacca.com");
    expect(merchantKeyFor({ agentId: "ag_abc" })).toBe("ag_abc");
    expect(deriveSessionId(SECRET, merchantKeyFor({ agentId: "ucp:x", domain: "shoebacca.com" })))
      .toBe(deriveSessionId(SECRET, merchantKeyFor({ agentId: "ucp:y", domain: "shoebacca.com" })));
    expect(() => deriveSessionId("", "x")).toThrow();
    expect(base32(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff]))).toBe("zzzzzzzz");
  });
});
