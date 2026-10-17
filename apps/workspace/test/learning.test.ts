// Dynamic memory (2026-10-17, human direction). A fake LearnApi stands in for lane B's learner; everything else is the
// real workspace. Properties under test: only the user's own words are learned from; observed text is gone (from the
// database files themselves) once processed; paused discards; a pref reaches the card only with two distinct sources;
// a new card field shows up in the next handshake; learning never breaks the request that triggered it.
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ContributionCandidate, LearnApi, LearnIntentInput, ObservationTurn } from "@agent-cookie/contract";
import type { InMemoryRepo } from "./stubs/memory-repo.js";
import { callbackServer, harness, KEYS } from "./harness.js";

class FakeLearn implements LearnApi {
  readonly extractCalls: LearnIntentInput[] = [];
  readonly conversationCalls: Array<{ turns: ObservationTurn[]; context?: { conversationId: string; channel: string } }> = [];
  onExtract: (i: LearnIntentInput) => ContributionCandidate[] = () => [];
  onConversation: (turns: ObservationTurn[]) => ContributionCandidate[] = () => [];
  async extract(i: LearnIntentInput) {
    this.extractCalls.push(structuredClone(i));
    return this.onExtract(i);
  }
  async extractFromConversation(turns: ObservationTurn[], context?: { conversationId: string; channel: string }) {
    this.conversationCalls.push({ turns: structuredClone(turns), ...(context ? { context } : {}) });
    return this.onConversation(turns);
  }
}

type H = Awaited<ReturnType<typeof harness>>;
const at = "2026-10-17T12:00:00.000Z";
const turn = (role: ObservationTurn["role"], text: string): ObservationTurn => ({ role, text, at });
const observe = (h: H, conversationId: string, turns: ObservationTurn[], key = KEYS.personal) =>
  h.post("/personal/observations", key, { channel: "imessage", conversationId, turns });
let offset = 0;
/** Let every queued conversation go quiet for longer than OBSERVATION_IDLE_MS, then run the learner. */
async function quiet(h: H) {
  offset += 301_000;
  await h.post("/test/clock", undefined, { offsetMs: offset });
  await h.deps.learning.flushDue();
  await h.deps.learning.settle();
}
const learned = async (h: H) => (await h.get("/personal/learned", KEYS.personal)).body;
const cardValue = async (h: H, field: string) =>
  ((await h.get("/personal/card", KEYS.personal)).body.card as Array<{ field: string; value: string }>).find((f) => f.field === field)?.value;
const activity = async (h: H) => (await h.get("/owner/activity?limit=500", KEYS.owner)).body.events as Array<{ event: string; result: string; reason: string }>;

describe("observations: only the user's own words are learned from", () => {
  it("agent and other turns never reach LearnApi; user turns arrive in order, with the conversation as context", async () => {
    const learn = new FakeLearn();
    const h = await harness({ learn });
    const r = await observe(h, "conv-1", [
      turn("other", "my sister says she wears Nike"), turn("user", "I always buy Brooks"), turn("agent", "Noted! Any colour?"),
      turn("user", "something in blue"), turn("other", "lol"),
    ]);
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ queued: true });
    expect(learn.conversationCalls).toEqual([]); // not before the conversation goes quiet
    await quiet(h);
    expect(learn.conversationCalls).toHaveLength(1);
    expect(learn.conversationCalls[0]!.turns.map((t) => [t.role, t.text])).toEqual([["user", "I always buy Brooks"], ["user", "something in blue"]]);
    expect(learn.conversationCalls[0]!.context).toEqual({ conversationId: "conv-1", channel: "imessage" });
  });

  it("a conversation is processed once quiet for 5 minutes, or at once when 10 turns have arrived", async () => {
    const learn = new FakeLearn();
    const h = await harness({ learn });
    offset = 0;
    await observe(h, "slow", [turn("user", "hello")]);
    await h.post("/test/clock", undefined, { offsetMs: (offset += 240_000) }); // 4 minutes: not yet
    await h.deps.learning.flushDue();
    expect(learn.conversationCalls).toHaveLength(0);
    await quiet(h);
    expect(learn.conversationCalls).toHaveLength(1);

    await observe(h, "busy", Array.from({ length: 6 }, (_, i) => turn(i % 2 ? "agent" : "user", `t${i}`)));
    await h.deps.learning.settle();
    expect(learn.conversationCalls).toHaveLength(1);
    await observe(h, "busy", Array.from({ length: 4 }, (_, i) => turn("user", `u${i}`))); // 10 turns in all
    await h.deps.learning.settle();
    expect(learn.conversationCalls).toHaveLength(2);
    expect(learn.conversationCalls[1]!.turns.map((t) => t.text)).toEqual(["t0", "t2", "t4", "u0", "u1", "u2", "u3"]);
  });

  it("a card number or contact detail typed into a chat is never stored", async () => {
    const learn = new FakeLearn();
    const h = await harness({ learn });
    await observe(h, "pay", [turn("user", "my card is 4111 1111 1111 1111"), turn("user", "mail me at a@b.co"), turn("user", "I like wool")]);
    const stored = h.deps.store.db.prepare("SELECT text FROM observation_turns").all() as Array<{ text: string }>;
    expect(stored.map((x) => x.text)).toEqual(["I like wool"]);
    await quiet(h);
    expect(learn.conversationCalls[0]!.turns.map((t) => t.text)).toEqual(["I like wool"]);
  });

  it("bad bodies are 422, merchants are 403", async () => {
    const h = await harness();
    for (const body of [
      { channel: "imessage", conversationId: "c", turns: [] },
      { channel: "imessage", conversationId: "c", turns: [{ role: "boss", text: "x", at }] },
      { channel: "imessage", conversationId: "c", turns: [{ role: "user", text: "x".repeat(2001), at }] },
      { channel: "imessage", conversationId: "c", turns: [{ role: "user", text: "x", at: "yesterday" }] },
      { channel: "imessage", turns: [{ role: "user", text: "x", at }] },
      { channel: "imessage", conversationId: "c", turns: Array.from({ length: 51 }, () => ({ role: "user", text: "x", at })) },
    ]) {
      expect((await h.post("/personal/observations", KEYS.personal, body)).status).toBe(422);
    }
    expect((await h.post("/personal/observations", KEYS.acme, { channel: "x", conversationId: "c", turns: [turn("user", "x")] })).status).toBe(403);
    expect((await h.put("/personal/learning", KEYS.personal, { paused: "yes" })).status).toBe(422);
  });
});

describe("observed text is gone once processed", () => {
  it("no row, and no byte in the database files, still holds it — and agent/other text was never written at all", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ws-learn-"));
    const path = join(dir, "ws.sqlite");
    const learn = new FakeLearn();
    learn.onConversation = () => [{ field: "pref.brand", value: "Brooks", evidence: { snippet: "I love Brooks" } }];
    const h = await harness({ learn, env: { SQLITE_PATH: path, AGENT_COOKIE_DATA_DIR: dir } });
    const USER = "QX7USERMARKER";
    const AGENT = "QX7AGENTMARKER";
    const OTHER = "QX7OTHERMARKER";
    await observe(h, "secret", [turn("user", `${USER} I love Brooks trail shoes`), turn("agent", `${AGENT} sure`), turn("other", `${OTHER} hi`)]);
    const files = () => [path, `${path}-wal`].filter(existsSync).map((f) => readFileSync(f));
    const dump = () => JSON.stringify(["observation_turns", "observation_batches", "contributions", "activity", "intents", "idempotency", "settings"]
      .map((t) => h.deps.store.db.prepare(`SELECT * FROM ${t}`).all()));
    // queued: the user's turn is held until processing; the others never were
    expect(dump()).toContain(USER);
    for (const m of [AGENT, OTHER]) {
      expect(dump()).not.toContain(m);
      for (const f of files()) expect(f.includes(Buffer.from(m))).toBe(false);
    }
    await quiet(h);
    expect(learn.conversationCalls).toHaveLength(1);
    expect(dump()).not.toContain(USER);
    for (const f of files()) expect(f.includes(Buffer.from(USER)), "observed text still on disk").toBe(false);
    // what was learned stays, with the user's own words as evidence
    expect((await learned(h)).learned).toEqual([expect.objectContaining({ field: "pref.brand", value: "Brooks", status: "candidate",
      evidence: [expect.objectContaining({ conversationId: "secret", snippet: "I love Brooks" })] })]);
    await h.deps.close();
  });
});

describe("pause", () => {
  it("while paused an observation is discarded on arrival, intents are not learned from, and pausing drops what was waiting", async () => {
    const learn = new FakeLearn();
    learn.onExtract = () => [{ field: "pref.color", value: "blue" }];
    const h = await harness({ learn });
    expect((await h.get("/personal/learning", KEYS.personal)).body).toEqual({ paused: false });
    await observe(h, "before", [turn("user", "I like blue")]);
    expect((await h.put("/personal/learning", KEYS.owner, { paused: true })).body).toEqual({ paused: true });
    expect(h.deps.store.db.prepare("SELECT COUNT(*) AS n FROM observation_turns").get()).toEqual({ n: 0 });

    const r = await observe(h, "during", [turn("user", "I like red")]);
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ queued: false, paused: true });
    expect(h.deps.store.db.prepare("SELECT COUNT(*) AS n FROM observation_batches").get()).toEqual({ n: 0 });
    expect((await h.post("/personal/intents", KEYS.personal, { text: "blue trail shoes" })).status).toBe(201);
    await quiet(h);
    expect(learn.conversationCalls).toEqual([]);
    expect(learn.extractCalls).toEqual([]);
    expect((await learned(h))).toEqual({ paused: true, learned: [] });
    // intent history is still kept while paused (it is the user's record, not learning)
    expect((h.deps.repo as InMemoryRepo).intents.map((i) => i.text)).toEqual(["blue trail shoes"]);

    await h.put("/personal/learning", KEYS.personal, { paused: false });
    await quiet(h);
    expect(learn.conversationCalls).toEqual([]);
  });
});

describe("a learned preference reaches the card only with two distinct sources", () => {
  it("one source → candidate (twice from the same agent still one); a second agent agreeing → card, with both pieces of evidence", async () => {
    const learn = new FakeLearn();
    learn.onConversation = () => [{ field: "pref.brand", value: "Brooks", evidence: { snippet: "Brooks only" } }];
    learn.onExtract = () => [{ field: "pref.brand", value: "Brooks", evidence: { snippet: "Brooks again" } }];
    const h = await harness({ learn });
    await observe(h, "c1", [turn("user", "Brooks only, please")]);
    await quiet(h);
    await observe(h, "c2", [turn("user", "Brooks only, please")]); // same agent, second conversation
    await quiet(h);
    let l = await learned(h);
    expect(l.learned).toEqual([expect.objectContaining({ field: "pref.brand", value: "Brooks", status: "candidate", sources: ["personal-photon"] })]);
    expect(await cardValue(h, "pref.brand")).toBeUndefined();

    // the other personal agent learns the same from an intent
    await h.post("/personal/intents", KEYS.desktop, { text: "Brooks again, trail shoes" });
    await h.deps.learning.settle();
    l = await learned(h);
    expect(l.learned).toEqual([expect.objectContaining({ field: "pref.brand", value: "Brooks", status: "card",
      sources: ["personal-desktop", "personal-photon"] })]);
    const ev = l.learned[0].evidence as Array<Record<string, string>>;
    expect(ev).toHaveLength(2);
    expect(ev.find((e) => e.agentId === "personal-photon")).toMatchObject({ conversationId: "c1", snippet: "Brooks only", basis: "observed" });
    expect(ev.find((e) => e.agentId === "personal-desktop")).toMatchObject({ intentId: expect.stringMatching(/^i_/), snippet: "Brooks again" });
    expect(await cardValue(h, "pref.brand")).toBe("Brooks");
  });

  it("the new card field shows up in the next handshake's `available` for retail merchants — never for shoe merchants", async () => {
    const learn = new FakeLearn();
    learn.onExtract = () => [{ field: "pref.color", value: "green" }];
    const h = await harness({ learn });
    const cb = await callbackServer();
    try {
      await h.registerMerchant({ name: "Gift shop · Sample", category: "retail", capabilities: ["gifts"], callbackUrl: cb.url });
      await h.registerMerchant({ name: "Shoe shop · Sample", category: "shoe", capabilities: ["gifts"], callbackUrl: cb.url });
      const introduced = async (key: string) => {
        cb.bodies.length = 0;
        await h.post("/personal/intents", key, { text: "a green gift", kind: "gifts" });
        await h.deps.learning.settle();
        await h.deps.delivery.settle();
        return (cb.bodies as Array<{ type: string; handshake: { available: string[] }; sessionId: string }>).filter((b) => b.type === "introduce");
      };
      const before = await introduced(KEYS.personal); // learns pref.color=green from photon (one source)
      expect(before.flatMap((b) => b.handshake.available)).not.toContain("pref.color");
      await introduced(KEYS.desktop); // second source → on the card
      expect(await cardValue(h, "pref.color")).toBe("green");
      const after = await introduced(KEYS.personal);
      const avail = after.map((b) => b.handshake.available);
      expect(avail.filter((a) => a.includes("pref.color"))).toHaveLength(1); // the retail one only
      expect(avail.filter((a) => !a.includes("pref.color"))).toHaveLength(1);
    } finally {
      cb.close();
    }
  });
});

describe("what the learner proposes is a parameter, not authority", () => {
  it("drops non-whitelisted or non-pref fields, contact data, unsaid snippets; never 'stated'; truncates snippets to 200", async () => {
    const learn = new FakeLearn();
    const long = "I really like merino wool socks ".repeat(10).trim();
    learn.onConversation = () => [
      { field: "pref.health", value: "diabetic" },
      { field: "shoe_size", value: "44" },
      { field: "shipping_address", value: "1 Main St" },
      { field: "pref.recipient", value: "call me at +1 415 555 0100" },
      { field: "pref.color", value: "red", evidence: { snippet: "I said red" } }, // the user never said this
      { field: "pref.avoid", value: "leather", basis: "stated" },
      { field: "pref.material", value: "merino", evidence: { snippet: long } },
      { field: "pref.style", value: "minimal", basis: "inferred" },
    ];
    const h = await harness({ learn });
    await observe(h, "c", [turn("user", `no leather. ${long}. something red`)]);
    await quiet(h);
    const rows = h.deps.store.contributionsForUser("u_sample").filter((c) => c.agentId === "personal-photon" && c.createdAt > "2026-10-02");
    const byField = Object.fromEntries(rows.map((c) => [c.field, c]));
    expect(Object.keys(byField).sort()).toEqual(["pref.avoid", "pref.color", "pref.material", "pref.style"]);
    expect(byField["pref.avoid"]!.basis).toBe("observed");
    expect(byField["pref.style"]!.basis).toBe("inferred");
    expect(byField["pref.color"]!.evidence).toEqual({ conversationId: "c" }); // unsaid snippet dropped
    expect([...byField["pref.material"]!.evidence!.snippet!].length).toBe(200);
    expect(await cardValue(h, "shoe_size")).toBe("42");
    const ev = (await activity(h)).find((e) => e.event === "learn.apply")!;
    expect(ev.result).toBe("written=4");
    expect(ev.reason).toContain("field=3");
    expect(ev.reason).toContain("value=1");
    expect(JSON.stringify(await activity(h))).not.toMatch(/merino|leather|diabetic|555/);
  });

  it("a value the user revoked is not learned again", async () => {
    const learn = new FakeLearn();
    learn.onConversation = () => [{ field: "pref.brand", value: "Nike" }];
    const h = await harness({ learn });
    await observe(h, "a", [turn("user", "Nike is fine")]);
    await quiet(h);
    const id = (await learned(h)).learned[0].evidence[0].contributionId;
    expect((await h.post(`/personal/contributions/${id}/revoke`, KEYS.personal)).status).toBe(200);
    await observe(h, "b", [turn("user", "Nike is fine")], KEYS.desktop);
    await quiet(h);
    expect((await learned(h)).learned).toEqual([]);
    expect((await activity(h)).some((e) => e.event === "learn.apply" && e.reason.includes("revoked=1"))).toBe(true);
  });
});

describe("intent and accept hooks", () => {
  it("every intent and every accept is appended to the history and learned from (the accept with the chosen quote)", async () => {
    const learn = new FakeLearn();
    const h = await harness({ learn });
    const r = await h.post("/personal/intents", KEYS.personal, { text: "trail shoes under 120", public: { budget: "120" } });
    const quotes = (await h.get(`/personal/intents/${r.body.intentId}/quotes?wait=0`, KEYS.personal)).body.quotes;
    await h.post(`/personal/quotes/${quotes[0].id}/accept`, KEYS.personal);
    await h.post(`/personal/quotes/${quotes[0].id}/accept`, KEYS.personal); // a repeat is not a new choice
    await h.deps.learning.settle();
    expect(learn.extractCalls.map((c) => [c.intentId, c.text, c.chosenQuote?.id])).toEqual([
      [r.body.intentId, "trail shoes under 120", undefined],
      [r.body.intentId, "trail shoes under 120", quotes[0].id],
    ]);
    expect(learn.extractCalls[1]!.chosenQuote).not.toHaveProperty("sessionId");
    const repo = h.deps.repo as InMemoryRepo;
    expect(repo.intents.map((i) => [i.id, i.chosenQuote?.id])).toEqual([[r.body.intentId, undefined], [r.body.intentId, quotes[0].id]]);
  });

  it("a learner that throws changes nothing for the user: the intent and the accept answer as usual, the failure is logged", async () => {
    const learn = new FakeLearn();
    learn.onExtract = () => { throw new Error("model down"); };
    learn.onConversation = () => { throw new Error("model down"); };
    const h = await harness({ learn });
    const r = await h.post("/personal/intents", KEYS.personal, { text: "trail shoes" });
    expect(r.status).toBe(201);
    const quotes = (await h.get(`/personal/intents/${r.body.intentId}/quotes?wait=0`, KEYS.personal)).body.quotes;
    expect((await h.post(`/personal/quotes/${quotes[0].id}/accept`, KEYS.personal)).body.status).toBe("handoff");
    await observe(h, "x", [turn("user", "hello")]);
    await quiet(h);
    const failed = (await activity(h)).filter((e) => e.event.startsWith("learn.") && e.result === "failed").map((e) => e.event).sort();
    expect(failed).toEqual(["learn.accept", "learn.conversation", "learn.intent"]);
    expect(h.deps.store.db.prepare("SELECT COUNT(*) AS n FROM observation_turns").get()).toEqual({ n: 0 }); // text dropped anyway
  });
});

describe("intent history", () => {
  it("GET /personal/intents?q= finds the user's own requests, newest first, with the accepted quote", async () => {
    const h = await harness();
    const a = (await h.post("/personal/intents", KEYS.personal, { text: "Brooks trail shoes" })).body.intentId;
    const b = (await h.post("/personal/intents", KEYS.desktop, { text: "a wool scarf", public: { color: "grey" } })).body.intentId;
    const quotes = (await h.get(`/personal/intents/${a}/quotes?wait=0`, KEYS.personal)).body.quotes;
    await h.post(`/personal/quotes/${quotes[0].id}/accept`, KEYS.personal);
    const all = (await h.get("/personal/intents", KEYS.owner)).body.intents;
    expect(all.map((i: { id: string }) => i.id)).toEqual([b, a]);
    expect(all[1]).toMatchObject({ text: "Brooks trail shoes", agentId: "personal-photon", accepted: { quoteId: quotes[0].id, status: "handoff" } });
    expect((await h.get("/personal/intents?q=brooks", KEYS.personal)).body.intents.map((i: { id: string }) => i.id)).toEqual([a]);
    expect((await h.get("/personal/intents?q=GREY", KEYS.personal)).body.intents.map((i: { id: string }) => i.id)).toEqual([b]);
    expect((await h.get("/personal/intents?q=nothing-like-this", KEYS.personal)).body.intents).toEqual([]);
    expect((await h.get("/personal/intents?limit=1", KEYS.personal)).body.intents).toHaveLength(1);
    expect((await h.get("/personal/intents", KEYS.acme)).status).toBe(403);
  });
});

describe("learned preferences rank UCP offers", () => {
  it("pref.brand ranks first, pref.avoid excludes (stated prefs put straight on the card)", async () => {
    const h = await harness();
    await h.post("/personal/contributions", KEYS.personal, { field: "pref.brand", value: "Altra" });
    await h.post("/personal/contributions", KEYS.personal, { field: "pref.avoid", value: "Brooks" });
    const r = await h.post("/personal/intents", KEYS.personal, { text: "trail shoes", public: { count: "5" } });
    const quotes = (await h.get(`/personal/intents/${r.body.intentId}/quotes?wait=0`, KEYS.personal)).body.quotes
      .filter((q: { seller?: string }) => q.seller) as Array<{ title: string }>;
    expect(quotes.length).toBeGreaterThan(1);
    expect(quotes[0]!.title).toMatch(/Altra/);
    for (const q of quotes) expect(q.title).not.toMatch(/Brooks/);
  });
});

describe("reset", () => {
  it("clears the queue and the learning setting", async () => {
    const h = await harness();
    await observe(h, "c", [turn("user", "hello")]);
    await h.put("/personal/learning", KEYS.personal, { paused: true });
    await observe(h, "d", [turn("user", "hello")]);
    expect((await h.post("/demo/reset", KEYS.owner)).status).toBe(200);
    expect((await h.get("/personal/learning", KEYS.personal)).body).toEqual({ paused: false });
    expect(h.deps.store.db.prepare("SELECT (SELECT COUNT(*) FROM observation_turns) + (SELECT COUNT(*) FROM observation_batches) AS n").get()).toEqual({ n: 0 });
  });
});
