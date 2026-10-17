import { describe, expect, it } from "vitest";
import { buildTier0Prefix, renderHandshakePrefix } from "../src/tier0.js";
import type { Handshake } from "../src/types.js";

const H: Handshake = {
  v: 1, sessionId: "64qv2dfc", jar: "http://127.0.0.1:4310", lang: "zh", tone: "简短", length: "短",
  available: ["lang", "tone", "length", "shoe_size", "budget", "shipping_address"], expiresAt: "2026-10-17T12:10:00.000Z",
};

describe("contract: Tier 0 prefix (plan §1 接入阶梯, A15)", () => {
  it("carries the category's auto-field values and lists purpose fields by name only", () => {
    const text = renderHandshakePrefix(H, "shoe", { shoe_size: "42", budget: "120", shipping_address: "Sample: 1234 Sample St" });
    expect(text).toBe("[agent-cookie] session 64qv2dfc · lang zh · tone 简短 · length 短 · shoe_size 42 · budget 120 · on request: shipping_address(checkout)");
    expect(text).not.toContain("Sample St");
  });
  it("drops values for fields not in `available` and never emits a purpose field's value", () => {
    const p = buildTier0Prefix({ ...H, available: ["lang", "tone", "length"] }, "shoe", { shoe_size: "42", shipping_address: "x" });
    expect(p.auto.map((a) => a.field)).toEqual(["lang", "tone", "length"]);
    expect(p.onRequest).toEqual([]);
  });
});
