// One workspace process per person (contract gateway.ts): `tsx <workspace entry>` with its cwd in the workspace package,
// its own data directory <dataDir>/persons/<userId>, a blank seed, recorded UCP replay, and an OS-picked loopback port.
// The manager waits for the listening line and GET /healthz, reads the instance's owner key from owner.key into memory
// (it never leaves this module: callers get `fetch(..., { owner: true })`), stops instances idle for `idleMs` with
// SIGTERM and starts them again on the next request. Start and stop are serialised per person. Nothing here logs a
// key: the child's own output stays in memory (a short tail for a failure message only).
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { sha256Hex } from "./crypto.js";

/** Both the workspace's supervisor line (`[workspace] listening on http://127.0.0.1:<port>`) and its older banner match. */
const LISTENING = /listening on http:\/\/127\.0\.0\.1:(\d+)/;
/**
 * Inherited settings that would change an instance or leak the gateway's own secrets into it (AGENT_COOKIE_GATEWAY_*,
 * the operator key, a developer's workspace key, vitest's variables). The instance gets exactly the AGENT_COOKIE_* set
 * below; AGENT_COOKIE_DEMO and AGENT_COOKIE_TEST are never set.
 */
const DROP_ENV = /^(AGENT_COOKIE_|UCP_|VITEST|SENTRY_|OPENROUTER_|VISA_|MEMORY_REPO_PATH$|SQLITE_PATH$|FIXTURES_DIR$|PORT$|CALLBACK_|DREAMING_|LEARN_)/;
/** A person's id is used in a directory name and in `/u/:userId`: lowercase base32 only (the SDK's path rule fits). */
export const USER_ID_RE = /^usr_[0-9a-z]{8,40}$/;

export class InstanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstanceError";
  }
}

export interface InstanceManagerOptions {
  /** The gateway data directory; instances live in <dataDir>/persons/<userId>. */
  dataDir: string;
  /** The gateway's public origin: each instance's AGENT_COOKIE_URL is `${origin}/u/${userId}` (handshake `jar`). */
  origin: string;
  workspaceEntry: string;
  workspaceDir: string;
  tsxBin: string;
  idleMs: number;
  startTimeoutMs?: number;
  stopTimeoutMs?: number;
  /** Extra environment for every instance (tests: DREAMING_INTERVAL_MS=0). Cannot set AGENT_COOKIE_DEMO / _TEST. */
  extraEnv?: Record<string, string>;
  /** Whether the person still exists: a start for someone deleted meanwhile is refused (no directory is recreated). */
  exists?(userId: string): boolean;
  onStart?(userId: string, port: number, ownerKeyHash: string): void;
  onStop?(userId: string): void;
  /**
   * Called before the gateway stops a still-running instance for idle, a requested stop or shutdown (never for a
   * delete, never after an unexpected exit), with the owner-authenticated fetch of that instance and an abort signal
   * that fires after `beforeStopTimeoutMs`. Errors are swallowed and logged; the stop goes on regardless.
   */
  beforeStop?(userId: string, fetch: Lease["fetch"], signal: AbortSignal): Promise<void>;
  /** Default 5 s. */
  beforeStopTimeoutMs?: number;
  log?(line: string): void;
}

/** Why an instance is stopped: a delete skips `beforeStop`. */
export type StopReason = "idle" | "requested" | "shutdown" | "delete";

export interface FetchInit {
  method?: "GET" | "HEAD" | "POST" | "PUT";
  headers?: Record<string, string>;
  body?: BodyInit | null;
  /** A JSON body (sets Content-Type). */
  json?: unknown;
  /** Authenticate with the instance's owner key (held here, never returned). */
  owner?: boolean;
  /** Authenticate with this key instead. */
  key?: string;
  signal?: AbortSignal;
}

/** A running instance, held in use until `release()` (an idle instance is never stopped while a lease is out). */
export interface Lease {
  readonly userId: string;
  readonly port: number;
  /** `seed` from GET /healthz ("blank" or "sample"); undefined for a workspace without /healthz. */
  readonly seed?: string;
  fetch(path: string, init?: FetchInit): Promise<Response>;
  release(): void;
}

interface Live {
  userId: string;
  port: number;
  seed?: string;
  child: ChildProcess;
  ownerKey: string;
  lastUsed: number;
  inflight: number;
  alive: boolean;
  stopping: boolean;
  exited: Promise<void>;
  output: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try { child.kill(signal); } catch { /* already gone */ }
  }
}

export class InstanceManager {
  #live = new Map<string, Live>();
  #queues = new Map<string, Promise<unknown>>();
  #closing = false;
  #timer: NodeJS.Timeout;
  #startTimeoutMs: number;
  #stopTimeoutMs: number;
  #onExit = () => {
    for (const live of this.#live.values()) killGroup(live.child, "SIGKILL");
  };

  constructor(private opts: InstanceManagerOptions) {
    this.#startTimeoutMs = opts.startTimeoutMs ?? 60_000;
    this.#stopTimeoutMs = opts.stopTimeoutMs ?? 10_000;
    this.#timer = setInterval(() => this.sweepIdle(), Math.max(50, Math.min(Math.floor(opts.idleMs / 4), 30_000)));
    this.#timer.unref();
    process.on("exit", this.#onExit);
  }

  personDir(userId: string): string {
    if (!USER_ID_RE.test(userId)) throw new InstanceError("invalid user id");
    const root = resolve(this.opts.dataDir, "persons");
    const dir = resolve(root, userId);
    if (!dir.startsWith(root + sep)) throw new InstanceError("invalid user id");
    return dir;
  }

  runningCount(): number {
    let n = 0;
    for (const live of this.#live.values()) if (live.alive && !live.stopping) n++;
    return n;
  }

  isRunning(userId: string): boolean {
    const live = this.#live.get(userId);
    return !!live && live.alive && !live.stopping;
  }

  /** The person's instance, started if needed, held in use until release(). Rejects with InstanceError. */
  async acquire(userId: string): Promise<Lease> {
    let live = this.#live.get(userId);
    if (!live || !live.alive || live.stopping) live = await this.#serial(userId, () => this.#ensureLocked(userId));
    const held = live;
    held.inflight++;
    held.lastUsed = Date.now();
    let released = false;
    return {
      userId,
      port: held.port,
      ...(held.seed ? { seed: held.seed } : {}),
      fetch: this.#fetchFor(held),
      release: () => {
        if (released) return;
        released = true;
        held.inflight--;
        held.lastUsed = Date.now();
      },
    };
  }

  /** fetch against one live instance; `owner: true` uses its owner key while it still holds one. */
  #fetchFor(held: Live): Lease["fetch"] {
    return async (path, init = {}) => {
      if (!path.startsWith("/")) throw new InstanceError("instance path must start with /");
      const headers: Record<string, string> = { ...(init.headers ?? {}) };
      if (init.owner) {
        if (!held.ownerKey) throw new InstanceError("instance stopped");
        headers.authorization = `Bearer ${held.ownerKey}`;
      } else if (init.key) {
        headers.authorization = `Bearer ${init.key}`;
      }
      let body = init.body;
      if (init.json !== undefined) {
        headers["content-type"] = "application/json";
        body = JSON.stringify(init.json);
      }
      return fetch(`http://127.0.0.1:${held.port}${path}`, {
        method: init.method ?? (body === undefined || body === null ? "GET" : "POST"),
        headers,
        ...(body === undefined || body === null ? {} : { body }),
        redirect: "manual",
        ...(init.signal ? { signal: init.signal } : {}),
      });
    };
  }

  /** Start the person's instance if it is not running (sign-up does this). */
  async ensure(userId: string): Promise<void> {
    (await this.acquire(userId)).release();
  }

  /** SIGTERM the person's instance (if running) and wait for it. */
  stop(userId: string): Promise<void> {
    return this.#serial(userId, () => this.#stopLocked(userId, "requested"));
  }

  /** Stop the instance and remove its whole directory (delete my data). */
  remove(userId: string): Promise<void> {
    const dir = this.personDir(userId);
    return this.#serial(userId, async () => {
      await this.#stopLocked(userId, "delete");
      rmSync(dir, { recursive: true, force: true });
    });
  }

  /** Stop every instance idle for idleMs with nothing in flight. Runs on a timer; exposed for tests. */
  sweepIdle(): void {
    const now = Date.now();
    for (const [userId, live] of this.#live) {
      if (live.stopping || live.inflight > 0 || now - live.lastUsed < this.opts.idleMs) continue;
      void this.#serial(userId, async () => {
        const cur = this.#live.get(userId);
        if (cur !== live || live.inflight > 0 || Date.now() - live.lastUsed < this.opts.idleMs) return;
        await this.#stopLocked(userId, "idle");
      }).catch((e: unknown) => this.#log(`instance ${userId}: idle stop failed (${(e as Error).message})`));
    }
  }

  /** Gateway shutdown: no new starts, let running starts finish, SIGTERM every instance and wait. */
  async shutdown(): Promise<void> {
    this.#closing = true;
    clearInterval(this.#timer);
    await Promise.all([...this.#queues.values()]);
    await Promise.all([...this.#live.keys()].map((userId) => this.#serial(userId, () => this.#stopLocked(userId, "shutdown"))));
    process.off("exit", this.#onExit);
  }

  #log(line: string): void {
    this.opts.log?.(line);
  }

  #serial<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.#queues.get(userId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.then(() => undefined, () => undefined);
    this.#queues.set(userId, tail);
    void tail.then(() => {
      if (this.#queues.get(userId) === tail) this.#queues.delete(userId);
    });
    return next;
  }

  async #ensureLocked(userId: string): Promise<Live> {
    const cur = this.#live.get(userId);
    if (cur && cur.alive && !cur.stopping) return cur;
    if (this.#closing) throw new InstanceError("the gateway is shutting down");
    if (this.opts.exists && !this.opts.exists(userId)) throw new InstanceError("unknown person");
    const dir = this.personDir(userId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const live = await this.#spawn(userId, dir);
    // The idle clock starts once the instance is ready, not when it was spawned.
    live.lastUsed = Date.now();
    this.#live.set(userId, live);
    this.opts.onStart?.(userId, live.port, sha256Hex(live.ownerKey));
    this.#log(`instance ${userId} started on 127.0.0.1:${live.port}${live.seed ? ` (seed ${live.seed})` : ""}`);
    return live;
  }

  async #spawn(userId: string, dir: string): Promise<Live> {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !DROP_ENV.test(k)) env[k] = v;
    Object.assign(env, this.opts.extraEnv ?? {}, {
      AGENT_COOKIE_DATA_DIR: dir,
      AGENT_COOKIE_SEED: "blank",
      AGENT_COOKIE_UCP: "fixture",
      AGENT_COOKIE_URL: `${this.opts.origin}/u/${userId}`,
      // 0: the OS picks a free loopback port; the listening line names it (no probe-then-bind race).
      PORT: "0",
      OPT_OUT_INSTRUMENTATION: "true",
    });
    delete env.AGENT_COOKIE_DEMO;
    delete env.AGENT_COOKIE_TEST;

    const child = spawn(this.opts.tsxBin, [this.opts.workspaceEntry], {
      cwd: this.opts.workspaceDir, env, stdio: ["ignore", "pipe", "pipe"], detached: true,
    });
    const live: Live = {
      userId, port: 0, child, ownerKey: "", lastUsed: Date.now(), inflight: 0, alive: true, stopping: false,
      exited: Promise.resolve(), output: "",
    };
    const keep = (chunk: Buffer) => { live.output = (live.output + chunk.toString("utf8")).slice(-4000); };
    child.stdout!.on("data", keep);
    child.stderr!.on("data", keep);
    live.exited = new Promise<void>((resolveExit) => {
      const done = () => {
        if (!live.alive) return;
        live.alive = false;
        live.ownerKey = "";
        if (this.#live.get(userId) === live) {
          this.#live.delete(userId);
          this.opts.onStop?.(userId);
          if (!live.stopping) this.#log(`instance ${userId} exited unexpectedly`);
        }
        resolveExit();
      };
      child.once("exit", done);
      child.once("error", (e) => { live.output += `\nspawn failed: ${e.message}`; done(); });
    });

    try {
      live.port = await new Promise<number>((resolvePort, reject) => {
        let buf = "";
        const timer = setTimeout(() => finish(new InstanceError("the workspace did not print its listening line in time")), this.#startTimeoutMs);
        const onData = (chunk: Buffer) => {
          buf = (buf + chunk.toString("utf8")).slice(-8000);
          const m = LISTENING.exec(buf);
          if (m) finish(undefined, Number(m[1]));
        };
        const finish = (err?: Error, port?: number) => {
          clearTimeout(timer);
          child.stdout!.off("data", onData);
          if (err) reject(err);
          else resolvePort(port!);
        };
        child.stdout!.on("data", onData);
        void live.exited.then(() => finish(new InstanceError("the workspace exited before listening")));
      });
      if (!Number.isInteger(live.port) || live.port <= 0 || live.port > 65535) throw new InstanceError("the workspace printed an invalid port");

      const deadline = Date.now() + this.#startTimeoutMs;
      for (;;) {
        const probe = await fetch(`http://127.0.0.1:${live.port}/healthz`, { signal: AbortSignal.timeout(2000) }).then(async (r) => {
          const body = r.status === 200 ? await r.json().catch(() => null) as { ok?: unknown; seed?: unknown } | null : (await r.arrayBuffer(), null);
          return { status: r.status, body };
        }, () => ({ status: 0, body: null }));
        if (probe.status === 200 && probe.body?.ok === true) {
          if (typeof probe.body.seed === "string") live.seed = probe.body.seed;
          break;
        }
        // A workspace from before GET /healthz: it printed its listening line after it was ready, and it answers.
        if (probe.status === 404) break;
        if (!live.alive) throw new InstanceError("the workspace exited during its health check");
        if (Date.now() > deadline) throw new InstanceError("the workspace did not become healthy in time");
        await sleep(100);
      }

      const keyPath = join(dir, "owner.key");
      const mode = statSync(keyPath).mode;
      if ((mode & 0o077) !== 0) chmodSync(keyPath, 0o600);
      const ownerKey = readFileSync(keyPath, "utf8").trim();
      if (!/^[\x21-\x7e]{16,256}$/.test(ownerKey)) throw new InstanceError("the instance's owner.key is malformed");
      live.ownerKey = ownerKey;
      return live;
    } catch (error) {
      live.stopping = true;
      killGroup(child, "SIGKILL");
      await live.exited;
      const message = error instanceof InstanceError ? error.message
        : (error as NodeJS.ErrnoException).code === "ENOENT" ? "the instance wrote no owner.key" : "the workspace failed to start";
      const tail = live.output.trim().split("\n").slice(-8).join("\n");
      throw new InstanceError(`instance ${userId}: ${message}${tail ? `\n${tail}` : ""}`);
    }
  }

  async #beforeStop(live: Live): Promise<void> {
    const ms = this.opts.beforeStopTimeoutMs ?? 5_000;
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<"timeout">((r) => { timer = setTimeout(() => { controller.abort(); r("timeout"); }, ms); });
    try {
      const outcome = await Promise.race([this.opts.beforeStop!(live.userId, this.#fetchFor(live), controller.signal).then(() => "done" as const), timedOut]);
      if (outcome === "timeout") this.#log(`instance ${live.userId}: before-stop read timed out`);
    } catch (e) {
      this.#log(`instance ${live.userId}: before-stop read failed (${e instanceof Error ? e.name : "error"})`);
    } finally {
      clearTimeout(timer);
    }
  }

  async #stopLocked(userId: string, reason: StopReason): Promise<void> {
    const live = this.#live.get(userId);
    if (!live) return;
    live.stopping = true;
    this.#live.delete(userId);
    this.opts.onStop?.(userId);
    // Still running and still holding its owner key: let the gateway take what it keeps of a stopped instance.
    if (reason !== "delete" && this.opts.beforeStop && live.alive && live.ownerKey) await this.#beforeStop(live);
    live.ownerKey = "";
    if (live.alive && live.child.pid !== undefined) {
      // tsx relays SIGTERM to the workspace, which closes its listener and SQLite and exits.
      try { process.kill(live.child.pid, "SIGTERM"); } catch { /* already gone */ }
      const done = await Promise.race([live.exited.then(() => true), sleep(this.#stopTimeoutMs).then(() => false)]);
      if (!done) {
        killGroup(live.child, "SIGKILL");
        await live.exited;
      }
    }
    this.#log(`instance ${userId} stopped (${reason})`);
  }
}
