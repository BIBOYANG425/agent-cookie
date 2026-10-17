// Workspace configuration from the environment (docs/plan.md v0.3 §4 "环境变量与端口").
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_FILES, WORKSPACE_PORT } from "@agent-cookie/contract";

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
  /** Recorded UCP envelopes + pinned.json replayed in fixture mode: AGENT_COOKIE_UCP_FIXTURES, else <fixturesDir>/ucp. */
  ucpFixturesDir: string;
  ucpMode: "live" | "fixture";
  /** Only when UCP_BIN is set; otherwise lane D's package runs its pinned CLI. */
  ucpBin?: string;
  /** AGENT_COOKIE_DEMO=1: POST /demo/reset exists, dev keys load. */
  demo: boolean;
  /** AGENT_COOKIE_TEST=1: POST /test/clock exists, dev keys load. */
  test: boolean;
  callbackTimeoutMs: number;
  callbackRetries: number;
  /** POST /demo/reset waits this long for in-flight requests before cutting them off (they then cannot write). */
  resetWaitMs: number;
  /** SQLite busy_timeout: wait for another connection's write lock instead of failing with SQLITE_BUSY. */
  sqliteBusyTimeoutMs: number;
  /** Sentry tracing + logs (plan §4). Off when unset. */
  sentryDsn?: string;
  sentryEnvironment: string;
  sentryTracesSampleRate: number;
  /** Lane D (P1): with both set, the workspace holds the jar (packages/auth) and signs handshakes and TAP requests. */
  jarKek?: string;
  unlockSecret?: string;
  jarPath?: string;
  unlockTtlMs: number;
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
  const jarKek = env.AGENT_COOKIE_JAR_KEK || undefined;
  const unlockSecret = env.AGENT_COOKIE_UNLOCK_SECRET || undefined;
  if ((jarKek === undefined) !== (unlockSecret === undefined)) {
    throw new Error("AGENT_COOKIE_JAR_KEK and AGENT_COOKIE_UNLOCK_SECRET must be set together");
  }
  if (jarKek && Buffer.from(jarKek, "base64url").length !== 32) {
    throw new Error("AGENT_COOKIE_JAR_KEK must decode to exactly 32 bytes");
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
    ucpFixturesDir: resolve(env.AGENT_COOKIE_UCP_FIXTURES ?? resolve(fixturesDir, FIXTURE_FILES.ucp)),
    ucpMode,
    ...(env.UCP_BIN ? { ucpBin: env.UCP_BIN } : {}),
    demo: env.AGENT_COOKIE_DEMO === "1",
    test: env.AGENT_COOKIE_TEST === "1",
    callbackTimeoutMs: int(env.CALLBACK_TIMEOUT_MS, 5000, 50, 60_000),
    callbackRetries: int(env.CALLBACK_RETRIES, 3, 1, 10),
    resetWaitMs: int(env.RESET_WAIT_MS, 10_000, 0, 120_000),
    sqliteBusyTimeoutMs: int(env.SQLITE_BUSY_TIMEOUT_MS, 5000, 0, 60_000),
    ...(jarKek ? { jarKek } : {}),
    ...(unlockSecret ? { unlockSecret } : {}),
    ...(env.AGENT_COOKIE_JAR_PATH ? { jarPath: resolve(env.AGENT_COOKIE_JAR_PATH) } : {}),
    unlockTtlMs: int(env.UNLOCK_TTL_MS, 900_000, 1000, 86_400_000),
    ...(env.SENTRY_DSN ? { sentryDsn: env.SENTRY_DSN } : {}),
    sentryEnvironment: env.SENTRY_ENVIRONMENT ?? (env.AGENT_COOKIE_DEMO === "1" ? "demo" : "development"),
    sentryTracesSampleRate: rate(env.SENTRY_TRACES_SAMPLE_RATE, 1),
  };
}

function rate(v: string | undefined, dflt: number): number {
  if (v === undefined || v === "") return dflt;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error("SENTRY_TRACES_SAMPLE_RATE must be between 0 and 1");
  return n;
}
