// Workspace configuration from the environment (docs/plan.md v0.3 §4 "环境变量与端口").
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WORKSPACE_PORT } from "@agent-cookie/contract";

const here = dirname(fileURLToPath(import.meta.url));
export const WORKSPACE_DIR = resolve(here, "..");
export const REPO_ROOT = resolve(here, "../../..");

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
  /** Only when UCP_BIN is set; otherwise lane D's package runs its pinned CLI. */
  ucpBin?: string;
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
  const fixturesDir = resolve(env.FIXTURES_DIR ?? resolve(REPO_ROOT, "fixtures"));
  if (!existsSync(resolve(fixturesDir, "users.json"))) throw new Error(`no fixtures at ${fixturesDir} (set FIXTURES_DIR)`);
  if (env.AGENT_COOKIE_UCP !== undefined && env.AGENT_COOKIE_UCP !== "live" && env.AGENT_COOKIE_UCP !== "fixture") {
    throw new Error("AGENT_COOKIE_UCP must be live or fixture");
  }
  const ucpMode = env.AGENT_COOKIE_UCP === "live" ? "live" : "fixture";
  return {
    host: "127.0.0.1",
    port,
    jarUrl: env.AGENT_COOKIE_URL ?? `http://127.0.0.1:${port}`,
    dataDir,
    sqlitePath: env.SQLITE_PATH ?? resolve(dataDir, "workspace.sqlite"),
    memoryRepoPath: resolve(env.MEMORY_REPO_PATH ?? resolve(dataDir, "memory")),
    fixturesDir,
    ucpMode,
    ...(env.UCP_BIN ? { ucpBin: env.UCP_BIN } : {}),
    demo: env.AGENT_COOKIE_DEMO === "1",
    test: env.AGENT_COOKIE_TEST === "1",
    callbackTimeoutMs: int(env.CALLBACK_TIMEOUT_MS, 5000, 50, 60_000),
    callbackRetries: int(env.CALLBACK_RETRIES, 3, 1, 10),
    jarKek: env.AGENT_COOKIE_JAR_KEK,
    unlockSecret: env.AGENT_COOKIE_UNLOCK_SECRET,
  };
}
