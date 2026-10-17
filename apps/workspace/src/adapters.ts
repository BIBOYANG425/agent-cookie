// Where the three external packages plug in. Today: in-memory stubs of the contract interfaces.
// When packages/rules, packages/memory-repo (lane C) and packages/ucp (lane D) land, swap the three lines below.
import { resolve } from "node:path";
import type { Contribution, MemoryRepoApi, RulesApi, UcpApi } from "@agent-cookie/contract";
import type { Config } from "./config.js";
import { SAMPLE_FIXTURES_DIR } from "./config.js";
import { stubMemoryRepoApi } from "./stubs/memory-repo.js";
import { stubRules } from "./stubs/rules.js";
import { StubUcp } from "./stubs/ucp.js";
import { existsSync } from "node:fs";

export function loadRules(): RulesApi {
  return stubRules;
}

export function loadMemoryRepoApi(seedContributions: () => Contribution[]): MemoryRepoApi {
  return stubMemoryRepoApi(seedContributions);
}

export function loadUcp(config: Config): UcpApi {
  if (config.ucpMode === "live") {
    console.warn("[workspace] AGENT_COOKIE_UCP=live needs packages/ucp (lane D); using the in-memory fixture stub");
  }
  const own = resolve(config.fixturesDir, "ucp-offers.json");
  return StubUcp.fromFile(existsSync(own) ? own : resolve(SAMPLE_FIXTURES_DIR, "ucp-offers.json"), config.ucpStubComplete);
}
