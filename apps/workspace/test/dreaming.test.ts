// Dreaming (2026-10-18, human direction): the periodic job that learns, decays and archives. The clock is injected
// (Clock.at) — nothing here depends on the system time. The compaction is exercised on the contract-faithful stub and,
// once lane C ships MemoryRepo.compact, on the real git repo (that case is skipped until then); concurrency runs on
// the real git repo.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DREAMING_AUTHOR, type ContributionCandidate, type LearnApi, type ObservationTurn } from "@agent-cookie/contract";
import { openMemoryRepo } from "@agent-cookie/memory-repo";
import { rules } from "@agent-cookie/rules";
import { createApp } from "../src/app.js";
import { Clock } from "../src/clock.js";
import { loadConfig, REPO_ROOT } from "../src/config.js";
import { createDeps } from "../src/deps.js";
import type { InMemoryRepo } from "./stubs/memory-repo.js";
import { StubUcp } from "./stubs/ucp.js";
import { callbackServer, harness, KEYS, SAMPLE_FIXTURES_DIR } from "./harness.js";

const DAY = 86_400_000;
const START = "2026-10-17T12:00:00.000Z";
type H = Awaited<ReturnType<typeof harness>>;

class Learner implements LearnApi {
  onConversation: (turns: ObservationTurn[]) => ContributionCandidate[] = () => [];
  async extract() { return []; }
  async extractFromConversation(turns: ObservationTurn[]) { return this.onConversation(turns); }
}
const turn = (text: string): ObservationTurn => ({ role: "user", text, at: START });
const observe = (h: H, conversationId: string, text: string, key = KEYS.personal) =>
  h.post("/personal/observations", key, { channel: "imessage", conversationId, turns: [turn(text)] });
const dream = async (h: H) => {
  const r = await h.post("/owner/dreaming/run", KEYS.owner);
  expect(r.status).toBe(200);
  return r.body as { stats: { learned: number; promoted: number; decayed: number; archived: number }; decayedFields: string[];
    steps: Array<{ step: string; result: string; reason?: string }> };
};
const cardEntry = async (h: H, field: string) =>
  ((await h.get("/personal/card", KEYS.personal)).body.card as Array<{ field: string; value: string; confidence: string }>).find((f) => f.field === field);
const activity = async (h: H) => (await h.get("/owner/activity?limit=500", KEYS.owner)).body.events as Array<Record<string, any>>;

afterEach(() => { vi.useRealTimers(); });

const REAL_HAS_COMPACT = await (async () => {
  const dir = mkdtempSync(join(tmpdir(), "ac-probe-"));
  const r = await openMemoryRepo({ path: join(dir, "memory"), seedDir: resolve(REPO_ROOT, "fixtures/memory"), userId: "u_probe", rules });
  return typeof r.compact === "function";
})();

describe("compaction (MemoryRepo.compact, plan: current value + 3 superseded)", () => {
  it("a field with 5 superseded values keeps the current one plus 3; 2 lines move to archive/<month>.md in one commit by dreaming", async () => {
    const clock = Clock.at(START);
    const h = await harness({ clock });
    for (let i = 1; i <= 6; i++) {
      expect((await h.post("/personal/contributions", KEYS.personal, { field: "pref.style", value: `s${i}` })).status).toBe(201);
      clock.advance(60_000);
    }
    const repo = h.deps.repo as InMemoryRepo;
    expect(repo.linesFor("pref.style").map((c) => c.value)).toEqual(["s1", "s2", "s3", "s4", "s5", "s6"]);
    const commitsBefore = repo.commits.length;

    const run = await dream(h);
    expect(run.stats.archived).toBe(2);
    expect(run.steps.find((s) => s.step === "compact")).toEqual({ step: "compact", result: "ok" });
    expect(repo.linesFor("pref.style").map((c) => c.value)).toEqual(["s3", "s4", "s5", "s6"]);
    const archived = repo.archive.get(START.slice(0, 7))!;
    expect(archived).toHaveLength(2);
    for (const [i, line] of archived.entries()) {
      expect(line).toMatch(new RegExp(`^- pref\\.style: s${i + 1} \\[.*\\] \\[archivedAt: ${clock.nowIso().replace(/[.]/g, "\\.")}; from: contributions/personal-photon\\.md\\]$`));
    }
    const compactCommits = repo.commits.slice(commitsBefore).filter((c) => c.message.startsWith("compact"));
    expect(compactCommits).toHaveLength(1);
    expect(compactCommits[0]!.author).toBe(DREAMING_AUTHOR);
    // SQLite mirrors the move; the card is unchanged
    const rows = h.deps.store.db.prepare("SELECT value, archived_at FROM contributions WHERE field = 'pref.style' ORDER BY seq").all() as Array<{ value: string; archived_at: string | null }>;
    expect(rows.map((r) => [r.value, r.archived_at !== null])).toEqual([["s1", true], ["s2", true], ["s3", false], ["s4", false], ["s5", false], ["s6", false]]);
    expect((await cardEntry(h, "pref.style"))?.value).toBe("s6");
    // a second run has nothing left to move: no commit
    const again = await dream(h);
    expect(again.stats.archived).toBe(0);
    expect(repo.commits.filter((c) => c.message.startsWith("compact"))).toHaveLength(1);
  });

  // Conformance of lane C's real git repo with the contract. Skipped until @agent-cookie/memory-repo implements compact.
  it.skipIf(!REAL_HAS_COMPACT)("the real git memory repo: same scenario, archive file on disk, git author dreaming", async () => {
    const w = await realWorkspace(Clock.at(START));
    for (let i = 1; i <= 6; i++) {
      expect((await w.post("/personal/contributions", w.keys.personal, { field: "pref.style", value: `s${i}` })).status).toBe(201);
      w.clock.advance(60_000);
    }
    const r = await w.post("/owner/dreaming/run", w.keys.owner);
    expect(r.body.stats.archived).toBe(2);
    const contributions = readFileSync(join(w.repoPath, "contributions", "sample-personal-photon.md"), "utf8").split("\n").filter((l) => l.startsWith("- pref.style:"));
    expect(contributions.map((l) => l.split(" ")[2])).toEqual(["s3", "s4", "s5", "s6"]);
    const archive = readFileSync(join(w.repoPath, "archive", `${START.slice(0, 7)}.md`), "utf8").split("\n").filter((l) => l.startsWith("- pref.style:"));
    expect(archive).toHaveLength(2);
    expect(execFileSync("git", ["-C", w.repoPath, "log", "-1", "--format=%an"], { encoding: "utf8" }).trim()).toBe(DREAMING_AUTHOR);
    await w.deps.close();
  });
});

describe("learning in Dreaming (lane C's two-source rule)", () => {
  it("two different conversations about the same preference: a candidate after the first run, on the card after the second", async () => {
    const learner = new Learner();
    learner.onConversation = () => [{ field: "pref.brand", value: "Brooks" }];
    const clock = Clock.at(START);
    const h = await harness({ learn: learner, clock });
    await observe(h, "monday", "I only run in Brooks");
    clock.advance(301_000);
    let run = await dream(h);
    expect(run.stats).toMatchObject({ learned: 1, promoted: 0 });
    expect(await cardEntry(h, "pref.brand")).toBeUndefined();
    expect((await h.get("/personal/learned", KEYS.personal)).body.learned).toEqual([expect.objectContaining({ value: "Brooks", status: "candidate" })]);

    await observe(h, "friday", "Brooks again for the trail");
    clock.advance(301_000);
    run = await dream(h);
    expect(run.stats).toMatchObject({ learned: 1, promoted: 1 });
    expect((await cardEntry(h, "pref.brand"))?.value).toBe("Brooks");
  });

  it("the same conversation twice is still one source", async () => {
    const learner = new Learner();
    learner.onConversation = () => [{ field: "pref.color", value: "green" }];
    const clock = Clock.at(START);
    const h = await harness({ learn: learner, clock });
    for (let i = 0; i < 2; i++) {
      await observe(h, "same-chat", `green, please (${i})`);
      clock.advance(301_000);
      await dream(h);
    }
    expect(await cardEntry(h, "pref.color")).toBeUndefined();
    expect((await h.get("/personal/learned", KEYS.personal)).body.learned).toEqual([expect.objectContaining({ value: "green", status: "candidate" })]);
  });

  it("not-yet-due conversations wait for a later run; learning never happens on arrival", async () => {
    const learner = new Learner();
    const calls: number[] = [];
    learner.onConversation = (turns) => { calls.push(turns.length); return []; };
    const clock = Clock.at(START);
    const h = await harness({ learn: learner, clock });
    await observe(h, "c", "hello");
    expect(calls).toEqual([]);
    clock.advance(120_000);
    await dream(h);
    expect(calls).toEqual([]);
    clock.advance(181_000);
    await dream(h);
    expect(calls).toEqual([1]);
  });

  it("a field Dreaming put on the card shows up in the next introduction's handshake (read side unchanged)", async () => {
    const learner = new Learner();
    learner.onConversation = () => [{ field: "pref.color", value: "teal" }];
    const clock = Clock.at(START);
    const h = await harness({ learn: learner, clock });
    const cb = await callbackServer();
    try {
      await h.registerMerchant({ category: "retail", capabilities: ["gifts"], callbackUrl: cb.url });
      for (const conversation of ["a", "b"]) {
        await observe(h, conversation, "teal is my colour");
        clock.advance(301_000);
        await dream(h);
      }
      await h.post("/personal/intents", KEYS.personal, { text: "a gift", kind: "gifts" });
      await h.deps.delivery.settle();
      const intro = (cb.bodies as Array<{ type: string; handshake: { available: string[] } }>).find((b) => b.type === "introduce")!;
      expect(intro.handshake.available).toContain("pref.color");
    } finally {
      cb.close();
    }
  });
});

describe("decay (180 days → medium, 365 → off the card)", () => {
  it("a two-source field drops to medium at 181 days and is reported as decayed; at 366 days it is off the card", async () => {
    const clock = Clock.at(START);
    const h = await harness({ clock });
    expect(await cardEntry(h, "shoe_size")).toMatchObject({ value: "42", confidence: "high" });
    const lastSupport = Date.parse("2026-10-01T09:00:00.000Z"); // the newest seed support for shoe_size (two sources)
    clock.advance(lastSupport + 181 * DAY - clock.now());
    let run = await dream(h);
    expect(await cardEntry(h, "shoe_size")).toMatchObject({ value: "42", confidence: "medium" });
    expect(run.decayedFields).toContain("shoe_size");
    expect(run.stats.decayed).toBe(run.decayedFields.length);

    clock.advance(185 * DAY);
    run = await dream(h);
    expect(await cardEntry(h, "shoe_size")).toBeUndefined();
    expect(run.decayedFields).toContain("shoe_size");
    // decayed is about age only: a field that is merely single-source and fresh never appears
    expect(run.decayedFields).not.toContain("pref.brand");
  });
});

describe("isolation, scheduling and access", () => {
  it("a failing step is logged and the following steps still run; the request answers 200", async () => {
    const h = await harness();
    const repo = h.deps.repo as InMemoryRepo;
    repo.regenerateCard = async () => { throw new Error("disk full"); };
    const run = await dream(h);
    expect(run.steps.map((s) => [s.step, s.result])).toEqual([["learn", "ok"], ["regenerate", "failed"], ["compact", "ok"], ["log", "ok"]]);
    const events = await activity(h);
    expect(events.find((e) => e.event === "dreaming.step")).toMatchObject({ object: "regenerate", result: "failed", kind: "dreaming" });
    expect(events.find((e) => e.event === "dreaming")).toMatchObject({ result: "partial", kind: "dreaming",
      stats: { learned: 0, promoted: 0, decayed: 0, archived: 0 } });
  });

  it("the activity event carries counts and field names only, and a run never touches notes, grants or sessions", async () => {
    const learner = new Learner();
    learner.onConversation = () => [{ field: "pref.brand", value: "SecretBrandValue" }];
    const clock = Clock.at(START);
    const h = await harness({ learn: learner, clock });
    const m = await h.registerMerchant({ callbackUrl: "http://127.0.0.1:9/cb" });
    await h.post("/personal/intents", KEYS.personal, { text: "shoes", kind: "trail_shoes" });
    const s = await h.sessionOf(m.agentId);
    await h.put(`/agent/notes/last?sessionId=${s.sessionId}`, m.key, { value: "a note" });
    const snapshot = () => JSON.stringify(["sessions", "grants", "notes"].map((t) => h.deps.store.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()));
    const before = snapshot();
    await observe(h, "c", "SecretBrandValue forever");
    clock.advance(301_000);
    await dream(h);
    expect(snapshot()).toBe(before);
    const ev = (await activity(h)).filter((e) => e.kind === "dreaming");
    expect(ev).toHaveLength(1);
    expect(JSON.stringify(ev)).not.toContain("SecretBrandValue");
    expect(ev[0]!.stats).toMatchObject({ learned: 1 });
  });

  it("DREAMING_INTERVAL_MS=0 never schedules a run; any other value runs on that period", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const off = await harness({ env: { DREAMING_INTERVAL_MS: "0" } });
    expect(off.deps.dreamingScheduled).toBe(false);
    vi.advanceTimersByTime(60 * 60 * 1000);
    await off.deps.dreaming.settle();
    expect((await activity(off)).filter((e) => e.event === "dreaming")).toEqual([]);

    const on = await harness({ env: { DREAMING_INTERVAL_MS: "30000" } });
    expect(on.deps.dreamingScheduled).toBe(true);
    vi.advanceTimersByTime(29_999);
    await on.deps.dreaming.settle();
    expect((await activity(on)).filter((e) => e.event === "dreaming")).toEqual([]);
    vi.advanceTimersByTime(1);
    await on.deps.dreaming.settle();
    expect((await activity(on)).filter((e) => e.event === "dreaming")).toHaveLength(1);
    await on.deps.close();
    expect(loadConfig({ FIXTURES_DIR: SAMPLE_FIXTURES_DIR }).dreamingIntervalMs).toBe(300_000);
  });

  it("POST /owner/dreaming/run is the owner's: personal and merchant keys get 403, no key 401", async () => {
    const h = await harness();
    expect((await h.post("/owner/dreaming/run", KEYS.personal)).status).toBe(403);
    expect((await h.post("/owner/dreaming/run", KEYS.acme)).status).toBe(403);
    expect((await h.post("/owner/dreaming/run")).status).toBe(401);
    expect((await h.post("/owner/dreaming/run", KEYS.owner)).status).toBe(200);
  });
});

describe("Dreaming and concurrent writes on the real git memory repo", () => {
  it("runs alongside concurrent contributions: no errors, no git conflict, CARD.md ends up matching the card", async () => {
    const w = await realWorkspace(Clock.at(START));
    const writes = Array.from({ length: 8 }, (_, i) =>
      w.post("/personal/contributions", w.keys.personal, { field: i % 2 ? "pref.style" : "pref.material", value: `v${i}` }));
    const runs = [w.post("/owner/dreaming/run", w.keys.owner), w.post("/owner/dreaming/run", w.keys.owner)];
    const results = await Promise.all([...writes, ...runs]);
    expect(results.slice(0, 8).map((r) => r.status)).toEqual(Array(8).fill(201));
    expect(results.slice(8).map((r) => r.status)).toEqual([200, 200]);
    await w.post("/owner/dreaming/run", w.keys.owner); // settles CARD.md after the last write
    const events = (await w.get("/owner/activity?limit=500", w.keys.owner)).body.events as Array<{ event: string; result: string }>;
    expect(events.filter((e) => e.event === "memory.write" || e.event === "dreaming.step")).toEqual([]);
    expect(execFileSync("git", ["-C", w.repoPath, "status", "--porcelain"], { encoding: "utf8" })).toBe("");
    expect(existsSync(join(w.repoPath, ".git", "index.lock"))).toBe(false);
    expect(execFileSync("git", ["-C", w.repoPath, "log", "--format=%an"], { encoding: "utf8" }).split("\n")).toContain(DREAMING_AUTHOR);
    // CARD.md's card section lists exactly what the workspace serves
    const md = readFileSync(join(w.repoPath, "CARD.md"), "utf8");
    const section = md.split("## Card")[1]!.split("## ")[0]!;
    const inFile = [...section.matchAll(/^- ([a-z_.]+): (.*?) \[/gm)].map((m) => `${m[1]}=${m[2]}`).sort();
    const served = ((await w.get("/personal/card", w.keys.personal)).body.card as Array<{ field: string; value: string }>)
      .map((f) => `${f.field}=${f.value}`).sort();
    expect(inFile).toEqual(served);
    await w.deps.close();
  });
});

/** A workspace on lane C's fixtures, the real git memory repo and real rules, with a stub UCP and an injected clock. */
async function realWorkspace(clock: Clock) {
  const dir = mkdtempSync(join(tmpdir(), "ac-dream-"));
  const repoPath = join(dir, "memory");
  const config = loadConfig({ SQLITE_PATH: ":memory:", MEMORY_REPO_PATH: repoPath, AGENT_COOKIE_DATA_DIR: dir, AGENT_COOKIE_DEMO: "1",
    AGENT_COOKIE_TEST: "1", DREAMING_INTERVAL_MS: "0" });
  const deps = await createDeps(config, { ucp: StubUcp.fromFile(resolve(SAMPLE_FIXTURES_DIR, "ucp-offers.json"), "requires_escalation"), clock });
  const app = createApp(deps);
  const devKeys = JSON.parse(readFileSync(resolve(REPO_ROOT, "fixtures/dev-keys.json"), "utf8")) as Record<string, { agentId: string; role: string }>;
  const keyOf = (pred: (v: { agentId: string; role: string }) => boolean) => Object.entries(devKeys).find(([, v]) => pred(v))![0];
  const keys = { personal: keyOf((v) => v.agentId === "sample-personal-photon"), owner: keyOf((v) => v.role === "owner") };
  const call = async (method: string, path: string, key?: string, body?: unknown) => {
    const headers: Record<string, string> = key ? { authorization: `Bearer ${key}` } : {};
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let parsed: any = text;
    try { parsed = JSON.parse(text); } catch { /* text */ }
    return { status: res.status, body: parsed };
  };
  return { deps, clock, repoPath, keys, get: (p: string, k?: string) => call("GET", p, k), post: (p: string, k?: string, b?: unknown) => call("POST", p, k, b ?? {}) };
}
