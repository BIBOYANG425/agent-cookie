// Seed from fixtures (lane C's fixtures/, or apps/workspace/sample-fixtures). Used at first start and by
// POST /demo/reset. Dev keys load only in demo/test mode; otherwise an owner key is minted once and written
// to <dataDir>/owner.key (0600) for the console — never printed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { FIXTURE_FILES, isField, type Agent, type Contribution, type DevKeys, type SeedUser } from "@agent-cookie/contract";
import type { Config } from "./config.js";
import type { Store } from "./db.js";
import { hashKey, mintKey } from "./ids.js";

export interface Fixtures { users: SeedUser[]; agents: Agent[]; contributions: Contribution[]; devKeys: DevKeys }

function readJson<T>(dir: string, file: string, dflt: T): T {
  const p = resolve(dir, file);
  if (!existsSync(p)) return dflt;
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

export function loadFixtures(dir: string): Fixtures {
  const users = readJson<SeedUser[]>(dir, FIXTURE_FILES.users, []);
  if (users.length === 0) throw new Error(`no users in ${resolve(dir, FIXTURE_FILES.users)}`);
  return {
    users,
    agents: readJson<Agent[]>(dir, FIXTURE_FILES.agents, []),
    contributions: readJson<Contribution[]>(dir, FIXTURE_FILES.contributions, []).filter((c) => isField(c.field)),
    devKeys: readJson<DevKeys>(dir, FIXTURE_FILES.devKeys, {}),
  };
}

export function seedStore(store: Store, f: Fixtures, config: Config, now: string): void {
  store.tx(() => {
    for (const u of f.users) store.insertUser({ userId: u.userId, name: u.name, secret: u.secret, createdAt: now });
    for (const a of f.agents) store.insertAgent(a);
    for (const c of f.contributions) store.insertContribution(c);
    if (config.demo || config.test) {
      for (const [key, who] of Object.entries(f.devKeys)) store.insertKey({ keyHash: hashKey(key), agentId: who.agentId, role: who.role, createdAt: now });
    }
  });
  ensureOwnerKey(store, config, now);
}

/** Outside demo/test mode there is always exactly one way in for the console: a minted owner key in <dataDir>/owner.key. */
export function ensureOwnerKey(store: Store, config: Config, now: string): void {
  if (!config.demo && !config.test && !store.hasOwnerKey()) {
    const key = mintKey();
    mkdirSync(config.dataDir, { recursive: true });
    const path = resolve(config.dataDir, "owner.key");
    writeFileSync(path, `${key}\n`, { mode: 0o600 });
    store.insertKey({ keyHash: hashKey(key), agentId: "owner", role: "owner", createdAt: now });
    console.log(`[workspace] owner key written to ${path}`);
  }
}
