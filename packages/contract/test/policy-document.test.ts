// Phase 1 (docs/commerce-analytics-plan.md): the policy document must give exactly the decisions the frozen table gave
// on 2026-10-18 — captured below as a GOLDEN snapshot, generated from readDecision/canWrite before the inversion —
// and the floor must reject every dangerous single edit while allowing the harmless ones.
import { describe, expect, it } from "vitest";
import {
  canonicalPolicy, DEFAULT_POLICY, evaluateRead, evaluateWrite, isPolicyDocument, policyAutoFields, policyHistory, policyId, policyPurposeFields,
  policyPurposesFor, policyViolations, STYLE_FIELDS, type PolicyDocument,
} from "../src/policy-document.js";
import { autoFields, canWrite, purposeFields, purposesFor, readDecision } from "../src/policy.js";
import { FIELDS, type Category, type Field } from "../src/types.js";

// A = allow, P = PURPOSE_MISMATCH, S = SCOPE_DENIED; one letter per field in FIELDS order; W = writable.
const GOLDEN = {
  fields: ["lang", "tone", "length", "shoe_size", "budget", "deadline", "shipping_address", "payment_method", "pref.brand", "pref.color",
    "pref.material", "pref.style", "pref.fit", "pref.avoid", "pref.occasion", "pref.recipient", "pref.price_band", "pref.size_system"],
  read: {
    personal: { "-": "AAAAAAAAAAAAAAAAAA", checkout: "AAAAAAAAAAAAAAAAAA", payment: "AAAAAAAAAAAAAAAAAA", tier0: "AAAAAAAAAAAAAAAAAA", bogus: "AAAAAAAAAAAAAAAAAA" },
    shoe: { "-": "AAAAAAPPSSSSSSSSSS", checkout: "AAAAAAAPSSSSSSSSSS", payment: "AAAAAAPASSSSSSSSSS", tier0: "AAAAAAPPSSSSSSSSSS", bogus: "AAAAAAPPSSSSSSSSSS" },
    retail: { "-": "AAAAAAPPAAAAAAAAAA", checkout: "AAAAAAAPAAAAAAAAAA", payment: "AAAAAAPAAAAAAAAAAA", tier0: "AAAAAAPPAAAAAAAAAA", bogus: "AAAAAAPPAAAAAAAAAA" },
  },
  write: { personal: "WWWWWWWWWWWWWWWWWW", shoe: "...W..............", retail: "...W.............." },
} as const;
const CATS = ["personal", "shoe", "retail"] as const;
const PURPOSES: Array<[string, string | undefined]> = [["-", undefined], ["checkout", "checkout"], ["payment", "payment"], ["tier0", "tier0"], ["bogus", "bogus"]];
const letter = (d: string) => (d === "allow" ? "A" : d === "PURPOSE_MISMATCH" ? "P" : "S");

const clone = (): PolicyDocument => structuredClone(DEFAULT_POLICY);

describe("policy document · golden (decisions identical to the frozen table)", () => {
  it("the field list has not moved under the snapshot", () => {
    expect([...FIELDS]).toEqual([...GOLDEN.fields]);
  });
  it("evaluateRead(DEFAULT_POLICY) and readDecision give the snapshot for every category × field × purpose", () => {
    for (const c of CATS) {
      for (const [key, p] of PURPOSES) {
        const expected = GOLDEN.read[c][key as keyof (typeof GOLDEN.read)[typeof c]];
        expect(FIELDS.map((f) => letter(evaluateRead(DEFAULT_POLICY, c, f, p))).join(""), `evaluateRead ${c} ${key}`).toBe(expected);
        expect(FIELDS.map((f) => letter(readDecision(c, f, p))).join(""), `readDecision ${c} ${key}`).toBe(expected);
      }
      expect(FIELDS.map((f) => (evaluateWrite(DEFAULT_POLICY, c, f) ? "W" : ".")).join("")).toBe(GOLDEN.write[c]);
      expect(FIELDS.map((f) => (canWrite(c, f) ? "W" : ".")).join("")).toBe(GOLDEN.write[c]);
    }
  });
  it("the list accessors agree with the wrappers, in order", () => {
    for (const c of CATS) {
      expect(policyAutoFields(DEFAULT_POLICY, c)).toEqual(autoFields(c));
      expect(policyPurposeFields(DEFAULT_POLICY, c)).toEqual(purposeFields(c));
      for (const f of FIELDS) expect(policyPurposesFor(DEFAULT_POLICY, c, f)).toEqual(purposesFor(c, f));
    }
  });
  it("DEFAULT_POLICY is frozen and valid", () => {
    expect(policyViolations(DEFAULT_POLICY)).toEqual([]);
    expect(isPolicyDocument(DEFAULT_POLICY)).toBe(true);
    expect(() => { (DEFAULT_POLICY.auto.shoe as Field[]).push("budget"); }).toThrow();
  });
});

describe("policy document · id", () => {
  it("is 12 hex chars, independent of key order, and changes when a field moves", () => {
    const id = policyId(DEFAULT_POLICY);
    expect(id).toMatch(/^[0-9a-f]{12}$/);
    const reordered = { history: clone().history, write: clone().write, purpose: clone().purpose, auto: clone().auto, v: 1 as const };
    expect(policyId(reordered)).toBe(id);
    expect(canonicalPolicy(reordered)).toBe(canonicalPolicy(DEFAULT_POLICY));
    const changed = clone();
    changed.auto.retail = changed.auto.retail.filter((f) => f !== "deadline");
    expect(policyId(changed)).not.toBe(id);
    // array order is meaningful (handshake `available`, Tier 0 prefix order): swapping two fields is a new version
    const swapped = clone();
    [swapped.auto.shoe[3], swapped.auto.shoe[4]] = [swapped.auto.shoe[4]!, swapped.auto.shoe[3]!];
    expect(policyId(swapped)).not.toBe(id);
  });
});

describe("policy document · floor (exhaustive single edits)", () => {
  const merchantCats: Category[] = ["shoe", "retail"];

  it("harmless edits are allowed: a merchant category may read less, or read more non-identity fields", () => {
    for (const c of merchantCats) {
      for (const f of FIELDS) {
        // remove from auto
        const d1 = clone();
        d1.auto[c] = d1.auto[c].filter((x) => x !== f);
        expect(policyViolations(d1).length > 0, `${c}: removing ${f} from auto`).toBe(STYLE_FIELDS.includes(f));
        // add to auto
        if (!DEFAULT_POLICY.auto[c].includes(f)) {
          const d2 = clone();
          d2.auto[c].push(f);
          const forbidden = f === "shipping_address" || f === "payment_method";
          expect(policyViolations(d2).length > 0, `${c}: adding ${f} to auto`).toBe(forbidden);
        }
        // move a non-identity field behind a purpose (stricter): fine unless it is also auto
        if (f !== "shipping_address" && f !== "payment_method") {
          const d3 = clone();
          d3.auto[c] = d3.auto[c].filter((x) => x !== f);
          d3.purpose[c][f] = ["checkout"];
          expect(policyViolations(d3).length > 0, `${c}: ${f} only at checkout`).toBe(STYLE_FIELDS.includes(f));
          const d4 = clone();
          d4.purpose[c][f] = ["checkout"];
          if (DEFAULT_POLICY.auto[c].includes(f)) expect(policyViolations(d4), `${c}: ${f} both auto and purpose`).not.toEqual([]);
        }
      }
      // dropping shipping_address or payment_method entirely (stricter) is allowed
      const d5 = clone();
      delete d5.purpose[c].shipping_address;
      delete d5.purpose[c].payment_method;
      expect(policyViolations(d5)).toEqual([]);
      const d6 = clone();
      d6.write[c] = [];
      expect(policyViolations(d6)).toEqual([]);
    }
  });

  it("dangerous edits are rejected, each naming the section and field", () => {
    for (const c of merchantCats) {
      const bad: Array<[string, (d: PolicyDocument) => void, RegExp]> = [
        ["payment_method auto", (d) => { delete d.purpose[c].payment_method; d.auto[c].push("payment_method"); }, /payment_method may never be auto/],
        ["shipping_address auto", (d) => { delete d.purpose[c].shipping_address; d.auto[c].push("shipping_address"); }, /shipping_address may never be auto/],
        ["payment_method at checkout", (d) => { d.purpose[c].payment_method = ["checkout"]; }, /payment_method must be exactly/],
        ["payment_method at payment or checkout", (d) => { d.purpose[c].payment_method = ["payment", "checkout"]; }, /payment_method must be exactly/],
        ["shipping_address at browsing", (d) => { d.purpose[c].shipping_address = ["browsing"]; }, /shipping_address must be exactly/],
        ["merchant writes budget", (d) => { d.write[c].push("budget"); }, /merchants may write shoe_size only, not budget/],
        ["merchant writes an address", (d) => { d.write[c].push("shipping_address"); }, /shoe_size only, not shipping_address/],
        ["style field removed", (d) => { d.auto[c] = d.auto[c].filter((f) => f !== "tone"); }, /must include tone/],
        ["both auto and purpose", (d) => { d.purpose[c].budget = ["checkout"]; }, /budget cannot be both auto and purpose/],
      ];
      for (const [name, edit, msg] of bad) {
        const d = clone();
        edit(d);
        const v = policyViolations(d);
        expect(v.length, `${c}: ${name}`).toBeGreaterThan(0);
        expect(v.join("\n"), `${c}: ${name}`).toMatch(msg);
        expect(v.join("\n")).not.toMatch(/"value"|\d{5}/); // names only, never values
      }
    }
    // the user's own agents keep reading and writing everything
    const p1 = clone(); p1.auto.personal = p1.auto.personal.filter((f) => f !== "budget");
    expect(policyViolations(p1).join("\n")).toMatch(/auto.personal must include budget/);
    const p2 = clone(); p2.purpose.personal.budget = ["checkout"];
    expect(policyViolations(p2).join("\n")).toMatch(/purpose.personal must be empty/);
    const p3 = clone(); p3.write.personal = p3.write.personal.filter((f) => f !== "deadline");
    expect(policyViolations(p3).join("\n")).toMatch(/write.personal must include deadline/);
  });

  it("shape errors are reported, not thrown", () => {
    expect(policyViolations(null)).toEqual(["document must be an object"]);
    expect(policyViolations({ ...clone(), v: 2 })).toContain("v must be 1");
    const extra = { ...clone(), auto: { ...clone().auto, hotel: ["lang"] } };
    expect(policyViolations(extra)).toContain("auto.hotel: unknown category");
    const { retail: _r, ...twoCats } = clone().write;
    expect(policyViolations({ ...clone(), write: twoCats })).toContain("write.retail missing");
    const badField = clone();
    (badField.auto.shoe as string[]).push("phone_number");
    expect(policyViolations(badField)).toContain("auto.shoe: phone_number is not a field");
    const dup = clone();
    dup.auto.shoe.push("budget");
    expect(policyViolations(dup)).toContain("auto.shoe: budget listed twice");
    const badPurpose = clone();
    badPurpose.purpose.shoe.budget = ["Checkout!"];
    badPurpose.auto.shoe = badPurpose.auto.shoe.filter((f) => f !== "budget");
    expect(policyViolations(badPurpose)).toContain("purpose.shoe.budget: invalid purpose name");
    const emptyPurpose = clone();
    emptyPurpose.purpose.shoe.deadline = [];
    emptyPurpose.auto.shoe = emptyPurpose.auto.shoe.filter((f) => f !== "deadline");
    expect(policyViolations(emptyPurpose)).toContain("purpose.shoe.deadline must list at least one purpose");
    expect(isPolicyDocument("nope")).toBe(false);
  });
});

describe("policy document · history", () => {
  it("DEFAULT_POLICY reads history for personal, not for an assistant, and is valid", () => {
    expect(DEFAULT_POLICY.history).toEqual({ personal: true, assistant: false });
    expect(policyViolations(DEFAULT_POLICY)).toEqual([]);
  });

  it("policyHistory: personal always, merchants never, assistant only when the document says true", () => {
    expect(policyHistory(DEFAULT_POLICY, "personal")).toBe(true);
    expect(policyHistory(DEFAULT_POLICY, "shoe")).toBe(false);
    expect(policyHistory(DEFAULT_POLICY, "retail")).toBe(false);
    expect(policyHistory(DEFAULT_POLICY, "assistant")).toBe(false);
    const on = clone();
    on.history = { personal: true, assistant: true };
    expect(policyViolations(on)).toEqual([]);
    expect(policyHistory(on, "assistant")).toBe(true);
    // even a (floor-violating) document cannot open history to a merchant or close it to the user's own agents
    const bad = clone() as PolicyDocument;
    bad.history = { personal: false, shoe: true, retail: true };
    expect(policyHistory(bad, "personal")).toBe(true);
    expect(policyHistory(bad, "shoe")).toBe(false);
    expect(policyHistory(bad, "retail")).toBe(false);
  });

  it("the floor: merchants never read history, personal must be true, values are booleans, keys are categories", () => {
    for (const c of ["shoe", "retail"] as const) {
      const d = clone();
      d.history = { ...d.history, [c]: true };
      expect(policyViolations(d)).toEqual([`history.${c}: merchants never read history`]);
      const off = clone();
      off.history = { ...off.history, [c]: false };
      expect(policyViolations(off)).toEqual([]);
    }
    const p = clone();
    p.history = { personal: false, assistant: false };
    expect(policyViolations(p)).toEqual(["history.personal must be true (the user's own agents read their history)"]);
    const nb = clone() as unknown as Record<string, unknown>;
    nb.history = { personal: true, assistant: "yes" };
    expect(policyViolations(nb)).toEqual(["history.assistant must be true or false"]);
    const unk = clone() as unknown as Record<string, unknown>;
    unk.history = { personal: true, hotel: false };
    expect(policyViolations(unk)).toEqual(["history.hotel: unknown category"]);
    for (const h of [true, ["assistant"], null, "assistant"]) {
      const notObj = clone() as unknown as Record<string, unknown>;
      notObj.history = h;
      expect(policyViolations(notObj), JSON.stringify(h)).toContain("history must be an object keyed by category");
    }
    const partial = clone();
    partial.history = { assistant: true };
    expect(policyViolations(partial)).toEqual([]);
  });

  it("a document without history stays valid, reads as personal only, and has a different id", () => {
    const { history: _h, ...older } = clone();
    expect(policyViolations(older)).toEqual([]);
    expect(policyHistory(older, "assistant")).toBe(false);
    expect(policyHistory(older, "personal")).toBe(true);
    expect(policyId(older)).not.toBe(policyId(DEFAULT_POLICY));
    expect(policyId(older)).toBe("3526a909e404"); // the pre-Phase-4 default's id, unchanged for documents already installed
  });
});
