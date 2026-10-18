// Gateway configuration from the environment (README "Environment"). The gateway always listens on 127.0.0.1: TLS and
// the public host are the reverse proxy's job. Errors name variables, never their values; the secret is never printed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { GATEWAY_DEFAULT_URL, GATEWAY_IDLE_MS, GATEWAY_PORT } from "@agent-cookie/contract";

const here = dirname(fileURLToPath(import.meta.url));
/** apps/gateway */
export const GATEWAY_DIR = resolve(here, "..");

const LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "[::1]"];
const SECRET_FILE = "gateway.secret";
const MIN_SECRET_BYTES = 32;

export interface GatewayConfig {
  host: "127.0.0.1";
  port: number;
  /** The public origin people and assistants use (consent links, `jar.url`, WebAuthn expected origin, CSRF). */
  origin: string;
  /** WebAuthn relying-party id. */
  rpId: string;
  /** Gateway SQLite, the secret file and persons/<userId>/ (one workspace data directory each). */
  dataDir: string;
  /** Cookie signing and key-at-rest encryption root (subkeys are derived per use). Never printed. */
  secret: Buffer;
  /** Idle instances are stopped after this long. */
  idleMs: number;
  /** The workspace entry file each instance runs. */
  workspaceEntry: string;
  /** The workspace package directory: the child's cwd. */
  workspaceDir: string;
  /** The workspace package's tsx (falls back to the gateway's own). */
  tsxBin: string;
  /** AGENT_COOKIE_TEST=1: POST /test/session exists. */
  test: boolean;
  /** AGENT_COOKIE_GATEWAY_OPERATOR_KEY: GET /operator/funnel (Phase 4 reserve). Absent: every call is 401. */
  operatorKey?: string;
}

function int(name: string, v: string | undefined, dflt: number, min: number, max: number): number {
  if (v === undefined || v === "") return dflt;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return n;
}

/** https on any host, or http on loopback; an origin only (no path, query, fragment or credentials). */
export function gatewayOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("AGENT_COOKIE_GATEWAY_ORIGIN must be an absolute URL");
  }
  const transport = url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.includes(url.hostname));
  if (!transport || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("AGENT_COOKIE_GATEWAY_ORIGIN must be an https:// origin, or http:// on loopback, with no path, query or credentials");
  }
  return url.origin;
}

function decodeSecret(text: string, name: string): Buffer {
  const t = text.trim();
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(t)) throw new Error(`${name} must be base64url`);
  const bytes = Buffer.from(t, "base64url");
  if (bytes.length < MIN_SECRET_BYTES) throw new Error(`${name} must decode to at least ${MIN_SECRET_BYTES} bytes`);
  return bytes;
}

/** The env secret, else <dataDir>/gateway.secret, generated (mode 0600) when absent. Never printed. */
export function loadSecret(env: NodeJS.ProcessEnv, dataDir: string): Buffer {
  if (env.AGENT_COOKIE_GATEWAY_SECRET) return decodeSecret(env.AGENT_COOKIE_GATEWAY_SECRET, "AGENT_COOKIE_GATEWAY_SECRET");
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const path = resolve(dataDir, SECRET_FILE);
  if (!existsSync(path)) {
    try {
      writeFileSync(path, `${randomBytes(MIN_SECRET_BYTES).toString("base64url")}\n`, { mode: 0o600, flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  return decodeSecret(readFileSync(path, "utf8"), SECRET_FILE);
}

/** The nearest ancestor directory of `file` holding a package.json. */
function packageDirOf(file: string): string {
  let dir = dirname(file);
  for (;;) {
    if (existsSync(resolve(dir, "package.json"))) return dir;
    const up = dirname(dir);
    if (up === dir) throw new Error("AGENT_COOKIE_WORKSPACE_ENTRY is not inside a package");
    dir = up;
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const port = int("PORT", env.PORT, GATEWAY_PORT, 0, 65535);
  const origin = gatewayOrigin(env.AGENT_COOKIE_GATEWAY_ORIGIN || GATEWAY_DEFAULT_URL);
  const rpId = env.AGENT_COOKIE_GATEWAY_RP_ID || new URL(origin).hostname;
  const dataDir = resolve(env.AGENT_COOKIE_GATEWAY_DATA_DIR || resolve(GATEWAY_DIR, "data"));
  const workspaceEntry = env.AGENT_COOKIE_WORKSPACE_ENTRY
    ? resolve(env.AGENT_COOKIE_WORKSPACE_ENTRY)
    : resolve(GATEWAY_DIR, "../workspace/src/server.ts");
  if (!existsSync(workspaceEntry)) throw new Error("AGENT_COOKIE_WORKSPACE_ENTRY does not exist");
  const workspaceDir = packageDirOf(workspaceEntry);
  const ownTsx = resolve(GATEWAY_DIR, "node_modules/.bin/tsx");
  const workspaceTsx = resolve(workspaceDir, "node_modules/.bin/tsx");
  const tsxBin = existsSync(workspaceTsx) ? workspaceTsx : ownTsx;
  const operatorKey = env.AGENT_COOKIE_GATEWAY_OPERATOR_KEY?.trim() || undefined;
  if (operatorKey !== undefined && (operatorKey.length < 16 || /[^\x21-\x7e]/.test(operatorKey))) {
    throw new Error("AGENT_COOKIE_GATEWAY_OPERATOR_KEY must be at least 16 printable characters");
  }
  return {
    host: "127.0.0.1",
    port,
    origin,
    rpId,
    dataDir,
    secret: loadSecret(env, dataDir),
    idleMs: int("AGENT_COOKIE_GATEWAY_IDLE_MS", env.AGENT_COOKIE_GATEWAY_IDLE_MS, GATEWAY_IDLE_MS, 100, 7 * 24 * 3_600_000),
    workspaceEntry,
    workspaceDir,
    tsxBin,
    test: env.AGENT_COOKIE_TEST === "1",
    ...(operatorKey ? { operatorKey } : {}),
  };
}
