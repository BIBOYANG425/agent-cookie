// The three packages the workspace calls, through the frozen contract interfaces:
//   RulesApi      → @agent-cookie/rules        (lane C)
//   MemoryRepoApi → @agent-cookie/memory-repo  (lane C): git memory repo at MEMORY_REPO_PATH, seeded from fixtures/memory
//   UcpApi        → @agent-cookie/ucp          (lane D): AGENT_COOKIE_UCP=fixture replays fixtures/ucp, live runs the ucp CLI
//   LearnApi      → @agent-cookie/learn        (lane B): createWorkspaceLearner + createHaikuExtractor(ANTHROPIC_API_KEY);
//                   no key, or the package not installed → a learner that learns nothing (never synthetic results)
// Unit tests inject in-memory stubs through createDeps(config, overrides); production never uses them.
import { existsSync } from "node:fs";
import type { LearnApi, MemoryRepoApi, RulesApi, UcpApi } from "@agent-cookie/contract";
import { openMemoryRepo } from "@agent-cookie/memory-repo";
import { rules } from "@agent-cookie/rules";
import { createUcp } from "@agent-cookie/ucp";
import type { Config } from "./config.js";

export function loadRules(): RulesApi {
  return rules;
}

export function loadMemoryRepoApi(): MemoryRepoApi {
  return { openMemoryRepo };
}

/** The two factories of @agent-cookie/learn the workspace uses (packages/learn/README.md, lane B). */
export interface LearnModule {
  createWorkspaceLearner(opts: { extract: unknown; mode?: "all" | "explicit-only" }): LearnApi;
  createHaikuExtractor(opts: { apiKey: string }): unknown;
}

/** Learns nothing: no candidates. */
export const NO_LEARNING: LearnApi = { extract: async () => [], extractFromConversation: async () => [] };

/**
 * Lane B's learner with the Haiku extractor, keyed by ANTHROPIC_API_KEY. Without a key, or without the package, the
 * workspace learns nothing (`reason` says why) — it never falls back to synthetic results.
 */
export function loadLearn(config: Config, learn: LearnModule | undefined): { api: LearnApi; reason?: string } {
  if (!config.anthropicApiKey) return { api: NO_LEARNING, reason: "no ANTHROPIC_API_KEY" };
  if (!learn) return { api: NO_LEARNING, reason: "@agent-cookie/learn not installed" };
  return { api: learn.createWorkspaceLearner({ extract: learn.createHaikuExtractor({ apiKey: config.anthropicApiKey }), mode: config.learnMode }) };
}

/**
 * Import @agent-cookie/learn if this install has it. It lives on lane B's branch until it is merged to main; the
 * workspace's package.json gains the dependency then, and this resolves without a code change.
 */
export async function importLearn(): Promise<LearnModule | undefined> {
  const specifier = "@agent-cookie/learn";
  try {
    const mod = (await import(specifier)) as Partial<LearnModule>;
    return typeof mod.createWorkspaceLearner === "function" && typeof mod.createHaikuExtractor === "function" ? (mod as LearnModule) : undefined;
  } catch {
    return undefined;
  }
}

export function loadUcp(config: Config): UcpApi {
  return createUcp({
    mode: config.ucpMode,
    ...(config.ucpMode === "fixture" && existsSync(config.ucpFixturesDir) ? { fixturesDir: config.ucpFixturesDir } : {}),
    ...(config.ucpBin ? { bin: config.ucpBin } : {}),
  });
}
