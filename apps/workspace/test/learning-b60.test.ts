// B60: evidence.models — which models produced a learned value (gate = the classifier that let the turn be learned
// from, extractor = the model that produced the value). Kept in SQLite and shown in GET /personal/learned; never
// handed to RulesApi.mergeCard; written to the memory repo as `gate:` / `extractor:` only once the rules render it.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Contribution, ContributionCandidate, LearnApi, RulesApi } from "@agent-cookie/contract";
import { rules as realRules } from "@agent-cookie/rules";
import { createApp } from "../src/app.js";
import { loadConfig, REPO_ROOT } from "../src/config.js";
import { createDeps } from "../src/deps.js";
import { rulesKeepModels, withoutModels } from "../src/services/provenance.js";
import type { InMemoryRepo } from "./stubs/memory-repo.js";
import { StubUcp } from "./stubs/ucp.js";
import { harness, KEYS, SAMPLE_FIXTURES_DIR } from "./harness.js";

type H = Awaited<ReturnType<typeof harness>>;
const MODELS = { gate: "typesafe/jev-1.14", extractor: "openai/gpt-oss-120b" };
const at = "2026-10-17T12:00:00.000Z";
const learner = (candidates: () => ContributionCandidate[]): LearnApi => ({ extract: async () => [], extractFromConversation: async () => candidates() });
const stated = (models: unknown): ContributionCandidate[] =>
  [{ field: "pref.color", value: "black", basis: "stated", evidence: { snippet: "I always prefer black", models } as ContributionCandidate["evidence"] }];
async function learnOnce(h: H, conversationId = "c1") {
  await h.post("/personal/observations", KEYS.personal, { channel: "imessage", conversationId, turns: [{ role: "user", text: "I always prefer black clothing.", at }] });
  await h.post("/test/clock", undefined, { offsetMs: 301_000 });
  await h.deps.learning.flushDue();
  await h.deps.learning.settle();
}
const learnedColor = async (h: H) =>
  ((await h.get("/personal/learned", KEYS.personal)).body.learned as Array<{ field: string; status: string; evidence: Array<Record<string, unknown>> }>)
    .find((e) => e.field === "pref.color");

/** Rules that already write evidence.models as open keys (what lane C will ship); mergeCard input is checked for models. */
function modelAwareRules(seen: { mergeInputsWithModels: number }): RulesApi {
  return {
    ...realRules,
    renderContribution: (c: Contribution) => {
      const line = realRules.renderContribution(withoutModels(c));
      const m = c.evidence?.models;
      return m ? line.replace(/\]$/, `${m.gate ? `; gate: ${m.gate}` : ""}${m.extractor ? `; extractor: ${m.extractor}` : ""}]`) : line;
    },
    mergeCard: (cs, o) => {
      seen.mergeInputsWithModels += cs.filter((c) => c.evidence?.models).length;
      return realRules.mergeCard(cs.map(withoutModels), o);
    },
  };
}

describe("B60: evidence.models", () => {
  it("is kept and shown in GET /personal/learned; the value still reaches the card", async () => {
    const h = await harness({ learn: learner(() => stated(MODELS)) });
    await learnOnce(h);
    const e = await learnedColor(h);
    expect(e).toMatchObject({ status: "card" });
    expect(e!.evidence).toEqual([expect.objectContaining({ conversationId: "c1", basis: "stated", models: MODELS })]);
  });

  it("drops ids that are not well-formed model ids (they are parameters, not authority)", async () => {
    for (const [models, kept] of [
      [{ gate: 7, extractor: "has spaces in it" }, undefined],
      [{ gate: "x".repeat(101), extractor: "openai/gpt-oss-120b" }, { extractor: "openai/gpt-oss-120b" }],
      [{ gate: "typesafe/jev-1.14", admin: true }, { gate: "typesafe/jev-1.14" }],
      ["typesafe/jev-1.14", undefined],
    ] as const) {
      const h = await harness({ learn: learner(() => stated(models)) });
      await learnOnce(h);
      const ev = (await learnedColor(h))!.evidence[0]!;
      if (kept) expect(ev.models).toEqual(kept);
      else expect(ev).not.toHaveProperty("models");
    }
  });

  it("is never handed to RulesApi.mergeCard", async () => {
    // today's rendering (models left out of the repo), so every mergeCard input with models would be the workspace's
    const seen = { mergeInputsWithModels: 0 };
    const spying: RulesApi = { ...realRules, mergeCard: (cs, o) => {
      seen.mergeInputsWithModels += cs.filter((c) => c.evidence?.models).length;
      return realRules.mergeCard(cs, o);
    } };
    const h = await harness({ learn: learner(() => stated(MODELS)), rules: spying });
    await learnOnce(h);
    expect((await learnedColor(h))!.evidence[0]!.models).toEqual(MODELS);
    await h.get("/personal/card", KEYS.personal);
    expect(seen.mergeInputsWithModels).toBe(0);
  });

  it("reaches the memory repo once the rules write it as gate:/extractor:, and is left out while they do not", async () => {
    // lane C's current rules: not yet — the write must still succeed, without models
    const plain = await harness({ learn: learner(() => stated(MODELS)) });
    expect(rulesKeepModels(realRules)).toBe(false);
    await learnOnce(plain);
    const plainRepo = (await (plain.deps.repo as InMemoryRepo).listContributions()).filter((c) => c.field === "pref.color");
    expect(plainRepo).toHaveLength(1);
    expect(plainRepo[0]!.evidence).not.toHaveProperty("models");
    // rules that render it: the repo gets evidence.models
    const aware = modelAwareRules({ mergeInputsWithModels: 0 });
    expect(rulesKeepModels(aware)).toBe(true);
    const h = await harness({ learn: learner(() => stated(MODELS)), rules: aware });
    await learnOnce(h);
    const inRepo = (await (h.deps.repo as InMemoryRepo).listContributions()).filter((c) => c.field === "pref.color");
    expect(inRepo[0]!.evidence?.models).toEqual(MODELS);
    expect(aware.renderContribution(inRepo[0]!)).toMatch(/; gate: typesafe\/jev-1\.14; extractor: openai\/gpt-oss-120b\]$/);
  });

  it("on lane C's real git repo the learned write succeeds today, and the line carries gate:/extractor: once the rules do", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ac-b60-"));
    const repoPath = join(dir, "memory");
    const deps = await createDeps(loadConfig({ SQLITE_PATH: ":memory:", MEMORY_REPO_PATH: repoPath, AGENT_COOKIE_DATA_DIR: dir, AGENT_COOKIE_DEMO: "1",
      AGENT_COOKIE_TEST: "1", DREAMING_INTERVAL_MS: "0" }), { ucp: StubUcp.fromFile(resolve(SAMPLE_FIXTURES_DIR, "ucp-offers.json"), "requires_escalation"),
      learn: learner(() => stated(MODELS)) });
    const app = createApp(deps);
    const devKeys = JSON.parse(readFileSync(resolve(REPO_ROOT, "fixtures/dev-keys.json"), "utf8")) as Record<string, { agentId: string; role: string }>;
    const key = (pred: (v: { agentId: string; role: string }) => boolean) => Object.entries(devKeys).find(([, v]) => pred(v))![0];
    const personal = key((v) => v.agentId === "sample-personal-photon"), owner = key((v) => v.role === "owner");
    const call = async (method: string, path: string, k?: string, body?: unknown) => {
      const res = await app.request(path, { method, headers: { ...(k ? { authorization: `Bearer ${k}` } : {}), "content-type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      return (await res.json()) as any;
    };
    await call("POST", "/personal/observations", personal, { channel: "imessage", conversationId: "real", turns: [{ role: "user", text: "I always prefer black clothing.", at }] });
    await call("POST", "/test/clock", undefined, { offsetMs: 301_000 });
    await deps.learning.flushDue();
    await deps.learning.settle();
    const events = (await call("GET", "/owner/activity?limit=500", owner)).events as Array<{ event: string; result: string }>;
    expect(events.filter((e) => e.result === "failed")).toEqual([]);
    const learned = (await call("GET", "/personal/learned", personal)).learned as Array<{ field: string; evidence: Array<Record<string, unknown>> }>;
    expect(learned.find((e) => e.field === "pref.color")!.evidence[0]!.models).toEqual(MODELS);
    const lines = readdirSync(join(repoPath, "contributions")).flatMap((f) => readFileSync(join(repoPath, "contributions", f), "utf8").split("\n"))
      .filter((l) => l.startsWith("- pref.color: black "));
    expect(lines).toHaveLength(1);
    if (rulesKeepModels(realRules)) expect(lines[0]).toMatch(/gate: typesafe\/jev-1\.14.*extractor: openai\/gpt-oss-120b/);
    else expect(lines[0]).not.toMatch(/gate:|extractor:/);
    expect(execFileSync("git", ["-C", repoPath, "status", "--porcelain"], { encoding: "utf8" })).toBe("");
    await deps.close();
  });
});
