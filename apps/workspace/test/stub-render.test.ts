import { describe, expect, it } from "vitest";
import {
  appendContributionLine,
  contributionsFileName,
  parseCard,
  parseContributions,
  parseMemoryLine,
  parseNoteFile,
  parseReceipts,
  renderCard,
  renderContribution,
  renderContributionsFile,
  renderNoteFile,
  renderPolicyYaml,
  renderReceipt,
} from "../src/stubs/render.js";
import { autoFields } from "@agent-cookie/contract";
import type { Card, Contribution, Note, Receipt } from "@agent-cookie/contract";

const USER = "u_sample";
const AGENT = "ucp:shoebacca.com";

const contributions: Contribution[] = [
  { id: "c_0001", userId: USER, agentId: AGENT, field: "shoe_size", value: "42", basis: "observed", createdAt: "2026-10-01T09:00:00Z" },
  { id: "c_0002", userId: USER, agentId: AGENT, field: "budget", value: ", [brackets]: and colons", basis: "stated", createdAt: "2026-10-02T09:00:00Z" },
  { id: "c_0003", userId: USER, agentId: AGENT, field: "tone", value: "简短，别客套：直接说 [重点]", basis: "stated", createdAt: "2026-10-03T09:00:00Z" },
  { id: "c_0004", userId: USER, agentId: AGENT, field: "lang", value: "zh", basis: "inferred", createdAt: "2026-10-04T09:00:00Z", revokedAt: "2026-10-05T10:00:00Z" },
];

describe("render (T0-9, plan §1 memory layout)", () => {
  it("contributions: render → parse is lossless; append keeps earlier bytes identical", () => {
    expect(renderContribution(contributions[0]!)).toBe(
      "- shoe_size: 42 [id: c_0001; basis: observed; at: 2026-10-01T09:00:00Z]",
    );
    expect(renderContribution(contributions[3]!)).toBe(
      "- lang: zh [id: c_0004; basis: inferred; at: 2026-10-04T09:00:00Z; revoked: 2026-10-05T10:00:00Z]",
    );

    const md = renderContributionsFile(USER, AGENT, contributions);
    expect(md.startsWith(`# Contributions · ${AGENT}\n<!-- agentId: ${AGENT}; userId: ${USER}; append only; Sample data where marked -->\n`)).toBe(true);
    expect(md.endsWith("]\n")).toBe(true);
    expect(md.endsWith("\n\n")).toBe(false);
    expect(parseContributions(md, USER, AGENT)).toEqual(contributions);

    // append: earlier content is a byte-identical prefix, exactly one trailing newline, parses to n+1
    const fifth: Contribution = { id: "c_0005", userId: USER, agentId: AGENT, field: "deadline", value: "2026-10-20", basis: "observed", createdAt: "2026-10-06T09:00:00Z" };
    const appended = appendContributionLine(md, fifth);
    expect(appended.startsWith(md)).toBe(true);
    expect(appended.slice(md.length)).toBe(renderContribution(fifth) + "\n");
    expect(parseContributions(appended, USER, AGENT)).toEqual([...contributions, fifth]);
    // appending onto a header-only file equals rendering the file with that one line
    expect(appendContributionLine(renderContributionsFile(USER, AGENT, []), fifth)).toBe(renderContributionsFile(USER, AGENT, [fifth]));
    // a file whose trailing newline was lost still appends cleanly
    expect(parseContributions(appendContributionLine(md.trimEnd(), fifth), USER, AGENT)).toHaveLength(5);

    // defensive: non-Field keys and malformed lines are dropped, headers/comments ignored
    const dirty = md + "- vip: true [id: c_0009; basis: observed; at: 2026-10-07T00:00:00Z]\n- shoe_size: 43 [id: c_0010; basis: guessed; at: 2026-10-07T00:00:00Z]\n# not a record\n";
    expect(parseContributions(dirty, USER, AGENT)).toEqual(contributions);

    expect(contributionsFileName("ucp:shoebacca.com")).toBe("ucp_shoebacca.com.md");
    expect(contributionsFileName("personal")).toBe("personal.md");
    expect(contributionsFileName("a b/../c")).toBe("a_b_.._c.md");
  });

  it("card: renderCard → parseCard is lossless; an empty Card renders _none_ sections and parses to empty arrays", () => {
    const card: Card = {
      card: [
        { field: "shoe_size", value: "43", confidence: "medium", sources: ["ucp:shoebacca.com"], updatedAt: "2026-10-10T08:00:00Z", lastSupportedAt: "2026-10-10T08:00:00Z", changedRecently: true },
        { field: "lang", value: "zh", confidence: "high", sources: ["personal", "ucp:shoebacca.com"], updatedAt: "2026-09-01T08:00:00Z", lastSupportedAt: "2026-10-01T08:00:00Z", changedRecently: false },
        { field: "shipping_address", value: "Sample: 1 Market St, Apt 4; San Francisco, CA 94105 [buzz 12]", confidence: "medium", sources: ["personal"], updatedAt: "2026-10-05T08:00:00Z", lastSupportedAt: "2026-10-05T08:00:00Z", changedRecently: false },
      ],
      candidates: [
        { field: "budget", value: "120", sources: ["ucp:marathonsports.com"], reason: "single_source" },
        { field: "deadline", value: "2026-10-20", sources: ["ucp:shoebacca.com", "ucp:marathonsports.com"], reason: "inferred" },
      ],
      superseded: [
        { field: "shoe_size", value: "42", sources: ["ucp:marathonsports.com", "ucp:shoebacca.com"], lastSupportedAt: "2025-11-01T08:00:00Z", supersededBy: "43" },
      ],
    };
    const meta = { userId: USER, generatedAt: "2026-10-17T12:00:00Z" };
    const md = renderCard(card, meta);

    expect(md.startsWith(`# CARD · ${USER}\n<!-- Generated by the workspace from contributions/*.md. Do not edit. -->\n<!-- generatedAt: ${meta.generatedAt} -->\n`)).toBe(true);
    expect(md).toContain("\n## Card\n- shoe_size: 43 [confidence: medium; sources: ucp:shoebacca.com; updatedAt: 2026-10-10T08:00:00Z; lastSupportedAt: 2026-10-10T08:00:00Z; changedRecently: true]\n");
    expect(md).toContain("\n## Candidates\n- budget: 120 [reason: single_source; sources: ucp:marathonsports.com]\n");
    expect(md).toContain("\n## Superseded\n- shoe_size: 42 [sources: ucp:marathonsports.com, ucp:shoebacca.com; lastSupportedAt: 2025-11-01T08:00:00Z; supersededBy: 43]\n");
    expect(parseCard(md)).toEqual(card);

    // the one attribute that carries a field value (supersededBy) survives ";", "]" and "[" via percent-escape;
    // an age-dropped value (merge writes supersededBy "") round-trips too
    const tricky: Card = {
      card: [],
      candidates: [],
      superseded: [
        { field: "shipping_address", value: "old; [addr]", sources: ["personal"], lastSupportedAt: "2025-01-01T00:00:00Z", supersededBy: "Sample: 1 Market St; Apt 4 [buzz 12] 100%" },
        { field: "budget", value: "90", sources: ["personal", "x"], lastSupportedAt: "2024-01-01T00:00:00Z", supersededBy: "" },
      ],
    };
    expect(parseCard(renderCard(tricky, meta))).toEqual(tricky);

    const empty: Card = { card: [], candidates: [], superseded: [] };
    const emptyMd = renderCard(empty, meta);
    expect(emptyMd).toContain("## Card\n_none_\n");
    expect(emptyMd).toContain("## Candidates\n_none_\n");
    expect(emptyMd).toContain("## Superseded\n_none_\n");
    expect(emptyMd.endsWith("_none_\n")).toBe(true);
    expect(parseCard(emptyMd)).toEqual(empty);

    // defensive: lines outside a known section, unknown fields, bad enums are dropped
    const dirty = emptyMd
      .replace("## Card\n_none_", "## Card\n- vip: true [confidence: high; sources: a; updatedAt: t; lastSupportedAt: t; changedRecently: false]\n- lang: zh [confidence: certain; sources: a; updatedAt: t; lastSupportedAt: t; changedRecently: false]")
      + "\n## Other\n- lang: en [confidence: high; sources: a; updatedAt: t; lastSupportedAt: t; changedRecently: false]\n";
    expect(parseCard(dirty)).toEqual(empty);
  });

  it("notes + receipts round-trip; POLICY.yaml comes from the policy table", () => {
    const notes: Note[] = [
      { agentId: AGENT, userId: USER, key: "last_order", value: "Cascadia 19", updatedAt: "2026-06-02T10:00:00Z", expiresAt: "2027-06-02T10:00:00Z" },
      { agentId: AGENT, userId: USER, key: "loyalty.tier", value: "silver: 2 orders [2026]", updatedAt: "2026-10-01T10:00:00Z", expiresAt: "2027-10-01T10:00:00Z" },
      { agentId: AGENT, userId: USER, key: "empty", value: "", updatedAt: "2026-10-01T10:00:00Z", expiresAt: "2027-10-01T10:00:00Z" },
    ];
    const noteMd = renderNoteFile("k7f2abcd", AGENT, notes);
    expect(noteMd).toContain("\n- last_order: Cascadia 19 [updatedAt: 2026-06-02T10:00:00Z; expiresAt: 2027-06-02T10:00:00Z]\n");
    expect(noteMd.startsWith("# Note · k7f2abcd\n")).toBe(true);
    expect(parseNoteFile(noteMd, AGENT, USER)).toEqual(notes);
    expect(parseNoteFile(renderNoteFile("k7f2abcd", AGENT, []), AGENT, USER)).toEqual([]);
    // multi-line values collapse to one line (one record per line, by design)
    const multi: Note = { ...notes[0]!, value: "line one\nline two" };
    expect(parseNoteFile(renderNoteFile("k7f2abcd", AGENT, [multi]), AGENT, USER)[0]!.value).toBe("line one line two");
    // a key that cannot be read back is refused, never silently mangled
    expect(() => renderNoteFile("k7f2abcd", AGENT, [{ ...notes[0]!, key: "bad: key" }])).toThrow();
    expect(() => renderNoteFile("k7f2abcd", AGENT, [{ ...notes[0]!, key: "" }])).toThrow();

    const receipts: Receipt[] = [
      { id: "r_0001", sessionId: "k7f2abcd", agentId: AGENT, fields: ["shipping_address"], purpose: "checkout", createdAt: "2026-10-17T12:00:00Z" },
      { id: "r_0002", sessionId: "k7f2abcd", agentId: AGENT, fields: ["shoe_size", "budget"], purpose: "", createdAt: "2026-10-17T12:01:00Z" },
      { id: "r_0003", sessionId: "p93xwxyz", agentId: "ucp:marathonsports.com", fields: ["payment_method"], purpose: "payment", amount: 119.95, createdAt: "2026-10-17T12:02:00Z" },
    ];
    const lines = receipts.map(renderReceipt);
    expect(lines[0]).toBe("- receipt: ucp:shoebacca.com read shipping_address [id: r_0001; session: k7f2abcd; purpose: checkout; at: 2026-10-17T12:00:00Z]");
    expect(lines[2]).toBe("- receipt: ucp:marathonsports.com read payment_method [id: r_0003; session: p93xwxyz; purpose: payment; at: 2026-10-17T12:02:00Z; amount: 119.95]");
    const receiptsMd = "# Receipts\n<!-- append only -->\n\n" + lines.join("\n") + "\n";
    expect(parseReceipts(receiptsMd)).toEqual(receipts);
    expect(parseReceipts(receiptsMd)[2]!.amount).toBe(119.95);
    expect(parseReceipts(receiptsMd)[0]!).not.toHaveProperty("amount");

    const yaml = renderPolicyYaml();
    expect(yaml.startsWith("# Generated from @agent-cookie/core policy table. Do not edit.\n")).toBe(true);
    const shoeBlock = yaml.slice(yaml.indexOf("\nshoe:\n") + 1);
    expect(shoeBlock).toContain("    shipping_address: [checkout]\n");
    expect(shoeBlock).toContain("    payment_method: [payment]\n");
    expect(shoeBlock).toContain(`  auto: [${autoFields("shoe").join(", ")}]\n`);
    expect(shoeBlock).toContain("  write: [shoe_size]\n");
    expect(shoeBlock).toContain("  bases: [observed]\n");
    const personalBlock = yaml.slice(yaml.indexOf("\npersonal:\n") + 1, yaml.indexOf("\nshoe:\n") + 1);
    expect(personalBlock).toContain("  purpose: {}\n");
    expect(personalBlock).toContain("  bases: [observed, stated]\n");
    expect(yaml.indexOf("personal:")).toBeLessThan(yaml.indexOf("shoe:"));
  });

  it("line grammar: the attribute block is the last ' [...]'; values keep ':' ',' '[' ']' and unicode; non-records are null", () => {
    expect(parseMemoryLine("- budget: , [brackets]: and colons [id: c_0002; basis: stated; at: 2026-10-02T09:00:00Z]")).toEqual({
      key: "budget",
      value: ", [brackets]: and colons",
      attrs: { id: "c_0002", basis: "stated", at: "2026-10-02T09:00:00Z" },
    });
    expect(parseMemoryLine("- k:  [a: b]")).toEqual({ key: "k", value: "", attrs: { a: "b" } });
    expect(parseMemoryLine("- k: v []")).toEqual({ key: "k", value: "v", attrs: {} });
    expect(parseMemoryLine("- k: v")).toEqual({ key: "k", value: "v", attrs: {} });
    expect(parseMemoryLine("- k: 日本語 [x: 1; empty: ]\r")).toEqual({ key: "k", value: "日本語", attrs: { x: "1", empty: "" } });
    expect(parseMemoryLine("# Contributions · a")).toBeNull();
    expect(parseMemoryLine("<!-- comment -->")).toBeNull();
    expect(parseMemoryLine("_none_")).toBeNull();
    expect(parseMemoryLine("- _none_")).toBeNull();
    expect(parseMemoryLine("")).toBeNull();
  });
});
