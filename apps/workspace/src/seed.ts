// Seed from fixtures (lane C's fixtures/, or apps/workspace/sample-fixtures). Used at first start and by
// POST /demo/reset. Dev keys load only in demo/test mode with the sample seed; otherwise an owner key is minted once and
// written to <dataDir>/owner.key (0600) for the console or a supervisor on the same host — never printed.
// AGENT_COOKIE_SEED=blank (one instance per person under the hosted gateway): one owner with a generated id and secret,
// no contribution, no agent, no Sample key, and an empty memory repo (writeBlankMemorySeed).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import {
  DEFAULT_POLICY, FIXTURE_FILES, isField,
  type Agent, type Contribution, type DevKeys, type PinnedOffers, type RulesApi, type SeedAddress, type SeedUser,
} from "@agent-cookie/contract";
// The POLICY.yaml writer is not part of RulesApi; the blank seed uses the same one as lane C's seed and writePolicy.
import { renderPolicyYaml } from "@agent-cookie/rules";
import type { Config } from "./config.js";
import type { Store, UserRow } from "./db.js";
import { hashKey, mintKey, mintSecret, newId } from "./ids.js";

/** The blank seed's one user: a neutral name; the id and the secret are generated. */
export const BLANK_USER_NAME = "owner";
/** Under the data dir: the generated seed directory of a blank instance's memory repo (rewritten at every start). */
export const BLANK_MEMORY_SEED_DIR = "memory-seed";
/**
 * First line of the blank seed's POLICY.yaml. It starts with the generated-seed prefix lane C's policyYamlOrigin
 * recognises, so memory-repo's readPolicy reports "seed" and the workspace serves DEFAULT_POLICY until the owner installs one.
 */
export const BLANK_POLICY_HEADER = "# Generated from @agent-cookie/contract POLICY_TABLE (DEFAULT_POLICY). Blank seed.";

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
  return {
    users,
    agents,
    contributions,
    devKeys: readJson<DevKeys>(dir, FIXTURE_FILES.devKeys, {}),
    pinnedVariantIds: pinnedVariantIds(ucpDir ?? resolve(dir, FIXTURE_FILES.ucp)),
  };
}

function pinnedVariantIds(ucpDir: string): string[] {
  const pinned = readJson<PinnedOffers | null>(ucpDir, "pinned.json", null);
  return (pinned?.offers ?? []).map((o) => o.variantId).filter((v): v is string => typeof v === "string" && v.length > 0);
}

/**
 * AGENT_COOKIE_SEED=blank: exactly one user — the one this database already holds, else a new one with a generated id,
 * a generated secret and a neutral name — and no agent, no contribution, no key. The same user (id and secret) is
 * restored by POST /demo/reset, so the memory repo's identity and the session ids survive it, as in sample mode (A22).
 * The UCP replay's pinned variants stay: they belong to the data source (AGENT_COOKIE_UCP=fixture), not to the person.
 */
export function blankFixtures(existing: UserRow | undefined, ucpDir: string): Fixtures {
  const user: SeedUser = existing ? { userId: existing.userId, name: existing.name, secret: existing.secret }
    : { userId: newId("usr"), name: BLANK_USER_NAME, secret: mintSecret() };
  return { users: [user], agents: [], contributions: [], devKeys: {}, pinnedVariantIds: pinnedVariantIds(ucpDir) };
}

/**
 * Before a blank instance serves anything: refuse a database that holds lane C's Sample seed — its user, a seed-origin
 * contribution, or one of its own agents (UCP proxies, which carry a domain, are left out: commerce adds those on demand
 * in any instance) — since switching AGENT_COOKIE_SEED on an existing data dir would otherwise serve the Sample persona
 * as "blank"; and drop the public Sample keys should any row of them exist. Fixture files are read leniently (missing = empty).
 */
export function prepareBlankStore(store: Store, fixturesDir: string): void {
  const users = readJson<SeedUser[]>(fixturesDir, FIXTURE_FILES.users, []);
  const agents = readJson<Agent[]>(fixturesDir, FIXTURE_FILES.agents, []).filter((a) => !a.domain);
  const user = store.firstUser();
  if (user && (users.some((u) => u.userId === user.userId) || store.hasSeedContribution()
      || agents.some((a) => store.agent(a.agentId) !== undefined))) {
    throw new Error("AGENT_COOKIE_SEED=blank: this database holds the Sample seed; start a blank instance on an empty data directory");
  }
  for (const key of Object.keys(readJson<DevKeys>(fixturesDir, FIXTURE_FILES.devKeys, {}))) store.deleteKey(hashKey(key));
}

/**
 * The memory repo's seed for a blank instance, written fresh at every start to <dataDir>/memory-seed and handed to
 * openMemoryRepo as its seedDir (memory-repo reads it only when it first initializes the repo; POST /demo/reset restores
 * the commit made from it). It holds only the managed files of an empty card: MEMORY.md, an empty contributions/ and
 * notes/, CARD.md generated by the rules from no contributions, receipts.md, and POLICY.yaml rendered from
 * DEFAULT_POLICY under BLANK_POLICY_HEADER. Deterministic: the same user id and time give the same bytes.
 */
export function writeBlankMemorySeed(config: Config, rules: RulesApi, userId: string, generatedAt: string): string {
  const dir = resolve(config.dataDir, BLANK_MEMORY_SEED_DIR);
  const within = (parent: string, child: string) => {
    const r = relative(parent, child);
    return r === "" || (!r.startsWith("..") && !isAbsolute(r));
  };
  // The directory is removed before it is written: it must never contain (or be inside) the memory repo itself.
  if (within(dir, config.memoryRepoPath) || within(config.memoryRepoPath, dir)) {
    throw new Error(`MEMORY_REPO_PATH must not overlap ${dir} (the blank memory seed)`);
  }
  rmSync(dir, { recursive: true, force: true });
  for (const sub of ["contributions", "notes"]) mkdirSync(resolve(dir, sub), { recursive: true, mode: 0o700 });
  const card = rules.renderCard(rules.mergeCard([], { now: generatedAt, personalAgentIds: [] }), { userId, generatedAt });
  const files: Array<[string, string]> = [
    ["MEMORY.md", "Memory of this jar; CARD is generated from contributions.\n\n## Index\n- [[CARD]]\n- [[receipts]]\n- [[POLICY.yaml]]\n"],
    ["CARD.md", card],
    ["POLICY.yaml", renderPolicyYaml(DEFAULT_POLICY, BLANK_POLICY_HEADER)],
    ["receipts.md", "# Receipts\n\n"],
    ["contributions/.gitkeep", ""],
    ["notes/.gitkeep", ""],
  ];
  for (const [name, text] of files) writeFileSync(resolve(dir, name), text, { mode: 0o600 });
  return dir;
}

export function seedStore(store: Store, f: Fixtures, config: Config, now: string): void {
  store.tx(() => {
    for (const u of f.users) store.insertUser({ userId: u.userId, name: u.name, secret: u.secret, createdAt: now });
    // A blank instance seeds its one user and nothing else, whatever the fixtures hold.
    if (config.seed === "sample") {
      for (const a of f.agents) store.insertAgent(a);
      for (const c of f.contributions) store.insertContribution(c, "seed");
      if (config.demo || config.test) {
        for (const [key, who] of Object.entries(f.devKeys)) store.insertKey({ keyHash: hashKey(key), agentId: who.agentId, role: who.role, createdAt: now });
      }
    }
  });
  ensureOwnerKey(store, config, now);
}

/**
 * Unless the Sample keys are loaded (sample seed in demo/test mode), there is always exactly one way in for the console
 * or a supervisor: a minted owner key in <dataDir>/owner.key. A blank instance mints it in demo/test mode too.
 */
export function ensureOwnerKey(store: Store, config: Config, now: string): void {
  const sampleKeys = config.seed === "sample" && (config.demo || config.test);
  if (!sampleKeys && !store.hasOwnerKey()) {
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
  // A blank database never gains fixture agents, contributions or keys on restart.
  if (config.seed === "blank") return;
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
