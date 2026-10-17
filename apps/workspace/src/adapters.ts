// The three packages the workspace calls, through the frozen contract interfaces:
//   RulesApi      → @agent-cookie/rules        (lane C)
//   MemoryRepoApi → @agent-cookie/memory-repo  (lane C): git memory repo at MEMORY_REPO_PATH, seeded from fixtures/memory
//   UcpApi        → @agent-cookie/ucp          (lane D): AGENT_COOKIE_UCP=fixture replays fixtures/ucp, live runs the ucp CLI
// Unit tests inject in-memory stubs through createDeps(config, overrides); production never uses them.
import { existsSync } from "node:fs";
import type { MemoryRepoApi, RulesApi, UcpApi } from "@agent-cookie/contract";
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

export function loadUcp(config: Config): UcpApi {
  return createUcp({
    mode: config.ucpMode,
    ...(config.ucpMode === "fixture" && existsSync(config.ucpFixturesDir) ? { fixturesDir: config.ucpFixturesDir } : {}),
    ...(config.ucpBin ? { bin: config.ucpBin } : {}),
  });
}
