// Seed from fixtures (lane C's fixtures/, or apps/workspace/sample-fixtures). Used at first start and by
// POST /demo/reset. Dev keys load only in demo/test mode; otherwise an owner key is minted once and written
// to <dataDir>/owner.key (0600) for the console — never printed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  FIXTURE_FILES, isField,
  type Agent, type Contribution, type DevKeys, type PinnedOffers, type SeedAddress, type SeedUser,
} from "@agent-cookie/contract";
import type { Config } from "./config.js";
import type { Store } from "./db.js";
import { hashKey, mintKey } from "./ids.js";

export interface Fixtures {
  users: SeedUser[];
  agents: Agent[];
  /** contributions.json plus address.json imported as a personal stated shipping_address (B21). All Sample. */
  contributions: Contribution[];
  devKeys: DevKeys;
  /** Variant ids from ucp/pinned.json, preferred when they pass the filters (plan T4: 锁定的两个变体演示时优先用). */
  pinnedVariantIds: string[];
}

function readJson<T>(dir: string, file: string, dflt: T): T {
  const p = resolve(dir, file);
  if (!existsSync(p)) return dflt;
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

export function loadFixtures(dir: string, ucpDir?: string): Fixtures {
  const users = readJson<SeedUser[]>(dir, FIXTURE_FILES.users, []);
  if (users.length === 0) throw new Error(`no users in ${resolve(dir, FIXTURE_FILES.users)}`);
  const agents = readJson<Agent[]>(dir, FIXTURE_FILES.agents, []);
  const contributions = readJson<Contribution[]>(dir, FIXTURE_FILES.contributions, []).filter((c) => isField(c.field));
  const address = readJson<SeedAddress | null>(dir, FIXTURE_FILES.address, null);
  const personal = agents.find((a) => a.category === "personal");
  if (address && address.field === "shipping_address" && typeof address.value === "string" && address.value && personal
      && !contributions.some((c) => c.field === "shipping_address")) {
    // Deterministic id and time so reset replays byte-identically: one second after the newest seed contribution.
    const last = contributions.reduce((m, c) => Math.max(m, Date.parse(c.createdAt) || 0), 0);
    contributions.push({ id: "seed-shipping-address-01", userId: users[0]!.userId, agentId: personal.agentId, field: "shipping_address",
      value: address.value, basis: "stated", createdAt: new Date((last || Date.parse("2026-10-17T00:00:00.000Z")) + 1000).toISOString() });
  }
  const pinned = readJson<PinnedOffers | null>(ucpDir ?? resolve(dir, FIXTURE_FILES.ucp), "pinned.json", null);
  return {
    users,
    agents,
    contributions,
    devKeys: readJson<DevKeys>(dir, FIXTURE_FILES.devKeys, {}),
    pinnedVariantIds: (pinned?.offers ?? []).map((o) => o.variantId).filter((v): v is string => typeof v === "string" && v.length > 0),
  };
}

export function seedStore(store: Store, f: Fixtures, config: Config, now: string): void {
  store.tx(() => {
    for (const u of f.users) store.insertUser({ userId: u.userId, name: u.name, secret: u.secret, createdAt: now });
    for (const a of f.agents) store.insertAgent(a);
    for (const c of f.contributions) store.insertContribution(c, "seed");
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

/**
 * A database created by an older workspace (or a restart on a file database): add fixture agents it lacks, load the
 * Sample keys in demo/test mode, mark the fixture contributions as Sample seed (origin, B20) and add seed
 * contributions it never had (the address, B21). A seed id that exists — even revoked — is left alone.
 */
export function upgradeSeed(store: Store, f: Fixtures, config: Config, now: string): void {
  store.tx(() => {
    for (const a of f.agents) if (!store.agent(a.agentId)) store.insertAgent(a);
    if (config.demo || config.test) {
      for (const [key, who] of Object.entries(f.devKeys)) store.insertKey({ keyHash: hashKey(key), agentId: who.agentId, role: who.role, createdAt: now });
    }
    for (const c of f.contributions) {
      if (store.contribution(c.id)) store.markSeed(c.id);
      else store.insertContribution(c, "seed");
    }
  });
}
