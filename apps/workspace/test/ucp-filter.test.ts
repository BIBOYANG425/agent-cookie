import { describe, expect, it } from "vitest";
import { parseAddress, parseBudgetCents, parseSize, sizeMatches } from "../src/ucp-filter.js";

describe("ucp-filter", () => {
  it("parses sizes across systems and matches EU 42 to US men's 8.5", () => {
    expect(parseSize("EU 42")).toEqual({ system: "EU", value: "42" });
    expect(parseSize("US 8.5")).toEqual({ system: "US", value: "8.5" });
    expect(parseSize("8.5")).toEqual({ system: "US", value: "8.5" });
    expect(parseSize("Large")).toBeUndefined();
    expect(sizeMatches(["8.5"], "42")).toBe(true);
    expect(sizeMatches(["US 9"], "42")).toBe(false);
    expect(sizeMatches(["42"], "42")).toBe(true);
    expect(sizeMatches(["EU 42"], "US 8.5")).toBe(true);
  });
  it("parses budgets to cents and one-line addresses to destinations", () => {
    expect(parseBudgetCents("120")).toBe(12000);
    expect(parseBudgetCents("$119.99")).toBe(11999);
    expect(parseBudgetCents("none")).toBeUndefined();
    expect(parseAddress("Sample User, 1234 Sample St, Apt 5, Los Angeles, CA 90024, US")).toEqual({
      name: "Sample User", line1: "1234 Sample St", line2: "Apt 5", city: "Los Angeles", region: "CA", postalCode: "90024", country: "US",
      raw: "Sample User, 1234 Sample St, Apt 5, Los Angeles, CA 90024, US" });
  });
});
