// Workspace configuration from the environment (docs/plan.md v0.3 §4 "环境变量与端口").
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WORKSPACE_PORT } from "@agent-cookie/contract";

const here = dirname(fileURLToPath(import.meta.url));
export const WORKSPACE_DIR = resolve(here, "..");
export const REPO_ROOT = resolve(here, "../../..");
export const SAMPLE_FIXTURES_DIR = resolve(WORKSPACE_DIR, "sample-fixtures");

export type UcpStubOutcome = "requires_escalation" | "completed" | "sold_out" | "error";

export interface Config {
  host: "127.0.0.1";
  port: number;
  /** Handshake `jar`: the API base URL merchants call. */
  jarUrl: string;
  dataDir: string;
  sqlitePath: string;
  memoryRepoPath: string;
  fixturesDir: string;
  ucpMode: "live" | "fixture";
  ucpBin: string;
  ucpStubComplete: UcpStubOutcome;
  /** AGENT_COOKIE_DEMO=1: POST /demo/reset exists, dev keys load. */
  demo: boolean;
  /** AGENT_COOKIE_TEST=1: POST /test/clock exists, dev keys load. */
  test: boolean;
  callbackTimeoutMs: number;
  callbackRetries: number;
  /** Lane D (P1), passed through to packages/auth when it is wired. */
  jarKek?: string;
  unlockSecret?: string;
}

function int(v: string | undefined, dflt: number, min: number, max: number): number {
  if (v === undefined || v === "") return dflt;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`invalid integer environment value: ${v}`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = int(env.PORT, WORKSPACE_PORT, 0, 65535);
  const dataDir = resolve(env.AGENT_COOKIE_DATA_DIR ?? resolve(WORKSPACE_DIR, "data"));
  const repoFixtures = resolve(REPO_ROOT, "fixtures");
  const fixturesDir = resolve(env.FIXTURES_DIR ?? (existsSync(resolve(repoFixtures, "users.json")) ? repoFixtures : SAMPLE_FIXTURES_DIR));
  const outcome = (env.UCP_STUB_COMPLETE ?? "requires_escalation") as UcpStubOutcome;
  if (!["requires_escalation", "completed", "sold_out", "error"].includes(outcome)) throw new Error(`invalid UCP_STUB_COMPLETE: ${outcome}`);
  const ucpMode = env.AGENT_COOKIE_UCP === "live" ? "live" : "fixture";
  return {
    host: "127.0.0.1",
    port,
    jarUrl: env.AGENT_COOKIE_URL ?? `http://127.0.0.1:${port}`,
    dataDir,
    sqlitePath: env.SQLITE_PATH ?? resolve(dataDir, "workspace.sqlite"),
    memoryRepoPath: resolve(env.MEMORY_REPO_PATH ?? resolve(dataDir, "memory-u_sample")),
    fixturesDir,
    ucpMode,
    ucpBin: env.UCP_BIN ?? "ucp",
    ucpStubComplete: outcome,
    demo: env.AGENT_COOKIE_DEMO === "1",
    test: env.AGENT_COOKIE_TEST === "1",
    callbackTimeoutMs: int(env.CALLBACK_TIMEOUT_MS, 5000, 50, 60_000),
    callbackRetries: int(env.CALLBACK_RETRIES, 3, 1, 10),
    jarKek: env.AGENT_COOKIE_JAR_KEK,
    unlockSecret: env.AGENT_COOKIE_UNLOCK_SECRET,
  };
}
