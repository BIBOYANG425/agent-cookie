// Workspace configuration from the environment (docs/plan.md v0.3 §4 "环境变量与端口").
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DREAMING_DEFAULT_INTERVAL_MS, FIXTURE_FILES, WORKSPACE_PORT } from "@agent-cookie/contract";
// The Visa Acceptance sandbox: the only host AGENT_COOKIE_PAY=visa may call (production is out of scope).
import { VISA_ACCEPTANCE_SANDBOX_HOST } from "@agent-cookie/pay";

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
  /**
   * AGENT_COOKIE_SEED: "sample" (default) seeds lane C's Sample persona, agents and (demo/test) keys from the fixtures;
   * "blank" seeds one owner with a generated id and secret, no contribution, no agent, never a Sample key (demo or not),
   * an empty memory repo, and always mints <dataDir>/owner.key. The hosted gateway runs one blank instance per person.
   */
  seed: "sample" | "blank";
  /** AGENT_COOKIE_DEMO=1: POST /demo/reset exists, dev keys load (sample seed only). */
  demo: boolean;
  /** AGENT_COOKIE_TEST=1: POST /test/clock exists, dev keys load (sample seed only). */
  test: boolean;
  callbackTimeoutMs: number;
  callbackRetries: number;
  /** POST /demo/reset waits this long for in-flight requests before cutting them off (they then cannot write). */
  resetWaitMs: number;
  /** SQLite busy_timeout: wait for another connection's write lock instead of failing with SQLITE_BUSY. */
  sqliteBusyTimeoutMs: number;
  /** Dreaming's period (DREAMING_INTERVAL_MS; 0 = never scheduled, POST /owner/dreaming/run still works). */
  dreamingIntervalMs: number;
  /** A LearnApi call that takes longer is abandoned and logged as failed (LEARN_TIMEOUT_MS). */
  learnTimeoutMs: number;
  /** Explicit opt-in: a credential in the environment alone never enables model calls. */
  learnProvider: "off" | "openrouter";
  learnApiKey?: string;
  learnMode: "all" | "explicit-only";
  learnTelemetryEndpoint?: string;
  /** Sentry tracing + logs (plan §4). Off when unset. */
  sentryDsn?: string;
  sentryEnvironment: string;
  sentryTracesSampleRate: number;
  /** Lane D (P1): with both set, the workspace holds the jar (packages/auth) and signs handshakes and TAP requests. */
  jarKek?: string;
  unlockSecret?: string;
  jarPath?: string;
  unlockTtlMs: number;
  /**
   * AGENT_COOKIE_EXPERIMENT (docs/commerce-analytics-plan.md §6): "off" (default) or "ranking" = holdout E1. With
   * "ranking" and non-zero ranking weights installed, each new intent is assigned an arm and only treatment is ranked.
   */
  experiment: "off" | "ranking";
  /**
   * Lane D payment (A21): AGENT_COOKIE_PAY = "off" (default) | "fake" | "visa". Independent of the jar: payment may be on
   * while the jar is off. "fake" is @agent-cookie/pay's fakeProvider; "visa" is its Visa Acceptance provider against the
   * sandbox only (payments.ts). Stripe is not wired.
   */
  pay: "off" | "fake" | "visa";
  /**
   * AGENT_COOKIE_PAY=visa only: the Visa Acceptance REST credentials and the sandbox host. Never logged or printed.
   * `simulator` (D1): VISA_ACCEPTANCE_SIMULATOR=1 with VISA_ACCEPTANCE_HOST=http://127.0.0.1:<port>, lane D's loopback
   * simulator (apps/visa-sim); every authorization it answers is marked simulated (payments.ts).
   */
  visa?: { merchantId: string; keyId: string; sharedSecret: string; host: string; simulator?: true };
}

const VISA_VARS = ["VISA_ACCEPTANCE_MERCHANT_ID", "VISA_ACCEPTANCE_KEY_ID", "VISA_ACCEPTANCE_SHARED_SECRET"] as const;

/** Errors name variables, never their values. */
function visaConfig(env: NodeJS.ProcessEnv): NonNullable<Config["visa"]> {
  const missing = VISA_VARS.filter((name) => !env[name]);
  if (missing.length > 0) throw new Error(`AGENT_COOKIE_PAY=visa requires ${missing.join(", ")}`);
  const host = env.VISA_ACCEPTANCE_HOST || VISA_ACCEPTANCE_SANDBOX_HOST;
  // D1: the loopback simulator only with its own switch, and only as the exact origin http://127.0.0.1:<port>.
  const simulator = env.VISA_ACCEPTANCE_SIMULATOR === "1" && isSimulatorOrigin(host);
  if (host !== VISA_ACCEPTANCE_SANDBOX_HOST && !simulator) {
    throw new Error(`VISA_ACCEPTANCE_HOST must be ${VISA_ACCEPTANCE_SANDBOX_HOST} (the Visa Acceptance sandbox; production is out of scope), or http://127.0.0.1:<port> with VISA_ACCEPTANCE_SIMULATOR=1`);
  }
  const secret = env.VISA_ACCEPTANCE_SHARED_SECRET!;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(secret) || Buffer.from(secret, "base64").length === 0) {
    throw new Error("VISA_ACCEPTANCE_SHARED_SECRET must be the base64 shared secret");
  }
  return { merchantId: env.VISA_ACCEPTANCE_MERCHANT_ID!, keyId: env.VISA_ACCEPTANCE_KEY_ID!, sharedSecret: secret, host, ...(simulator ? { simulator: true as const } : {}) };
}

/** The Visa Acceptance simulator's origin (lane D, apps/visa-sim): http://127.0.0.1:<1–65535>, nothing else. */
export function isSimulatorOrigin(host: string): boolean {
  const m = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/.exec(host);
  return m !== null && Number(m[1]) <= 65535;
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
  const seed = env.AGENT_COOKIE_SEED || "sample";
  if (seed !== "sample" && seed !== "blank") throw new Error("AGENT_COOKIE_SEED must be sample or blank");
  // A blank instance seeds nothing from the fixtures; they may still serve the UCP replay (AGENT_COOKIE_UCP=fixture).
  if (seed === "sample" && !existsSync(resolve(fixturesDir, FIXTURE_FILES.users))) throw new Error(`no fixtures at ${fixturesDir} (set FIXTURES_DIR)`);
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
  const learnProvider = env.AGENT_COOKIE_LEARN_PROVIDER ?? "off";
  if (!["off", "openrouter"].includes(learnProvider)) throw new Error("Invalid learning provider");
  const learnApiKey = learnProvider === "openrouter" ? env.OPENROUTER_API_KEY : undefined;
  if (learnProvider !== "off" && !learnApiKey) throw new Error("Learning provider requires its API key");
  const learnMode = env.AGENT_COOKIE_LEARN_MODE ?? "all";
  if (learnMode !== "all" && learnMode !== "explicit-only") throw new Error("Invalid learning mode");
  // Fixture replay is a data-source choice, independent of AGENT_COOKIE_DEMO (which is about reset and Sample keys).
  const ucpMode = env.AGENT_COOKIE_UCP === "live" ? "live" : "fixture";
  const experiment = env.AGENT_COOKIE_EXPERIMENT || "off";
  if (experiment !== "off" && experiment !== "ranking") throw new Error("AGENT_COOKIE_EXPERIMENT must be off or ranking");
  const pay = env.AGENT_COOKIE_PAY || "off";
  if (pay !== "off" && pay !== "fake" && pay !== "visa") throw new Error("AGENT_COOKIE_PAY must be off, fake or visa");
  const visa = pay === "visa" ? visaConfig(env) : undefined;
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
    seed,
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
    experiment,
    pay,
    ...(visa ? { visa } : {}),
    learnProvider: learnProvider as Config["learnProvider"],
    ...(learnApiKey ? { learnApiKey } : {}),
    learnMode,
    ...(env.AGENT_COOKIE_LEARNING_OTLP_ENDPOINT ? { learnTelemetryEndpoint: env.AGENT_COOKIE_LEARNING_OTLP_ENDPOINT } : {}),
    dreamingIntervalMs: env.DREAMING_INTERVAL_MS === "0" ? 0 : int(env.DREAMING_INTERVAL_MS, DREAMING_DEFAULT_INTERVAL_MS, 1000, 86_400_000),
    learnTimeoutMs: int(env.LEARN_TIMEOUT_MS, 30_000, 50, 600_000),
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
