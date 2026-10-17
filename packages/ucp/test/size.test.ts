import { describe, expect, it } from "vitest";
import { parseSize, sizeMatch, sizeMatches } from "../src/size.js";

describe("parseSize", () => {
  it.each([
    ["9 US", { system: "US", value: "9" }],
    ["US 9", { system: "US", value: "9" }],
    ["9.5 US M", { system: "US", value: "9.5" }],
    ["US M 9.5", { system: "US", value: "9.5" }],
    ["US 9.5 M", { system: "US", value: "9.5" }],
    ["M 9.5", { system: "US", value: "9.5" }],
    ["Men's 8.5", { system: "US", value: "8.5" }],
    ["Mens 9.5", { system: "US", value: "9.5" }],
    ["9.5 Mens", { system: "US", value: "9.5" }],
    ["EU 42", { system: "EU", value: "42" }],
    ["42 EU", { system: "EU", value: "42" }],
    ["EUR 42", { system: "EU", value: "42" }],
    ["42", { system: "EU", value: "42" }],
    ["9", { system: "US", value: "9" }],
  ])("parses %s", (raw, expected) => {
    expect(parseSize(raw)).toEqual(expected);
  });

  it.each(["UK 8", "8 UK", "W 8", "8 W", "Women's 8", "9 US 42 EU"])(
    "rejects %s",
    (raw) => expect(parseSize(raw)).toBeUndefined(),
  );
});

describe("sizeMatches", () => {
  it.each([
    [["8.5 US"], "42", true],
    [["42"], "8.5", true],
    [["9 US"], "42", false],
    [["US 11"], "42", false],
    [["9"], "42", false],
    [["9 US"], "9", true],
    [["42.5"], "9", true],
    [["9 US / 42.5 EU"], "42.5", true],
    [["UK 8"], "42", false],
    [["9.0 US"], "9", true],
  ])("matches %j against %s: %s", (options, cardSize, expected) => {
    expect(sizeMatches(options, cardSize)).toBe(expected);
  });

  it("treats variants without a size option as eligible", () => {
    expect(sizeMatches([], "10")).toBe(true);
    expect(sizeMatches(["O/S"], "10")).toBe(true);
  });
});

describe("sizeMatch", () => {
  it.each([
    [["XXS"], "XXS", "match"],
    [["X-Small"], "XS", "match"],
    [["S"], "Small", "match"],
    [["Medium"], "M", "match"],
    [["Large"], "L", "match"],
    [["X-Large"], "XL", "match"],
    [["Extra Large"], "XL", "match"],
    [["Extra Small"], "XS", "match"],
    [["Extra small (XS)"], "XS", "match"],
    [["XX-Large"], "2XL", "match"],
    [["XXL"], "2XL", "match"],
    [["3XL"], "XXXL", "match"],
    [["S"], "M", "mismatch"],
    [["M"], "M", "match"],
    [["M 9.5"], "9.5", "match"],
    [["M 9.5"], "M", "mismatch"],
    [["10"], "10", "match"],
    [["32"], "32", "match"],
    [["10"], "S", "mismatch"],
    [["S"], "10", "mismatch"],
    [["S/M"], "M", "match"],
  ] as const)("matches %j against %s: %s", (options, requested, expected) => {
    expect(sizeMatch(options, requested)).toBe(expected);
  });

  it.each(["One Size", "OS", "O/S", "OSFA", "One Size Fits All", "Default Title", "N/A"])(
    "recognizes %s as no-size",
    (option) => expect(sizeMatch([option], "10")).toBe("no-size"),
  );

  it("returns no-size for an empty option list and mismatch for an unparseable request", () => {
    expect(sizeMatch([], "10")).toBe("no-size");
    expect(sizeMatch([], "not a size")).toBe("mismatch");
    expect(sizeMatch(["M"], "not a size")).toBe("mismatch");
  });
});
