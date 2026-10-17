import { describe, expect, it } from "vitest";
import { parseSize, sizeMatches } from "../src/size.js";

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
});
