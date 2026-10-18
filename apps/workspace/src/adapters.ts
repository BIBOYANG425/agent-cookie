// The three packages the workspace calls, through the frozen contract interfaces:
//   RulesApi      → @agent-cookie/rules        (lane C)
//   MemoryRepoApi → @agent-cookie/memory-repo  (lane C): git memory repo at MEMORY_REPO_PATH, seeded from fixtures/memory
//   UcpApi        → @agent-cookie/ucp          (lane D): AGENT_COOKIE_UCP=fixture replays fixtures/ucp, live runs the ucp CLI
//   LearnApi      → @agent-cookie/learn (lane B), explicitly configured; off by default
// Unit tests inject in-memory stubs through createDeps(config, overrides); production never uses them.
import { createHaikuExtractor, createWorkspaceLearner, createLearningTelemetry } from "@agent-cookie/learn";
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

/** Explicitly configured extraction only; no key guessing, fallback provider, or global instrumentation. */
export function loadLearn(config: Config): { api: LearnApi; shutdown: () => Promise<void> } {
  if (config.learnProvider === "off") return {
    api: { extract: async () => [], extractFromConversation: async () => [] }, shutdown: async () => {},
  };
  const telemetry = createLearningTelemetry({ endpoint: config.learnTelemetryEndpoint });
  const extract = createHaikuExtractor({ provider: config.learnProvider, apiKey: config.learnApiKey! });
  return { api: createWorkspaceLearner({ extract, mode: config.learnMode, telemetry: telemetry.metric }), shutdown: telemetry.shutdown };
}

export function loadUcp(config: Config): UcpApi {
  return createUcp({
    mode: config.ucpMode,
    ...(config.ucpMode === "fixture" && existsSync(config.ucpFixturesDir) ? { fixturesDir: config.ucpFixturesDir } : {}),
    ...(config.ucpBin ? { bin: config.ucpBin } : {}),
  });
}
