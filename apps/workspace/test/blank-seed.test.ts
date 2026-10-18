// AGENT_COOKIE_SEED=blank: the instance the hosted gateway starts for each person (contract gateway.ts). One owner with a
// generated id and secret, no contribution, no agent, never a Sample key (not even in demo/test mode), a minted
// <dataDir>/owner.key, and an empty git memory repo (the real @agent-cookie/memory-repo here, in a temp dir).
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalPolicy, DEFAULT_POLICY, policyId } from "@agent-cookie/contract";
import { openMemoryRepo } from "@agent-cookie/memory-repo";
import { parsePolicyDocument, policyYamlOrigin, rules } from "@agent-cookie/rules";
import { loadConfig } from "../src/config.js";
import { hashKey } from "../src/ids.js";
import { BLANK_MEMORY_SEED_DIR, writeBlankMemorySeed } from "../src/seed.js";
import { assistantSafe } from "../src/services/assistant.js";
import { harness, KEYS, SAMPLE_FIXTURES_DIR } from "./harness.js";

type H = Awaited<ReturnType<typeof harness>>;
const opened: H[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const h of opened.splice(0)) await h.deps.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "ac-blank-"));
  dirs.push(d);
  return d;
}

/** A blank instance on the real memory repo. harness() keeps AGENT_COOKIE_DEMO=1 and AGENT_COOKIE_TEST=1 on purpose. */
async function blank(dir: string, env: Record<string, string> = {}): Promise<H> {
  const h = await harness({ memoryRepoApi: { openMemoryRepo }, env: { AGENT_COOKIE_SEED: "blank", AGENT_COOKIE_DATA_DIR: dir,
    MEMORY_REPO_PATH: join(dir, "memory"), ...env } });
  opened.push(h);
  return h;
}

const ownerKey = (dir: string) => readFileSync(join(dir, "owner.key"), "utf8").trim();
const managed = (dir: string, file: string) => readFileSync(join(dir, "memory", file), "utf8");
const git = (repo: string, ...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });

describe("AGENT_COOKIE_SEED=blank", () => {
  it("seeds exactly one generated user and nothing else; no Sample key opens anything, even in demo/test mode", async () => {
    const dir = tempDir();
    const h = await blank(dir);
    const users = h.deps.store.db.prepare("SELECT * FROM users").all() as Array<{ user_id: string; name: string; secret: string }>;
    expect(users).toHaveLength(1);
    const [u] = users;
    expect(u!.user_id).toMatch(/^usr_[0-9a-z]{8}$/);
    expect(u!.name).toBe("owner");
    expect(u!.secret.length).toBeGreaterThanOrEqual(50);
    expect(u!.secret).not.toBe("sample-user-secret-0001");
    expect(h.deps.store.agents()).toEqual([]);
    expect(h.deps.store.contributionsForUser(u!.user_id)).toEqual([]);
    for (const key of Object.values(KEYS)) expect((await h.get("/me", key)).status).toBe(401);

    // The one key: the minted owner key, written 0600 under the data dir.
    const keys = h.deps.store.db.prepare("SELECT key_hash, agent_id, role FROM keys").all();
    expect(keys).toEqual([{ key_hash: hashKey(ownerKey(dir)), agent_id: "owner", role: "owner" }]);
    expect(statSync(join(dir, "owner.key")).mode & 0o777).toBe(0o600);
    expect((await h.get("/me", ownerKey(dir))).body).toEqual({ agentId: "owner", category: "personal", role: "owner" });

    expect((await h.get("/personal/card", ownerKey(dir))).body).toEqual({ card: [], candidates: [], superseded: [], source: "live" });
    const policy = (await h.get("/personal/policy", ownerKey(dir))).body;
    expect(policy).toMatchObject({ policyId: policyId(DEFAULT_POLICY), source: "default" });
  });

  it("GET /healthz needs no key, reports the seed and nothing else, and writes no activity row", async () => {
    const dir = tempDir();
    const h = await blank(dir);
    const before = h.deps.store.activity(1000).length;
    const r = await h.get("/healthz");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, seed: "blank" });
    expect(h.deps.store.activity(1000).length).toBe(before);
  });

  it("starts an empty memory repo: only the managed files of an empty card, POLICY.yaml from DEFAULT_POLICY, no Sample record", async () => {
    const dir = tempDir();
    const h = await blank(dir);
    const userId = h.deps.store.firstUser()!.userId;
    const repo = join(dir, "memory");
    expect(git(repo, "ls-tree", "-r", "--name-only", "fixtures-seed").trim().split("\n"))
      .toEqual(["CARD.md", "MEMORY.md", "POLICY.yaml", "contributions/.gitkeep", "notes/.gitkeep", "receipts.md"]);
    expect(readdirSync(join(repo, "contributions"))).toEqual([".gitkeep"]);
    expect(await h.deps.repo.listContributions()).toEqual([]);

    const card = managed(dir, "CARD.md");
    expect(card).toContain(`# CARD · ${userId}\n`);
    expect(card).toContain("## Card\n_none_\n");
    expect(card).toContain("## Candidates\n_none_\n");
    expect(card).toContain("## Superseded\n_none_\n");
    const policyText = managed(dir, "POLICY.yaml");
    expect(policyYamlOrigin(policyText)).toBe("seed");
    expect(canonicalPolicy(parsePolicyDocument(policyText))).toBe(canonicalPolicy(DEFAULT_POLICY));
    for (const file of ["MEMORY.md", "CARD.md", "POLICY.yaml", "receipts.md"]) {
      const text = managed(dir, file);
      expect(text, file).not.toMatch(/sample/i);
      expect(text, file).not.toContain("Example Lane");
    }
    // The generated seed directory sits under the data dir, beside the repo, and holds the same bytes as the seed commit.
    expect(readFileSync(join(dir, BLANK_MEMORY_SEED_DIR, "CARD.md"), "utf8")).toBe(git(repo, "show", "fixtures-seed:CARD.md"));
  });

  it("registration works; a linked assistant reads an empty context with every field unknown", async () => {
    const dir = tempDir();
    const h = await blank(dir);
    const merchant = await h.post("/agents/register", undefined, { name: "Store", category: "shoe", capabilities: ["trail_shoes"] });
    expect(merchant.status).toBe(201);
    const reg = await h.post("/agents/register", undefined, { name: "Assistant", category: "assistant" });
    expect(reg.status).toBe(201);
    expect(reg.body).toMatchObject({ category: "assistant", role: "assistant" });
    const link = await h.post("/assistant/link", reg.body.key);
    expect(link.status).toBe(201);
    expect((await h.post(`/owner/links/${link.body.id}/approve`, ownerKey(dir))).status).toBe(200);
    const ctx = await h.get("/assistant/context", reg.body.key);
    expect(ctx.status).toBe(200);
    expect(ctx.body.fields).toEqual({});
    expect(ctx.body.unknown).toEqual(assistantSafe(DEFAULT_POLICY.auto.assistant));
    expect(ctx.body.policyId).toBe(policyId(DEFAULT_POLICY));
  });

  it("a restart keeps the same user and owner key and adds no fixture agent", async () => {
    const dir = tempDir();
    const env = { SQLITE_PATH: join(dir, "workspace.sqlite") };
    const first = await blank(dir, env);
    const user = first.deps.store.firstUser()!;
    const key = ownerKey(dir);
    // A linked assistant searches UCP: commerce adds `ucp:<domain>` proxies on demand, some with the same ids as UCP
    // proxies in the fixtures' agents.json. They are this instance's own and must not read as Sample data on restart.
    const reg = await first.post("/agents/register", undefined, { name: "Assistant", category: "assistant" });
    const link = await first.post("/assistant/link", reg.body.key);
    await first.post(`/owner/links/${link.body.id}/approve`, key);
    expect((await first.post("/personal/intents", reg.body.key, { text: "trail shoes", public: { budget: "200" } })).status).toBe(201);
    const proxies = first.deps.store.agents().filter((a) => a.domain).map((a) => a.agentId);
    expect(proxies).toContain("ucp:shoebacca.com");
    await first.deps.close();
    opened.splice(opened.indexOf(first), 1);

    const second = await blank(dir, env);
    expect(second.deps.store.db.prepare("SELECT user_id, secret FROM users").all()).toEqual([{ user_id: user.userId, secret: user.secret }]);
    expect(second.deps.store.agents().filter((a) => !a.domain).map((a) => a.category)).toEqual(["assistant"]);
    expect(second.deps.store.agents().filter((a) => a.domain).map((a) => a.agentId)).toEqual(proxies);
    expect(ownerKey(dir)).toBe(key);
    expect((await second.get("/me", key)).body.role).toBe("owner");
    for (const k of Object.values(KEYS)) expect((await second.get("/me", k)).status).toBe(401);
  });

  it("POST /demo/reset returns to blank: same user, same owner key, no agent, empty card and repo", async () => {
    const dir = tempDir();
    const h = await blank(dir);
    const user = h.deps.store.firstUser()!;
    const owner = ownerKey(dir);
    const personal = await h.post("/agents/register", owner, { name: "My agent", category: "personal" });
    expect(personal.status).toBe(201);
    expect((await h.post("/personal/contributions", personal.body.key, { field: "lang", value: "en" })).status).toBe(201);
    expect((await h.get("/personal/card", owner)).body.card.map((f: { field: string }) => f.field)).toEqual(["lang"]);

    expect((await h.post("/demo/reset", owner)).status).toBe(200);
    expect(h.deps.store.db.prepare("SELECT user_id, secret FROM users").all()).toEqual([{ user_id: user.userId, secret: user.secret }]);
    expect(h.deps.store.agents()).toEqual([]);
    expect((await h.get("/me", personal.body.key)).status).toBe(401);
    expect((await h.get("/me", owner)).body.role).toBe("owner");
    expect(ownerKey(dir)).toBe(owner);
    expect((await h.get("/personal/card", owner)).body).toEqual({ card: [], candidates: [], superseded: [], source: "live" });
    expect(await h.deps.repo.listContributions()).toEqual([]);
    expect(managed(dir, "CARD.md")).toContain("## Card\n_none_\n");
    for (const key of Object.values(KEYS)) expect((await h.get("/me", key)).status).toBe(401);
  });

  it("refuses a database that holds the Sample seed", async () => {
    const dir = tempDir();
    const env = { SQLITE_PATH: join(dir, "workspace.sqlite"), AGENT_COOKIE_DATA_DIR: dir };
    const sample = await harness({ env });
    await sample.deps.close();
    await expect(harness({ env: { ...env, AGENT_COOKIE_SEED: "blank", MEMORY_REPO_PATH: join(dir, "memory") }, memoryRepoApi: { openMemoryRepo } }))
      .rejects.toThrow(/holds the Sample seed/);
    expect(existsSync(join(dir, "memory"))).toBe(false);
  });
});

describe("configuration", () => {
  it("AGENT_COOKIE_SEED defaults to sample and takes only sample or blank", () => {
    expect(loadConfig({ FIXTURES_DIR: SAMPLE_FIXTURES_DIR }).seed).toBe("sample");
    expect(loadConfig({ FIXTURES_DIR: SAMPLE_FIXTURES_DIR, AGENT_COOKIE_SEED: "blank" }).seed).toBe("blank");
    expect(() => loadConfig({ FIXTURES_DIR: SAMPLE_FIXTURES_DIR, AGENT_COOKIE_SEED: "persona" })).toThrow(/AGENT_COOKIE_SEED/);
  });

  it("a blank instance needs no seed fixtures; fixture replay does not need demo mode", () => {
    const empty = tempDir();
    expect(() => loadConfig({ FIXTURES_DIR: empty })).toThrow(/no fixtures/);
    expect(loadConfig({ FIXTURES_DIR: empty, AGENT_COOKIE_SEED: "blank" }).seed).toBe("blank");
    const c = loadConfig({ FIXTURES_DIR: SAMPLE_FIXTURES_DIR, AGENT_COOKIE_SEED: "blank", AGENT_COOKIE_UCP: "fixture" });
    expect(c).toMatchObject({ ucpMode: "fixture", demo: false, test: false });
  });

  it("the blank memory seed never overlaps the memory repo", () => {
    const dir = tempDir();
    const at = (memory: string) => loadConfig({ FIXTURES_DIR: SAMPLE_FIXTURES_DIR, AGENT_COOKIE_SEED: "blank", AGENT_COOKIE_DATA_DIR: dir, MEMORY_REPO_PATH: memory });
    const now = "2026-10-18T00:00:00.000Z";
    expect(() => writeBlankMemorySeed(at(join(dir, BLANK_MEMORY_SEED_DIR)), rules, "usr_test0000", now)).toThrow(/overlap/);
    expect(() => writeBlankMemorySeed(at(dir), rules, "usr_test0000", now)).toThrow(/overlap/);
    const seed = writeBlankMemorySeed(at(join(dir, "memory")), rules, "usr_test0000", now);
    const again = readFileSync(join(seed, "CARD.md"), "utf8");
    expect(writeBlankMemorySeed(at(join(dir, "memory")), rules, "usr_test0000", now)).toBe(seed);
    expect(readFileSync(join(seed, "CARD.md"), "utf8")).toBe(again);
  });
});

describe("GET /healthz (sample seed)", () => {
  it("reports sample with no key", async () => {
    const h = await harness();
    opened.push(h);
    const r = await h.get("/healthz");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, seed: "sample" });
  });
});
