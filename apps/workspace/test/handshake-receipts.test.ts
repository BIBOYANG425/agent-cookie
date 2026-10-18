// Owner decision 2026-10-18: reads of the handshake's auto fields write receipts, so the funnel's questionsSkipped (the
// field names summed over an intent's receipts) counts them. Two readers: a merchant reading GET /agent/fields (with no
// purpose, or with any declared purpose), and the workspace itself reading the card for a UCP store proxy when it
// searches and quotes. Both write purpose "handshake", de-duplicated by services/receipts.ts; neither logs a value.
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY, policyId,
  type MemoryRepoApi, type PolicyDocument, type Receipt, type UcpOffer, type WriteMeta,
} from "@agent-cookie/contract";
import { Clock } from "../src/clock.js";
import { loadFixtures } from "../src/seed.js";
import { RECEIPT_DEDUPE_MS, repeatsRecent } from "../src/services/receipts.js";
import { callbackServer, harness, KEYS, SAMPLE_FIXTURES_DIR } from "./harness.js";
import { stubMemoryRepoApi } from "./stubs/memory-repo.js";
import { StubUcp } from "./stubs/ucp.js";

const START = "2026-10-18T09:00:00.000Z";
type H = Awaited<ReturnType<typeof harness>>;
type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const offer = (seller: string, variantId: string, priceCents: number): UcpOffer => ({
  sellerDomain: seller, sellerName: seller, productTitle: `${seller} trail shoe · Sample`, variantId, variantTitle: "", priceCents, currency: "USD",
  available: true, shipsTo: ["US"], sizeOptions: [], nativeCheckout: false, etaDate: null, checkoutUrl: `https://${seller}/cart/${variantId}` });
/** Two stores, both picked by any search (DEFAULT_SELLER_COUNT). */
const twoStores = () => new StubUcp([offer("alpha.example", "a1", 9_900), offer("beta.example", "b1", 10_500)], "requires_escalation");
/** A sentence and no kind: only the UCP search answers (no callback merchant, no Tier 0 ACME). */
const UCP_ONLY = { text: "Sample · trail shoes", public: { budget: "120" } };

const closers: Array<() => void> = [];
afterEach(() => { for (const c of closers.splice(0)) c(); });

async function setup(opts: Parameters<typeof harness>[0] = {}) {
  const clock = Clock.at(START);
  const h = await harness({ clock, ...opts });
  return { h, clock };
}

const receipts = async (h: H) => (await h.get("/personal/receipts?limit=500", KEYS.personal)).body.receipts as Json[];
const activity = async (h: H) => (await h.get("/owner/activity?limit=1000", KEYS.owner)).body.events as Json[];
const inGit = (h: H) => (h.deps.repo as unknown as { receipts: Receipt[] }).receipts;
const fieldsUrl = (sessionId: string, names: string[], purpose?: string) =>
  `/agent/fields?${new URLSearchParams({ sessionId, fields: names.join(","), ...(purpose ? { purpose } : {}) })}`;

/** A callback merchant (answering 200) introduced through the kind hint, with its session for that intent. */
async function introduced(h: H) {
  const cb = await callbackServer();
  closers.push(cb.close);
  const m = await h.registerMerchant({ callbackUrl: cb.url });
  const { intentId } = await h.intent();
  const { sessionId } = await h.sessionOf(m.agentId);
  const handshakes = async () => (await receipts(h)).filter((r) => r.sessionId === sessionId && r.purpose === "handshake");
  /** Oldest first (the activity route lists newest first). */
  const reads = async () => (await activity(h)).filter((e) => e.event === "fields.read" && e.object === sessionId).map((e) => e.reason as string).reverse();
  return { m, intentId, sessionId, handshakes, reads };
}

/** The stub repo, except that receipts matching `when` fail the way a broken repo does. */
function failingReceipts(when: (r: Receipt) => boolean): MemoryRepoApi {
  const inner = stubMemoryRepoApi(() => loadFixtures(SAMPLE_FIXTURES_DIR).contributions);
  return {
    async openMemoryRepo(o) {
      const repo = await inner.openMemoryRepo(o);
      const append = repo.appendReceipt.bind(repo);
      return Object.assign(Object.create(repo), {
        appendReceipt: async (r: Receipt, meta: WriteMeta) => {
          if (when(r)) throw new Error("git: index.lock exists");
          return append(r, meta);
        },
      });
    },
  };
}

describe("a merchant's auto read writes a handshake receipt", () => {
  it("GET /agent/fields without a purpose: one receipt naming the fields released, its session and intent and policy; in git before the values", async () => {
    const { h } = await setup();
    const { m, intentId, sessionId, handshakes, reads } = await introduced(h);
    expect(await handshakes()).toEqual([]);

    const r = await h.get(fieldsUrl(sessionId, ["shoe_size", "lang", "deadline"]), m.key);
    expect(r.status).toBe(200);
    // deadline is an auto field the Sample card does not hold: not released, so not in the receipt
    expect(r.body).toEqual({ sessionId, purpose: "", fields: { shoe_size: "42", lang: "zh" } });
    const rs = await handshakes();
    expect(rs).toEqual([{ id: expect.any(String), sessionId, agentId: m.agentId, intentId, fields: ["shoe_size", "lang"], purpose: "handshake",
      createdAt: START, policyId: policyId(DEFAULT_POLICY) }]);
    expect(inGit(h).filter((x) => x.id === rs[0].id)).toHaveLength(1);
    // field names and counts in the log, never a value
    expect(await reads()).toEqual([`shoe_size,lang,deadline purpose= intent=${intentId} receipts=1 deduped=0`]);
  });

  it("a declared purpose does not take the auto fields out of the receipts; a mixed read writes the purpose receipt and the handshake receipt", async () => {
    const { h } = await setup();
    const { m, intentId, sessionId } = await introduced(h);
    const mine = async () => (await receipts(h)).filter((r) => r.sessionId === sessionId);

    expect((await h.get(fieldsUrl(sessionId, ["budget"], "anything"), m.key)).body.fields).toEqual({ budget: "120" });
    expect((await mine()).map((r) => [r.purpose, r.fields])).toEqual([["handshake", ["budget"]]]);

    // the user accepts this merchant's quote: shipping_address opens for purpose checkout
    const q = await h.post("/agent/quotes", m.key, { intentId, text: "Sample quote", price: 9900, etaDate: null });
    expect((await h.post(`/personal/quotes/${q.body.id}/accept`, KEYS.personal)).body.status).toBe("handoff");
    const r = await h.get(fieldsUrl(sessionId, ["shipping_address", "shoe_size"], "checkout"), m.key);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body.fields).sort()).toEqual(["shipping_address", "shoe_size"]);
    const rs = await mine();
    expect(rs.map((x) => [x.purpose, x.fields, x.intentId])).toEqual([
      ["handshake", ["shoe_size"], intentId], ["checkout", ["shipping_address"], intentId], ["handshake", ["budget"], intentId]]);
  });

  it("a read that releases no value writes no receipt, and is still logged", async () => {
    const { h } = await setup();
    const { m, intentId, sessionId, handshakes, reads } = await introduced(h);
    const r = await h.get(fieldsUrl(sessionId, ["deadline"]), m.key);
    expect(r.status).toBe(200);
    expect(r.body.fields).toEqual({});
    expect(await handshakes()).toEqual([]);
    expect(await reads()).toEqual([`deadline purpose= intent=${intentId} receipts=0 deduped=0`]);
  });

  it("no durable receipt, no values: the git write fails → 500, no SQLite receipt, nothing released", async () => {
    let failing = false;
    const { h } = await setup({ memoryRepoApi: failingReceipts((r) => failing && r.purpose === "handshake") });
    const { m, sessionId, handshakes } = await introduced(h);
    failing = true;
    const r = await h.get(fieldsUrl(sessionId, ["shoe_size", "lang"]), m.key);
    expect(r.status).toBe(500);
    expect(r.text).not.toContain("42");
    expect(r.text).not.toContain("zh");
    expect(await handshakes()).toEqual([]);
    failing = false;
    expect((await h.get(fieldsUrl(sessionId, ["shoe_size", "lang"]), m.key)).status).toBe(200);
    expect(await handshakes()).toHaveLength(1);
  });
});

describe("de-duplication: a store polling every message does not commit to git each time", () => {
  it("same field set, same intent, same policy within the hour → no new receipt; another set, intent or policy → a new one; every read logged", async () => {
    const { h, clock } = await setup();
    const { m, intentId, sessionId, handshakes, reads } = await introduced(h);
    const read = async (names: string[]) => expect((await h.get(fieldsUrl(sessionId, names), m.key)).status).toBe(200);
    const commits = () => inGit(h).filter((r) => r.sessionId === sessionId).length;

    await read(["shoe_size", "lang"]);
    clock.advance(5 * 60_000); // the grant lasts 10 minutes
    await read(["lang", "shoe_size"]); // the same set in another order
    await read(["shoe_size", "lang"]);
    expect(await handshakes()).toHaveLength(1);
    expect(commits()).toBe(1);

    // another field set: a receipt at once; then back to the first set: the newest receipt differs, so another one
    await read(["shoe_size"]);
    await read(["shoe_size", "lang"]);
    expect((await handshakes()).map((r) => r.fields)).toEqual([["shoe_size", "lang"], ["shoe_size"], ["shoe_size", "lang"]]);

    // another installed policy document (still auto for shoe_size and lang): a receipt under its id
    const narrow = structuredClone(DEFAULT_POLICY) as PolicyDocument;
    narrow.auto.shoe = narrow.auto.shoe.filter((f) => f !== "deadline");
    expect((await h.put("/personal/policy", KEYS.owner, narrow)).status).toBe(200);
    await read(["shoe_size", "lang"]);
    let rs = await handshakes();
    expect(rs).toHaveLength(4);
    expect(rs[0]).toMatchObject({ fields: ["shoe_size", "lang"], intentId, policyId: policyId(narrow) });

    // a new intent: its grant authorizes the read, so the receipt carries the new intent
    const next = (await h.intent()).intentId;
    await read(["shoe_size", "lang"]);
    rs = await handshakes();
    expect(rs).toHaveLength(5);
    expect(rs[0]).toMatchObject({ intentId: next, policyId: policyId(narrow) });
    expect(commits()).toBe(5);

    expect((await reads()).map((x) => x.split(" ").slice(-2).join(" "))).toEqual([
      "receipts=1 deduped=0", "receipts=0 deduped=1", "receipts=0 deduped=1", "receipts=1 deduped=0", "receipts=1 deduped=0",
      "receipts=1 deduped=0", "receipts=1 deduped=0"]);
  });

  it("the window is one hour on the workspace clock: a repeat at 59:59.999 is deduplicated, at 60:00 it is receipted", async () => {
    const { h } = await setup();
    const { m, intentId, sessionId, handshakes } = await introduced(h);
    const base = { sessionId, agentId: m.agentId, intentId, fields: ["shoe_size", "lang"] as Receipt["fields"], purpose: "handshake",
      policyId: policyId(DEFAULT_POLICY) };
    const at = (msAgo: number) => new Date(Date.parse(START) - msAgo).toISOString();
    const check = { sessionId, purpose: "handshake", fields: base.fields, intentId, policyId: base.policyId };
    // the grants last ten minutes, so the hour is set up with a stored receipt from before
    h.deps.store.insertReceipt({ ...base, id: "r_backdate1", createdAt: at(RECEIPT_DEDUPE_MS - 1), userId: h.deps.store.firstUser()!.userId });
    expect(repeatsRecent(h.deps, check)).toBe(true);
    expect((await h.get(fieldsUrl(sessionId, ["shoe_size", "lang"]), m.key)).status).toBe(200);
    expect(await handshakes()).toHaveLength(1);

    h.deps.store.insertReceipt({ ...base, id: "r_backdate2", createdAt: at(RECEIPT_DEDUPE_MS), userId: h.deps.store.firstUser()!.userId });
    expect(repeatsRecent(h.deps, check)).toBe(false);
    expect((await h.get(fieldsUrl(sessionId, ["shoe_size", "lang"]), m.key)).status).toBe(200);
    const rs = await handshakes();
    expect(rs).toHaveLength(3);
    expect(rs[0]).toMatchObject({ createdAt: START, fields: ["shoe_size", "lang"] });
    expect(repeatsRecent(h.deps, check)).toBe(true);
    // another intent never repeats; a receipt "from the future" (the test clock was moved back) never deduplicates
    expect(repeatsRecent(h.deps, { ...check, intentId: "i_other" })).toBe(false);
    h.deps.store.insertReceipt({ ...base, id: "r_future", createdAt: at(-1000), userId: h.deps.store.firstUser()!.userId });
    expect(repeatsRecent(h.deps, check)).toBe(false);
  });

  it("concurrent identical reads write one receipt", async () => {
    const { h } = await setup();
    const { m, sessionId, handshakes } = await introduced(h);
    const all = await Promise.all([1, 2, 3, 4].map(() => h.get(fieldsUrl(sessionId, ["shoe_size", "lang"]), m.key)));
    expect(all.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect(await handshakes()).toHaveLength(1);
  });
});

describe("a UCP store proxy: the workspace's own read of the card when it searches and quotes", () => {
  it("one handshake receipt per (store session, intent) naming the card fields the search used; in git; counts-only log", async () => {
    const { h } = await setup({ ucp: twoStores() });
    const r = await h.post("/personal/intents", KEYS.personal, UCP_ONLY);
    expect(r.status).toBe(201);
    const intentId = r.body.intentId as string;
    const quotes = (await h.get(`/personal/intents/${intentId}/quotes?wait=0`, KEYS.personal)).body.quotes as Json[];
    expect(quotes.map((q) => q.agentId).sort()).toEqual(["ucp:alpha.example", "ucp:beta.example"]);
    const rs = (await receipts(h)).sort((a, b) => a.agentId.localeCompare(b.agentId));
    // The budget is stated in the request (not a card read); the card's lang and shoe_size were used, in table order.
    expect(rs).toEqual(["ucp:alpha.example", "ucp:beta.example"].map((agentId) => ({ id: expect.any(String), sessionId: expect.any(String), agentId,
      intentId, fields: ["lang", "shoe_size"], purpose: "handshake", createdAt: START, policyId: policyId(DEFAULT_POLICY) })));
    // one per store session, and that session is the store's
    const grants = (await h.get("/personal/grants", KEYS.personal)).body.grants as Json[];
    for (const x of rs) expect(grants.find((g) => g.sessionId === x.sessionId)!.agentId).toBe(x.agentId);
    expect(new Set(rs.map((x) => x.sessionId)).size).toBe(2);
    for (const x of rs) expect(inGit(h).filter((g) => g.id === x.id)).toHaveLength(1);
    const ev = (await activity(h)).filter((e) => e.event === "ucp.handshake");
    expect(ev.map((e) => [e.result, e.reason]).sort()).toEqual([["written", `fields=2 intent=${intentId}`], ["written", `fields=2 intent=${intentId}`]]);
    expect(ev.map((e) => e.object).sort()).toEqual(rs.map((x) => x.sessionId).sort());
  });

  it("a value the request states is not a card read; the card's budget and learned preferences are, when the request does not state them", async () => {
    const { h } = await setup({ ucp: twoStores() });
    const stated = (await h.post("/personal/intents", KEYS.personal, { text: "Sample · shoes", public: { budget: "120", size: "43" } })).body.intentId;
    let rs = (await receipts(h)).filter((x) => x.intentId === stated);
    expect(rs.map((x) => x.fields)).toEqual([["lang"], ["lang"]]);

    for (const [field, value] of [["budget", "150"], ["pref.brand", "Brooks"], ["pref.color", "blue"], ["pref.avoid", "pink"]]) {
      expect((await h.post("/personal/contributions", KEYS.personal, { field, value })).status).toBe(201);
    }
    const fromCard = (await h.post("/personal/intents", KEYS.personal, { text: "Sample · shoes", public: {} })).body.intentId;
    rs = (await receipts(h)).filter((x) => x.intentId === fromCard);
    expect(rs.map((x) => x.fields)).toEqual([
      ["lang", "shoe_size", "budget", "pref.brand", "pref.color", "pref.avoid"], ["lang", "shoe_size", "budget", "pref.brand", "pref.color", "pref.avoid"]]);
    const own = (await h.post("/personal/intents", KEYS.personal, { text: "Sample · shoes", public: { brand: "Hoka", color: "red", budget: "200" } })).body.intentId;
    rs = (await receipts(h)).filter((x) => x.intentId === own);
    expect(rs.map((x) => x.fields)).toEqual([["lang", "shoe_size", "pref.avoid"], ["lang", "shoe_size", "pref.avoid"]]);
    // the log carries counts, never a value
    const ev = (await activity(h)).filter((e) => e.event === "ucp.handshake");
    expect(ev).toHaveLength(6);
    for (const e of ev) expect(e.reason).toMatch(/^fields=\d intent=i_[0-9a-z]{8}$/);
  });

  it("the receipts cannot be written → the intent fails with nothing committed: no intent, no quote, no receipt", async () => {
    let failing = true;
    const { h } = await setup({ ucp: twoStores(), memoryRepoApi: failingReceipts((r) => failing && r.purpose === "handshake") });
    const r = await h.post("/personal/intents", KEYS.personal, UCP_ONLY);
    expect(r.status).toBe(500);
    expect(h.deps.store.intentsForUser(h.deps.store.firstUser()!.userId)).toEqual([]);
    expect(await receipts(h)).toEqual([]);
    expect((await h.get("/owner/funnel", KEYS.owner)).body.rows).toEqual([]);
    failing = false;
    expect((await h.post("/personal/intents", KEYS.personal, UCP_ONLY)).status).toBe(201);
    expect(await receipts(h)).toHaveLength(2);
  });
});

describe("funnel: questionsSkipped counts the auto fields as well as the checkout address", () => {
  it("an intent with an accepted UCP quote: each store's handshake fields plus shipping_address", async () => {
    const { h } = await setup({ ucp: twoStores() });
    const intentId = (await h.post("/personal/intents", KEYS.personal, UCP_ONLY)).body.intentId as string;
    const quotes = (await h.get(`/personal/intents/${intentId}/quotes?wait=0`, KEYS.personal)).body.quotes as Json[];
    const a = await h.post(`/personal/quotes/${quotes[0].id}/accept`, KEYS.personal);
    expect(a.body.status).toBe("handoff");
    // the accepted store's session: the search's handshake read, then the checkout release
    const rs = await receipts(h);
    expect(rs.filter((x) => x.agentId === quotes[0].agentId).map((x) => [x.purpose, x.fields]))
      .toEqual([["checkout", ["shipping_address"]], ["handshake", ["lang", "shoe_size"]]]);
    const row = ((await h.get("/owner/funnel", KEYS.owner)).body.rows as Json[]).find((x) => x.intentId === intentId);
    // two stores × (lang, shoe_size) + shipping_address
    expect(row).toMatchObject({ purposeReleases: 3, questionsSkipped: 2 * 2 + 1 });
    expect(row.questionsSkipped).toBe(rs.reduce((n, x) => n + x.fields.length, 0));
  });
});
