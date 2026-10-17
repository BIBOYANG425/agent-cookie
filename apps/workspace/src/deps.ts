// Wires the store, clock, the three plug-in packages (stubs today) and the services.
import { resolve } from "node:path";
import { FIXTURE_FILES, isField, type Contribution, type MemoryRepo, type MemoryRepoApi, type RulesApi, type UcpApi } from "@agent-cookie/contract";
import { activityLogger, type Log } from "./activity.js";
import { loadMemoryRepoApi, loadRules, loadUcp } from "./adapters.js";
import { Clock } from "./clock.js";
import type { Config } from "./config.js";
import { Store } from "./db.js";
import { fail } from "./http.js";
import { Gate } from "./gate.js";
import { hashKey } from "./ids.js";
import { ensureOwnerKey, loadFixtures, seedStore, upgradeSeed, type Fixtures } from "./seed.js";
import { CardService } from "./services/card.js";
import { CommerceService } from "./services/commerce.js";
import type { Ctx } from "./services/context.js";
import { createLaneD, type LaneDHooks } from "./laneD.js";
import { tracedUcp } from "./telemetry.js";
import { Delivery } from "./services/delivery.js";
import { persist, writeMeta } from "./services/context.js";
import { FieldService } from "./services/fields.js";
import { NoteService } from "./services/notes.js";
import { SessionService } from "./services/sessions.js";

export interface Deps {
  config: Config;
  store: Store;
  clock: Clock;
  rules: RulesApi;
  ucp: UcpApi;
  repo: MemoryRepo;
  log: Log;
  delivery: Delivery;
  /** Lane D hooks (empty when AGENT_COOKIE_JAR_KEK / AGENT_COOKIE_UNLOCK_SECRET are not set). Mutable for tests. */
  laneD: LaneDHooks;
  fixtures: Fixtures;
  card: CardService;
  sessions: SessionService;
  fields: FieldService;
  notes: NoteService;
  commerce: CommerceService;
  /** Requests enter it; reset takes it exclusively. */
  gate: Gate;
  /** POST /demo/reset: wipe SQLite, reseed fixtures, reset the memory repo to its seed commit, clock offset 0. */
  reset(): Promise<string>;
  /** Waits for in-flight deliveries (they log their result), then closes SQLite. */
  close(): Promise<void>;
}

/** Unit tests swap in in-memory stubs; the running workspace always uses the real packages (adapters.ts). */
export interface DepsOverrides { ucp?: UcpApi; memoryRepoApi?: MemoryRepoApi; rules?: RulesApi; laneD?: LaneDHooks }

export async function createDeps(config: Config, overrides: DepsOverrides = {}): Promise<Deps> {
  const gate = new Gate();
  const store = new Store(config.sqlitePath, { busyTimeoutMs: config.sqliteBusyTimeoutMs });
  // A request overtaken by a reset must not write anything (gate.ts); it hears "not found", like any vanished object.
  store.setWriteGuard(() => { if (gate.stale()) fail("NOT_FOUND"); });
  const clock = new Clock();
  const log = activityLogger(store, clock, () => gate.stale());
  const fixtures = loadFixtures(config.fixturesDir, config.ucpFixturesDir);
  const rules = overrides.rules ?? loadRules();
  const ucp = overrides.ucp ?? loadUcp(config);
  const repo = await (overrides.memoryRepoApi ?? loadMemoryRepoApi()).openMemoryRepo({
    path: config.memoryRepoPath, seedDir: resolve(config.fixturesDir, FIXTURE_FILES.memory), userId: fixtures.users[0]!.userId, rules,
  });
  const laneD: LaneDHooks = overrides.laneD ?? createLaneD(config, clock);
  const delivery = new Delivery({ timeoutMs: config.callbackTimeoutMs, attempts: config.callbackRetries }, log, laneD);
  // Services call UCP through the Sentry wrapper (a span per call); deps.ucp stays the raw adapter for tests.
  const ctx: Ctx = { stale: () => gate.stale(), closing: () => gate.closing(), config, store, clock, rules, ucp: tracedUcp(ucp, config.ucpMode),
    repo: () => repo, log, delivery, laneD };
  const card = new CardService(ctx);
  const sessions = new SessionService(ctx, card);
  const fields = new FieldService(ctx, sessions, card);
  const notes = new NoteService(ctx, sessions);
  const commerce = new CommerceService(ctx, card, sessions, fields, notes, fixtures.pinnedVariantIds);

  if (!store.firstUser()) seedStore(store, fixtures, config, clock.nowIso());
  else upgradeSeed(store, fixtures, config, clock.nowIso());
  await reconcileRepo(ctx);
  // Sample keys are public: outside demo/test mode they must not open anything, even if a file DB kept them.
  if (!config.demo && !config.test) {
    for (const key of Object.keys(fixtures.devKeys)) store.deleteKey(hashKey(key));
    ensureOwnerKey(store, config, clock.nowIso());
  }
  card.get(fixtures.users[0]!.userId);

  return {
    config, store, clock, rules, ucp, repo, log, delivery, laneD, fixtures, card, sessions, fields, notes, commerce, gate,
    reset: () => gate.exclusive(async () => {
      await delivery.settle();
      clock.setOffset(0);
      store.clearAll();
      const now = clock.nowIso();
      seedStore(store, fixtures, config, now);
      await repo.resetToSeed();
      await reconcileRepo(ctx);
      card.get(fixtures.users[0]!.userId);
      log({ event: "demo.reset", actor: "owner", result: "ok" });
      return now;
    }, config.resetWaitMs),
    async close() {
      await delivery.settle();
      store.close();
      laneD.lock?.();
    },
  };
}

/**
 * Bring the git memory repo up to what SQLite serves: any contribution the repo lacks (the seeded address is not in
 * lane C's fixtures/memory commit; a failed write-through) is appended, revocations are replayed, and CARD.md is
 * regenerated once if anything changed. Runs after open and after resetToSeed.
 */
async function reconcileRepo(ctx: Ctx): Promise<void> {
  const user = ctx.store.firstUser();
  if (!user) return;
  await persist(ctx, "reconcile", "workspace", async (repo) => {
    const inRepo = new Map((await repo.listContributions()).map((c) => [c.id, c]));
    let changed = false;
    for (const c of ctx.store.contributionsForUser(user.userId)) {
      if (!isField(c.field)) continue;
      const have = inRepo.get(c.id);
      if (!have) {
        const { revokedAt: _r, ...live } = c as Contribution;
        await repo.appendContribution(live, writeMeta(ctx, c.agentId, live));
        changed = true;
      }
      if (c.revokedAt && !have?.revokedAt) {
        await repo.revokeContribution(c.id, c.revokedAt, writeMeta(ctx, "workspace", { id: c.id, at: c.revokedAt }));
        changed = true;
      }
    }
    if (changed) {
      await repo.regenerateCard({ now: ctx.clock.nowIso(), personalAgentIds: ctx.store.personalAgentIds() },
        writeMeta(ctx, "workspace", { regenerate: ctx.clock.nowIso() }));
    }
  });
}
