// The workspace under a supervisor (the hosted gateway): spawned as a process on a port it did not choose (PORT=0), on
// a data directory that does not exist yet, with the blank seed. The supervisor waits for the one listening line,
// finds owner.key already on disk, probes GET /healthz without a key, and stops the instance with SIGTERM: exit code 0,
// SQLite closed cleanly (no WAL or rollback journal left behind). Black box: process, files and HTTP only.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterEach, expect, it } from "vitest";

const WORKSPACE_DIR = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const TSX = join(WORKSPACE_DIR, "node_modules/.bin/tsx");
const LISTENING = /^\[workspace\] listening on http:\/\/127\.0\.0\.1:(\d+)$/m;

const cleanups: Array<() => void> = [];
afterEach(() => { for (const c of cleanups.splice(0)) c(); });

it("prints one listening line, answers /healthz, and exits 0 on SIGTERM with SQLite closed", { timeout: 60_000 }, async () => {
  const tmp = mkdtempSync(join(tmpdir(), "ac-lifecycle-"));
  const dataDir = join(tmp, "not", "yet", "data");
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !/^(AGENT_COOKIE_|UCP_|VITEST|MEMORY_REPO_PATH$|SQLITE_PATH$|FIXTURES_DIR$|PORT$|CALLBACK_)/.test(k)) env[k] = v;
  }
  Object.assign(env, { PORT: "0", AGENT_COOKIE_SEED: "blank", AGENT_COOKIE_DATA_DIR: dataDir, AGENT_COOKIE_UCP: "fixture", DREAMING_INTERVAL_MS: "0" });
  const child: ChildProcess = spawn(TSX, ["src/server.ts"], { cwd: WORKSPACE_DIR, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let out = "";
  let err = "";
  child.stdout!.on("data", (d) => { out += String(d); });
  child.stderr!.on("data", (d) => { err += String(d); });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done) => child.on("exit", (code, signal) => done({ code, signal })));
  let gone = false;
  void exited.then(() => { gone = true; });
  cleanups.push(() => {
    if (!gone && child.pid !== undefined) try { process.kill(-child.pid, "SIGKILL"); } catch { /* gone */ }
    rmSync(tmp, { recursive: true, force: true });
  });

  const deadline = Date.now() + 45_000;
  while (!LISTENING.test(out)) {
    if (gone || Date.now() > deadline) throw new Error(`no listening line. stderr:\n${err}\nstdout:\n${out}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  // owner.key is written before the listener opens: the supervisor can read it the moment the line appears.
  expect(existsSync(join(dataDir, "owner.key"))).toBe(true);
  const port = Number(LISTENING.exec(out)![1]);
  expect(port).toBeGreaterThan(0);
  const url = `http://127.0.0.1:${port}`;

  const health = await fetch(`${url}/healthz`);
  expect(health.status).toBe(200);
  expect(await health.json()).toEqual({ ok: true, seed: "blank" });
  const key = readFileSync(join(dataDir, "owner.key"), "utf8").trim();
  const me = await fetch(`${url}/me`, { headers: { authorization: `Bearer ${key}` } });
  expect(await me.json()).toEqual({ agentId: "owner", category: "personal", role: "owner" });
  expect(out.match(/listening on/g)).toHaveLength(1);

  process.kill(child.pid!, "SIGTERM");
  expect(await exited).toEqual({ code: 0, signal: null });
  const sqlite = join(dataDir, "workspace.sqlite");
  expect(existsSync(sqlite)).toBe(true);
  expect(existsSync(`${sqlite}-wal`)).toBe(false);
  expect(existsSync(`${sqlite}-journal`)).toBe(false);
  const db = new Database(sqlite);
  try {
    expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
    expect((db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n).toBe(1);
  } finally { db.close(); }
});
