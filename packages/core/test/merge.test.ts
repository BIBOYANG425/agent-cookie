import { describe, expect, it } from "vitest";
import { daysBetween, mergeCard } from "../src/merge.js";
import type { Basis, Contribution, Field } from "../src/types.js";

const NOW = "2026-10-17T12:00:00.000Z";
const USER = "u_sample";
const PERSONAL = "ag_personal";
const STORE_A = "ucp:asics.com";
const STORE_B = "ucp:brooksrunning.com";
const STORE_C = "ucp:clarks.com";
const STORE_D = "ucp:dsw.com";

let seq = 0;
function c(
  agentId: string,
  field: Field,
  value: string,
  basis: Basis,
  createdAt: string,
  extra: Partial<Contribution> = {},
): Contribution {
  seq += 1;
  return { id: `c_${seq}`, userId: USER, agentId, field, value, basis, createdAt, ...extra };
}

function daysAgo(days: number, from = NOW): string {
  return new Date(Date.parse(from) - days * 86_400_000).toISOString();
}

describe("mergeCard (plan v0.3 §4 T0 merge rules)", () => {
  it("A02: two agents agreeing → card high; one merchant observation → candidate; inferred → never on card", () => {
    const res = mergeCard(
      [
        c(STORE_A, "lang", "en", "observed", daysAgo(10)),
        c(PERSONAL, "lang", "en", "stated", daysAgo(5)),
        c(STORE_A, "budget", "150", "observed", daysAgo(3)),
        c(STORE_A, "tone", "casual", "inferred", daysAgo(3)),
        c(STORE_B, "tone", "casual", "inferred", daysAgo(2)),
        c(STORE_C, "tone", "casual", "inferred", daysAgo(1)),
      ],
      { now: NOW, personalAgentIds: [PERSONAL] },
    );

    expect(res.card).toEqual([
      {
        field: "lang",
        value: "en",
        confidence: "high",
        sources: [PERSONAL, STORE_A],
        updatedAt: daysAgo(10),
        lastSupportedAt: daysAgo(5),
        changedRecently: false,
      },
    ]);
    // Output follows FIELDS order (tone before budget), then value.
    expect(res.candidates).toEqual([
      { field: "tone", value: "casual", sources: [STORE_A, STORE_B, STORE_C], reason: "inferred" },
      { field: "budget", value: "150", sources: [STORE_A], reason: "single_source" },
    ]);
    expect(res.superseded).toEqual([]);
  });

  it("personal stated alone → card medium; merchant observed alone → candidate; revoked rows are ignored", () => {
    const stated = mergeCard([c(PERSONAL, "shoe_size", "42", "stated", daysAgo(1))], { now: NOW, personalAgentIds: [PERSONAL] });
    expect(stated.card).toEqual([
      {
        field: "shoe_size",
        value: "42",
        confidence: "medium",
        sources: [PERSONAL],
        updatedAt: daysAgo(1),
        lastSupportedAt: daysAgo(1),
        changedRecently: false,
      },
    ]);
    expect(stated.candidates).toEqual([]);

    // Without personalAgentIds every "stated" counts as personal (policy forbids merchants from stating).
    expect(mergeCard([c(PERSONAL, "shoe_size", "42", "stated", daysAgo(1))], { now: NOW }).card).toHaveLength(1);
    // With personalAgentIds, a merchant "stating" does not qualify by itself.
    expect(mergeCard([c(STORE_A, "shoe_size", "42", "stated", daysAgo(1))], { now: NOW, personalAgentIds: [PERSONAL] }).card).toEqual([]);

    const merchantOnly = mergeCard([c(STORE_A, "shoe_size", "42", "observed", daysAgo(1))], { now: NOW, personalAgentIds: [PERSONAL] });
    expect(merchantOnly.card).toEqual([]);
    expect(merchantOnly.candidates).toEqual([{ field: "shoe_size", value: "42", sources: [STORE_A], reason: "single_source" }]);

    // Two sources put it on the card; revoking one drops it back to a candidate.
    const two = [c(STORE_A, "shoe_size", "42", "observed", daysAgo(4)), c(STORE_B, "shoe_size", "42", "observed", daysAgo(2))];
    expect(mergeCard(two, { now: NOW }).card[0]).toMatchObject({ value: "42", confidence: "high", sources: [STORE_A, STORE_B] });
    const revoked = mergeCard([two[0]!, { ...two[1]!, revokedAt: daysAgo(1) }], { now: NOW });
    expect(revoked.card).toEqual([]);
    expect(revoked.candidates).toEqual([{ field: "shoe_size", value: "42", sources: [STORE_A], reason: "single_source" }]);
    expect(revoked.superseded).toEqual([]);

    // Unknown field names never reach the card or the candidates.
    const injected = { ...c(STORE_A, "lang", "true", "observed", daysAgo(1)), field: "vip" as Field };
    expect(mergeCard([injected], { now: NOW })).toEqual({ card: [], candidates: [], superseded: [] });

    // `now` is mandatory: the merge never reads the system clock.
    expect(() => mergeCard([], {} as never)).toThrow(/now/);
    expect(() => mergeCard([], undefined as never)).toThrow(/now/);
    expect(() => mergeCard([], { now: "yesterday" })).toThrow(/now/);
  });

  it("time rules: newest supported value wins, superseded kept in history, second source restores high; 180/365-day decay", () => {
    const lastYearA = "2025-06-01T10:00:00.000Z";
    const lastYearB = "2025-07-01T10:00:00.000Z";
    const thisWeekC = "2026-10-15T09:00:00.000Z";
    const thisWeekD = "2026-10-16T09:00:00.000Z";

    const base = [
      c(STORE_A, "shoe_size", "42", "observed", lastYearA),
      c(STORE_B, "shoe_size", "42", "observed", lastYearB),
      c(STORE_C, "shoe_size", "43", "observed", thisWeekC),
    ];
    const flipped = mergeCard(base, { now: NOW, personalAgentIds: [PERSONAL] });
    expect(flipped.card).toEqual([
      {
        field: "shoe_size",
        value: "43",
        confidence: "medium",
        sources: [STORE_C],
        updatedAt: thisWeekC,
        lastSupportedAt: thisWeekC,
        changedRecently: true,
      },
    ]);
    expect(flipped.candidates).toEqual([]);
    expect(flipped.superseded).toEqual([
      { field: "shoe_size", value: "42", sources: [STORE_A, STORE_B], lastSupportedAt: lastYearB, supersededBy: "43" },
    ]);

    const confirmed = mergeCard([...base, c(STORE_D, "shoe_size", "43", "observed", thisWeekD)], { now: NOW });
    expect(confirmed.card).toEqual([
      {
        field: "shoe_size",
        value: "43",
        confidence: "high",
        sources: [STORE_C, STORE_D],
        updatedAt: thisWeekC,
        lastSupportedAt: thisWeekD,
        changedRecently: false,
      },
    ]);
    expect(confirmed.superseded).toEqual([
      { field: "shoe_size", value: "42", sources: [STORE_A, STORE_B], lastSupportedAt: lastYearB, supersededBy: "43" },
    ]);

    // Decay: > 180 days → medium even with two sources.
    const stale = mergeCard(
      [c(STORE_A, "lang", "en", "observed", daysAgo(230)), c(STORE_B, "lang", "en", "observed", daysAgo(200))],
      { now: NOW },
    );
    expect(stale.card).toEqual([
      {
        field: "lang",
        value: "en",
        confidence: "medium",
        sources: [STORE_A, STORE_B],
        updatedAt: daysAgo(230),
        lastSupportedAt: daysAgo(200),
        changedRecently: false,
      },
    ]);
    // Exactly 180 days is not "more than 180".
    expect(mergeCard([c(STORE_A, "lang", "en", "observed", daysAgo(180)), c(STORE_B, "lang", "en", "observed", daysAgo(180))], { now: NOW }).card[0]?.confidence).toBe("high");

    // > 365 days → off the card, not a candidate, kept in history with an empty supersededBy.
    const dropped = mergeCard(
      [c(STORE_A, "lang", "en", "observed", daysAgo(420)), c(STORE_B, "lang", "en", "observed", daysAgo(400))],
      { now: NOW },
    );
    expect(dropped.card).toEqual([]);
    expect(dropped.candidates).toEqual([]);
    expect(dropped.superseded).toEqual([
      { field: "lang", value: "en", sources: [STORE_A, STORE_B], lastSupportedAt: daysAgo(400), supersededBy: "" },
    ]);

    // The same inputs with a different clock give a different answer: the clock is the only variable.
    const earlier = mergeCard(
      [c(STORE_A, "lang", "en", "observed", daysAgo(420)), c(STORE_B, "lang", "en", "observed", daysAgo(400))],
      { now: daysAgo(300) },
    );
    expect(earlier.card[0]).toMatchObject({ value: "en", confidence: "high" });

    expect(daysBetween(daysAgo(400), NOW)).toBeCloseTo(400, 6);
    expect(daysBetween(NOW, daysAgo(1))).toBeCloseTo(-1, 6);
  });

  it("A11: a merchant's inferred value never displaces a high card value and shows only as that merchant's candidate", () => {
    const res = mergeCard(
      [
        c(STORE_A, "shoe_size", "42", "observed", daysAgo(30)),
        c(STORE_B, "shoe_size", "42", "observed", daysAgo(20)),
        c(STORE_C, "shoe_size", "45", "inferred", daysAgo(1)),
      ],
      { now: NOW, personalAgentIds: [PERSONAL] },
    );
    expect(res.card).toEqual([
      {
        field: "shoe_size",
        value: "42",
        confidence: "high",
        sources: [STORE_A, STORE_B],
        updatedAt: daysAgo(30),
        lastSupportedAt: daysAgo(20),
        changedRecently: false,
      },
    ]);
    expect(res.candidates).toEqual([{ field: "shoe_size", value: "45", sources: [STORE_C], reason: "inferred" }]);
    expect(res.superseded).toEqual([]);

    // Even three merchants inferring the same value do not make it qualified.
    const pileOn = mergeCard(
      [
        c(STORE_A, "shoe_size", "45", "inferred", daysAgo(3)),
        c(STORE_B, "shoe_size", "45", "inferred", daysAgo(2)),
        c(STORE_C, "shoe_size", "45", "inferred", daysAgo(1)),
      ],
      { now: NOW },
    );
    expect(pileOn.card).toEqual([]);
    expect(pileOn.candidates).toEqual([{ field: "shoe_size", value: "45", sources: [STORE_A, STORE_B, STORE_C], reason: "inferred" }]);
  });

  it("is deterministic: output order follows FIELDS then value, regardless of input order", () => {
    const rows = [
      c(STORE_A, "budget", "200", "observed", daysAgo(2)),
      c(STORE_A, "budget", "100", "observed", daysAgo(3)),
      c(STORE_A, "lang", "zh", "observed", daysAgo(1)),
      c(STORE_B, "lang", "en", "observed", daysAgo(9)),
      c(STORE_A, "lang", "en", "observed", daysAgo(8)),
      c(PERSONAL, "tone", "direct", "stated", daysAgo(1)),
    ];
    const forward = mergeCard(rows, { now: NOW, personalAgentIds: [PERSONAL] });
    const backward = mergeCard([...rows].reverse(), { now: NOW, personalAgentIds: [PERSONAL] });
    expect(backward).toEqual(forward);
    expect(forward.card.map((f) => `${f.field}=${f.value}`)).toEqual(["lang=zh", "tone=direct"]);
    expect(forward.card[0]).toMatchObject({ confidence: "medium", changedRecently: true, updatedAt: daysAgo(1) });
    expect(forward.superseded).toEqual([
      { field: "lang", value: "en", sources: [STORE_A, STORE_B], lastSupportedAt: daysAgo(8), supersededBy: "zh" },
    ]);
    expect(forward.candidates.map((x) => `${x.field}=${x.value}`)).toEqual(["budget=100", "budget=200"]);
  });
});

describe("mergeCard — personal stated is sticky against a lone merchant observation", () => {
  const NOW2 = "2026-10-17T12:00:00.000Z";
  const mk = (agentId: string, value: string, basis: Basis, createdAt: string): Contribution => ({
    id: `s_${agentId}_${value}_${createdAt}`, userId: "u_sample", agentId, field: "shoe_size", value, basis, createdAt,
  });
  const dAgo = (d: number) => new Date(Date.parse(NOW2) - d * 86_400_000).toISOString();

  it("the user's own statement stays on the card when one store later observes something else", () => {
    const res = mergeCard(
      [mk("ag_personal", "43", "stated", dAgo(30)), mk("ucp:asics.com", "42", "observed", dAgo(2))],
      { now: NOW2, personalAgentIds: ["ag_personal"] },
    );
    expect(res.card).toEqual([
      expect.objectContaining({ field: "shoe_size", value: "43", confidence: "medium", changedRecently: false }),
    ]);
    expect(res.candidates).toEqual([{ field: "shoe_size", value: "42", sources: ["ucp:asics.com"], reason: "single_source" }]);
    expect(res.superseded).toEqual([]);
  });

  it("but two stores agreeing later do replace it (newest qualified value wins), and it stays in history", () => {
    const res = mergeCard(
      [
        mk("ag_personal", "43", "stated", dAgo(30)),
        mk("ucp:asics.com", "42", "observed", dAgo(2)),
        mk("ucp:brooksrunning.com", "42", "observed", dAgo(1)),
      ],
      { now: NOW2, personalAgentIds: ["ag_personal"] },
    );
    expect(res.card[0]).toEqual(expect.objectContaining({ value: "42", confidence: "high", changedRecently: false }));
    expect(res.superseded).toEqual([
      { field: "shoe_size", value: "43", sources: ["ag_personal"], lastSupportedAt: dAgo(30), supersededBy: "42" },
    ]);
  });
});
