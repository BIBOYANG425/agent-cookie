// B49 rulings (2026-10-18, human / coordination): explicit statements reach the card, two conversations of one agent
// are two sources, observed text lives in memory only (bounded, replay-proof), forget is one act, and on an accept
// every record is written by the agent that accepted. The learner is a fake; the merge rules are lane C's real ones.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  OBSERVATION_MAX_CONVERSATIONS, OBSERVATION_MAX_QUEUED_TURNS, OBSERVATION_MESSAGE_TTL_MS,
  type ContributionCandidate, type LearnApi, type ObservationTurn,
} from "@agent-cookie/contract";
import { openMemoryRepo } from "@agent-cookie/memory-repo";
import { rules } from "@agent-cookie/rules";
import { createApp } from "../src/app.js";
import { NO_LEARNING, loadLearn, type LearnModule } from "../src/adapters.js";
import { loadConfig, REPO_ROOT } from "../src/config.js";
import { createDeps } from "../src/deps.js";
import type { InMemoryRepo } from "./stubs/memory-repo.js";
import { StubUcp } from "./stubs/ucp.js";
import { harness, KEYS, SAMPLE_FIXTURES_DIR } from "./harness.js";

const DAY = 86_400_000;
type H = Awaited<ReturnType<typeof harness>>;

class Learner implements LearnApi {
  onConversation: (turns: ObservationTurn[], conversationId: string) => ContributionCandidate[] = () => [];
  onExtract: () => ContributionCandidate[] = () => [];
  hold?: Promise<void>;
  calls = 0;
  async extract() { this.calls++; if (this.hold) await this.hold; return this.onExtract(); }
  async extractFromConversation(turns: ObservationTurn[], ctx?: { conversationId: string }) {
    this.calls++;
    if (this.hold) await this.hold;
    return this.onConversation(turns, ctx?.conversationId ?? "");
  }
}
const at = "2026-10-17T12:00:00.000Z";
const turn = (text: string, extra: Partial<ObservationTurn> = {}): ObservationTurn => ({ role: "user", text, at, ...extra });
const observe = (h: H, conversationId: string, turns: ObservationTurn[], key = KEYS.personal) =>
  h.post("/personal/observations", key, { channel: "imessage", conversationId, turns });
/** Move the workspace clock to `offsetMs` and learn from every conversation that is due. */
async function learnAt(h: H, offsetMs: number) {
  await h.post("/test/clock", undefined, { offsetMs });
  await h.deps.learning.flushDue();
  await h.deps.learning.settle();
}
const entry = async (h: H, field: string) => ((await h.get("/personal/learned", KEYS.personal)).body.learned as Array<{
  field: string; value: string; status: string; sources: string[]; evidence: Array<Record<string, string>> }>).find((e) => e.field === field);
const cardEntry = async (h: H, field: string) =>
  ((await h.get("/personal/card", KEYS.personal)).body.card as Array<{ field: string; value: string; confidence: string }>).find((f) => f.field === field);
const activity = async (h: H) => (await h.get("/owner/activity?limit=500", KEYS.owner)).body.events as Array<{ event: string; result: string; reason: string; object: string }>;
const black = (basis?: ContributionCandidate["basis"]): ContributionCandidate[] => [{ field: "pref.color", value: "black", ...(basis ? { basis } : {}) }];
const deferred = () => { let open!: () => void; const p = new Promise<void>((r) => { open = r; }); return { p, open }; };

describe("B49 ②: the extractor's basis is kept", () => {
  it("a stated preference is on the card after one conversation (medium); an inferred one waits as a candidate", async () => {
    const learn = new Learner();
    learn.onConversation = (_t, c) => (c === "said" ? black("stated") : [{ field: "pref.style", value: "minimal", basis: "inferred" }]);
    const h = await harness({ learn });
    await observe(h, "said", [turn("I always prefer black clothing.")]);
    await observe(h, "guess", [turn("this one looks clean")]);
    await learnAt(h, 301_000);
    expect(await entry(h, "pref.color")).toMatchObject({ status: "card", evidence: [expect.objectContaining({ basis: "stated", conversationId: "said" })] });
    expect(await cardEntry(h, "pref.color")).toMatchObject({ value: "black", confidence: "medium" });
    expect(await entry(h, "pref.style")).toMatchObject({ status: "candidate", evidence: [expect.objectContaining({ basis: "inferred" })] });
  });

  it("an unknown basis is 'observed'; a non-pref field or a malformed value is still dropped whatever the basis", async () => {
    const learn = new Learner();
    learn.onConversation = () => [
      { field: "pref.fit", value: "wide", basis: "certain" as ContributionCandidate["basis"] },
      { field: "shoe_size", value: "44", basis: "stated" },
      { field: "pref.brand", value: "call me 415 555 0100", basis: "stated" },
    ];
    const h = await harness({ learn });
    await observe(h, "c", [turn("wide fit please")]);
    await learnAt(h, 301_000);
    const rows = h.deps.store.contributionsForUser("u_sample").filter((c) => c.evidence?.conversationId === "c");
    expect(rows.map((c) => [c.field, c.basis])).toEqual([["pref.fit", "observed"]]);
    expect(await cardEntry(h, "shoe_size")).toMatchObject({ value: "42" });
  });
});

describe("B49 ⑤: a source is a conversation, not an agent", () => {
  for (const [name, second] of [["minutes apart", 602_000], ["31 days apart", 31 * DAY]] as const) {
    it(`one agent, two different conversations ${name}: on the card with both pieces of evidence`, async () => {
      const learn = new Learner();
      learn.onConversation = () => black("observed");
      const h = await harness({ learn });
      await observe(h, "one", [turn("Black is the color I choose for my clothes.")]);
      await learnAt(h, 301_000);
      expect(await entry(h, "pref.color")).toMatchObject({ status: "candidate" });
      await observe(h, "two", [turn("Black is the color I choose for my clothes.")]);
      await learnAt(h, second);
      const e = await entry(h, "pref.color");
      expect(e).toMatchObject({ status: "card", sources: ["personal-photon"] });
      expect(e!.evidence.map((x) => x.conversationId)).toEqual(["one", "two"]);
    });
  }
});

describe("B49 ③: observed text is held in memory only, bounded", () => {
  it(`past ${OBSERVATION_MAX_CONVERSATIONS} waiting conversations the oldest is dropped, and the drop is counted`, async () => {
    const learn = new Learner();
    const h = await harness({ learn });
    for (let i = 0; i <= OBSERVATION_MAX_CONVERSATIONS; i++) await observe(h, `c${i}`, [turn(`hello ${i}`)]);
    expect(h.deps.learning.queue.count("u_sample")).toBe(OBSERVATION_MAX_CONVERSATIONS);
    expect(h.deps.learning.queue.get("personal-photon", "c0")).toBeUndefined();
    expect(h.deps.store.observationBatch("personal-photon", "c0")).toBeUndefined();
    expect(h.deps.store.observationBatches("u_sample")).toHaveLength(OBSERVATION_MAX_CONVERSATIONS);
    expect((await activity(h)).filter((e) => e.event === "observation.drop" && e.result === "overflow").map((e) => e.reason)).toEqual(["conversations=1"]);
  });

  it(`a conversation keeps its newest ${OBSERVATION_MAX_QUEUED_TURNS} user turns; the rest are dropped and counted`, async () => {
    const learn = new Learner();
    const seen: string[][] = [];
    learn.onConversation = (turns) => { seen.push(turns.map((t) => t.text)); return []; };
    const h = await harness({ learn });
    await observe(h, "long", Array.from({ length: 25 }, (_, i) => turn(`u${i}`))); // full: learned from at once
    await h.deps.learning.settle();
    expect(seen).toEqual([Array.from({ length: 20 }, (_, i) => `u${i + 5}`)]);
    expect((await activity(h)).find((e) => e.event === "observation.drop" && e.result === "overflow")).toMatchObject({ reason: "turns=5" });
  });

  it("SQLite holds the conversation's id, turn count and times — the columns, and nothing else", async () => {
    const h = await harness();
    await observe(h, "c", [turn("I like wool"), { role: "agent", text: "noted", at }]);
    const rows = h.deps.store.db.prepare("SELECT * FROM observation_batches").all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual(["agent_id", "channel", "conversation_id", "first_at", "last_at", "turns_seen", "user_id"]);
    expect(JSON.stringify(rows)).not.toContain("wool");
  });
});

describe("B49 ③: a replayed messageId is not a second sighting", () => {
  it("within an hour the same message is ignored (duplicate, nothing queued); after it, it counts again; ids are per agent", async () => {
    const learn = new Learner();
    const h = await harness({ learn });
    expect((await observe(h, "c", [turn("I like wool", { messageId: "m1" })])).body).toEqual({ queued: true });
    expect((await observe(h, "c", [turn("I like wool", { messageId: "m1" })])).body).toEqual({ queued: false, duplicate: true });
    expect(h.deps.learning.queue.get("personal-photon", "c")!.turns).toHaveLength(1);
    // a mixed post keeps only its new turns
    expect((await observe(h, "c", [turn("I like wool", { messageId: "m1" }), turn("and linen", { messageId: "m2" })])).body).toEqual({ queued: true });
    expect(h.deps.learning.queue.get("personal-photon", "c")!.turns.map((t) => t.text)).toEqual(["I like wool", "and linen"]);
    // another personal agent's m1 is its own message
    expect((await observe(h, "c", [turn("I like wool", { messageId: "m1" })], KEYS.desktop)).body).toEqual({ queued: true });
    await h.post("/test/clock", undefined, { offsetMs: OBSERVATION_MESSAGE_TTL_MS + 1000 });
    expect((await observe(h, "c", [turn("I like wool", { messageId: "m1" })])).body).toEqual({ queued: true });
  });

  it("a message said while learning was paused is not learned when it is replayed after resuming", async () => {
    const learn = new Learner();
    learn.onConversation = () => black("stated");
    const h = await harness({ learn });
    await h.put("/personal/learning", KEYS.personal, { paused: true });
    expect((await observe(h, "c", [turn("black, always", { messageId: "p1" })])).body).toEqual({ queued: false, paused: true });
    await h.put("/personal/learning", KEYS.personal, { paused: false });
    expect((await observe(h, "c", [turn("black, always", { messageId: "p1" })])).body).toEqual({ queued: false, duplicate: true });
    await learnAt(h, 301_000);
    expect(learn.calls).toBe(0);
  });

  it("a messageId is a short non-empty string (422 otherwise)", async () => {
    const h = await harness();
    for (const messageId of ["", 7, "x".repeat(129)]) {
      expect((await observe(h, "c", [{ ...turn("hi"), messageId } as ObservationTurn])).status).toBe(422);
    }
  });
});

describe("B49 ③: forget", () => {
  async function learnedTwice(h: H, learn: Learner) {
    learn.onConversation = (_t, c) => (c === "c1" ? black("observed") : c === "c2" ? [...black("observed"), { field: "pref.fit", value: "wide" }] : []);
    await observe(h, "c1", [turn("black please")]);
    await observe(h, "c2", [turn("black and wide")]);
    await learnAt(h, 301_000);
    expect(await cardEntry(h, "pref.color")).toMatchObject({ value: "black" });
  }

  it("revokes everything learned from one conversation in one transaction and ONE commit with CARD.md; the card follows", async () => {
    const learn = new Learner();
    const h = await harness({ learn });
    await learnedTwice(h, learn);
    const repo = h.deps.repo as InMemoryRepo;
    const before = repo.commits.length;
    const ids = h.deps.store.contributionsForUser("u_sample").filter((c) => c.evidence?.conversationId === "c2").map((c) => c.id).sort();
    expect(ids).toHaveLength(2);
    const r = await h.post("/personal/learned/forget", KEYS.personal, { conversationId: "c2" });
    expect(r.status).toBe(200);
    expect(r.body.revoked).toBe(2);
    expect([...r.body.contributionIds].sort()).toEqual(ids);
    const rows = ids.map((id) => h.deps.store.contribution(id)!);
    expect(rows.every((c) => c.revokedAt && c.revokedAt === rows[0]!.revokedAt && !c.evidence)).toBe(true); // evidence goes with it
    expect(repo.commits.slice(before).map((c) => c.message)).toEqual(["revoke 2 + regenerate CARD.md"]);
    // one source left for black → back to a candidate; wide is gone
    expect(await cardEntry(h, "pref.color")).toBeUndefined();
    expect(await entry(h, "pref.color")).toMatchObject({ status: "candidate" });
    expect(await entry(h, "pref.fit")).toBeUndefined();
    expect((await activity(h)).find((e) => e.event === "learning.forget")).toMatchObject({ object: "conversation", reason: "revoked=2" });
  });

  it("without lane C's revokeContributions it still revokes them all (one commit each, CARD.md once)", async () => {
    const learn = new Learner();
    const h = await harness({ learn });
    await learnedTwice(h, learn);
    const repo = h.deps.repo as InMemoryRepo;
    Object.defineProperty(repo, "revokeContributions", { value: undefined });
    const before = repo.commits.length;
    expect((await h.post("/personal/learned/forget", KEYS.owner, { conversationId: "c2" })).body.revoked).toBe(2);
    expect(repo.commits.slice(before).map((c) => c.message.split(" ")[0])).toEqual(["revoke", "revoke", "regenerate"]);
    expect(await cardEntry(h, "pref.color")).toBeUndefined();
  });

  it("drops the conversation's waiting turns and an answer still in flight; a later message is learned again", async () => {
    const learn = new Learner();
    learn.onConversation = () => black("stated");
    const h = await harness({ learn });
    // in flight: the learner holds its answer while the user says "forget that"
    const d = deferred();
    learn.hold = d.p;
    await observe(h, "c", [turn("black, always")]);
    await h.post("/test/clock", undefined, { offsetMs: 301_000 });
    const flushing = h.deps.learning.flushDue();
    await new Promise((r) => setTimeout(r, 20));
    await observe(h, "c", [turn("black again")]); // waiting behind it
    expect(h.deps.learning.queue.get("personal-photon", "c")).toBeDefined();
    expect((await h.post("/personal/learned/forget", KEYS.personal, { conversationId: "c" })).body).toEqual({ revoked: 0, contributionIds: [] });
    expect(h.deps.learning.queue.get("personal-photon", "c")).toBeUndefined();
    d.open();
    await flushing;
    await h.deps.learning.settle();
    expect(await entry(h, "pref.color")).toBeUndefined();
    expect((await activity(h)).find((e) => e.event === "learn.apply" && e.result === "dropped")).toMatchObject({ reason: "forgotten" });
    // the conversation goes on: new words are new evidence
    learn.hold = undefined;
    await observe(h, "c", [turn("black, still")]);
    await learnAt(h, 700_000);
    expect(await entry(h, "pref.color")).toMatchObject({ status: "card" });
  });

  it("forgets what one intent taught, including what its accept taught", async () => {
    const learn = new Learner();
    learn.onExtract = () => black("observed");
    const h = await harness({ learn });
    const i = await h.post("/personal/intents", KEYS.personal, { text: "black trail shoes" });
    await h.deps.learning.settle();
    expect(await entry(h, "pref.color")).toMatchObject({ status: "candidate" });
    expect((await h.post("/personal/learned/forget", KEYS.personal, { intentId: i.body.intentId })).body.revoked).toBe(1);
    expect(await entry(h, "pref.color")).toBeUndefined();
  });

  it("exactly one of conversationId / intentId (422); merchants 403; nothing to forget is not an error", async () => {
    const h = await harness();
    expect((await h.post("/personal/learned/forget", KEYS.personal, {})).status).toBe(422);
    expect((await h.post("/personal/learned/forget", KEYS.personal, { conversationId: "a", intentId: "b" })).status).toBe(422);
    expect((await h.post("/personal/learned/forget", KEYS.acme, { conversationId: "a" })).status).toBe(403);
    expect((await h.post("/personal/learned/forget", KEYS.personal, { conversationId: "never" })).body).toEqual({ revoked: 0, contributionIds: [] });
  });
});

describe("B49 ④: on an accept every record is written by the agent that accepted", () => {
  it("Desktop asks, Photon accepts: handoff, the history record and the learned contribution are Photon's, naming the intent", async () => {
    const learn = new Learner();
    learn.onExtract = () => black("observed");
    const h = await harness({ learn });
    const i = await h.post("/personal/intents", KEYS.desktop, { text: "black trail shoes" });
    const quotes = (await h.get(`/personal/intents/${i.body.intentId}/quotes?wait=0`, KEYS.personal)).body.quotes;
    expect((await h.post(`/personal/quotes/${quotes[0].id}/accept`, KEYS.personal)).body.status).toBe("handoff");
    await h.deps.learning.settle();
    const repo = h.deps.repo as InMemoryRepo;
    expect(repo.intents.map((r) => [r.id, r.agentId, r.chosenQuote?.id])).toEqual([
      [i.body.intentId, "personal-desktop", undefined], [i.body.intentId, "personal-photon", quotes[0].id]]);
    expect(repo.commits.filter((c) => c.message.startsWith("intent")).map((c) => c.author)).toEqual(["personal-desktop", "personal-photon"]);
    expect((await activity(h)).filter((e) => e.event === "memory.write" && e.result === "failed")).toEqual([]);
    // the request and its accept are one source, however many agents touched it
    const e = await entry(h, "pref.color");
    expect(e).toMatchObject({ status: "candidate" });
    expect(e!.evidence.map((x) => [x.agentId, x.intentId])).toEqual([["personal-desktop", i.body.intentId]]);
  });

  it("on lane C's real git repo: no failed history write, the commit's author is the accepting agent", async () => {
    const w = await realWorkspace();
    const i = await w.post("/personal/intents", w.keys.desktop, { text: "trail shoes", public: { budget: "120" } });
    expect(i.status).toBe(201);
    const quotes = (await w.get(`/personal/intents/${i.body.intentId}/quotes?wait=0`, w.keys.personal)).body.quotes;
    expect(quotes.length).toBeGreaterThan(0);
    expect((await w.post(`/personal/quotes/${quotes[0].id}/accept`, w.keys.personal)).body.status).toBe("handoff");
    await w.deps.learning.settle();
    const failed = ((await w.get("/owner/activity?limit=500", w.keys.owner)).body.events as Array<{ event: string; result: string }>)
      .filter((e) => e.event === "memory.write" && e.result === "failed");
    expect(failed).toEqual([]);
    const authors = execFileSync("git", ["-C", w.repoPath, "log", "--format=%an %s"], { encoding: "utf8" }).split("\n").filter((l) => /intent/i.test(l));
    expect(authors.map((l) => l.split(" ")[0])).toEqual(["sample-personal-photon", "sample-personal-desktop"]);
    await w.deps.close();
  });

  it("the repo still refuses another user's record, and a record whose agent is not its author (no impersonation)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ac-b49-"));
    const repo = await openMemoryRepo({ path: join(dir, "memory"), seedDir: resolve(REPO_ROOT, "fixtures/memory"), userId: "u_sample", rules });
    const meta = (author: string) => ({ author, sig: "0".repeat(64), at });
    const record = { id: "i_x", userId: "u_sample", agentId: "sample-personal-desktop", public: {}, createdAt: at };
    await expect(repo.appendIntent!({ ...record, userId: "u_other" }, meta("sample-personal-desktop"))).rejects.toMatchObject({ code: "SCOPE_DENIED" });
    await expect(repo.appendIntent!(record, meta("sample-personal-photon"))).rejects.toMatchObject({ code: "SCOPE_DENIED" });
    await expect(repo.appendIntent!(record, meta("sample-personal-desktop"))).resolves.toMatchObject({ sha: expect.any(String) });
  });
});

describe("B49 ①: the learner is lane B's, keyed by ANTHROPIC_API_KEY", () => {
  const fake: LearnModule & { opts: unknown[] } = {
    opts: [],
    createHaikuExtractor(o) { this.opts.push(o); return "extractor"; },
    createWorkspaceLearner(o) { this.opts.push(o); return { extract: async () => [], extractFromConversation: async () => [] }; },
  };
  it("no key → learns nothing (never synthetic), and says why; a key → createWorkspaceLearner(createHaikuExtractor({ apiKey }))", () => {
    const base = loadConfig({ FIXTURES_DIR: SAMPLE_FIXTURES_DIR });
    expect(loadLearn(base, fake)).toEqual({ api: NO_LEARNING, reason: "no ANTHROPIC_API_KEY" });
    const keyed = loadConfig({ FIXTURES_DIR: SAMPLE_FIXTURES_DIR, ANTHROPIC_API_KEY: "sk-test-not-a-real-key" });
    expect(loadLearn(keyed, undefined)).toEqual({ api: NO_LEARNING, reason: "@agent-cookie/learn not installed" });
    expect(loadLearn(keyed, fake).reason).toBeUndefined();
    expect(fake.opts).toEqual([{ apiKey: "sk-test-not-a-real-key" }, { extract: "extractor", mode: "all" }]);
  });

  it("a workspace started without a key says learning is off, and why", async () => {
    const h = await harness();
    expect((await activity(h)).find((e) => e.event === "learn.off")).toMatchObject({ result: "off", reason: "no ANTHROPIC_API_KEY" });
  });

  it("the key never reaches the activity log", async () => {
    const h = await harness({ env: { ANTHROPIC_API_KEY: "sk-test-not-a-real-key" } });
    expect(JSON.stringify(await activity(h))).not.toContain("sk-test");
  });
});

/** A workspace on lane C's fixtures, the real git memory repo and real rules, with a stub UCP. */
async function realWorkspace() {
  const dir = mkdtempSync(join(tmpdir(), "ac-b49-ws-"));
  const repoPath = join(dir, "memory");
  const config = loadConfig({ SQLITE_PATH: ":memory:", MEMORY_REPO_PATH: repoPath, AGENT_COOKIE_DATA_DIR: dir, AGENT_COOKIE_DEMO: "1", AGENT_COOKIE_TEST: "1" });
  const deps = await createDeps(config, { ucp: StubUcp.fromFile(resolve(SAMPLE_FIXTURES_DIR, "ucp-offers.json"), "requires_escalation"), learn: NO_LEARNING });
  const app = createApp(deps);
  const devKeys = JSON.parse(readFileSync(resolve(REPO_ROOT, "fixtures/dev-keys.json"), "utf8")) as Record<string, { agentId: string; role: string }>;
  const keyOf = (pred: (v: { agentId: string; role: string }) => boolean) => Object.entries(devKeys).find(([, v]) => pred(v))![0];
  const keys = { personal: keyOf((v) => v.agentId === "sample-personal-photon"), desktop: keyOf((v) => v.agentId === "sample-personal-desktop"),
    owner: keyOf((v) => v.role === "owner") };
  const call = async (method: string, path: string, key?: string, body?: unknown) => {
    const headers: Record<string, string> = key ? { authorization: `Bearer ${key}` } : {};
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let parsed: any = text;
    try { parsed = JSON.parse(text); } catch { /* text */ }
    return { status: res.status, body: parsed };
  };
  return { deps, repoPath, keys, get: (p: string, k?: string) => call("GET", p, k), post: (p: string, k?: string, b?: unknown) => call("POST", p, k, b ?? {}) };
}
