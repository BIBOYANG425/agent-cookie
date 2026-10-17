import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { merchantKeyFor, SESSION_ID_VECTORS } from "../src/apis.js";
import { UpstreamError, WorkspaceError } from "../src/errors.js";

// Reference implementation of the normative algorithm in RulesApi.deriveSessionId, kept inside the test so the
// vectors are checked against the written rule, not against any one package.
const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";
function reference(userSecret: string, merchantKey: string): string {
  const mac = createHmac("sha256", Buffer.from(userSecret, "utf8")).update(Buffer.from(merchantKey, "utf8")).digest();
  let bits = "";
  for (const b of mac) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i < bits.length; i += 5) out += CROCKFORD[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return out.slice(0, 8);
}

describe("contract: RulesApi.deriveSessionId conformance vectors (A03, A22)", () => {
  it("every vector matches the normative algorithm", () => {
    for (const v of SESSION_ID_VECTORS) expect(reference(v.userSecret, v.merchantKey)).toBe(v.sessionId);
  });
  it("vectors are pairwise: distinct merchants and distinct users never share an id", () => {
    const ids = SESSION_ID_VECTORS.map((v) => v.sessionId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[0-9a-hjkmnp-tv-z]{8}$/);
  });
  it("merchantKey = domain ?? agentId (UCP proxies survive re-registration)", () => {
    expect(merchantKeyFor({ agentId: "ucp:shoebacca.com", domain: "shoebacca.com" })).toBe("shoebacca.com");
    expect(merchantKeyFor({ agentId: "shoe-acme" })).toBe("shoe-acme");
  });
});

describe("contract: errors", () => {
  it("UpstreamError is a 502 UPSTREAM_ERROR and carries continueUrl only when given", () => {
    const e = new UpstreamError("ucp checkout failed", "https://shoebacca.com/checkouts/x");
    expect(e).toBeInstanceOf(WorkspaceError);
    expect(e.status).toBe(502);
    expect(e.toBody()).toEqual({ error: { code: "UPSTREAM_ERROR", message: "ucp checkout failed" }, continueUrl: "https://shoebacca.com/checkouts/x" });
    expect(new UpstreamError("down").toBody()).toEqual({ error: { code: "UPSTREAM_ERROR", message: "down" } });
  });
});
