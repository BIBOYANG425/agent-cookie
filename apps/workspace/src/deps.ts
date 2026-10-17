// Wires the store, clock, the three plug-in packages (stubs today) and the services.
import { resolve } from "node:path";
import { FIXTURE_FILES, type MemoryRepo, type RulesApi, type UcpApi } from "@agent-cookie/contract";
import { activityLogger, type Log } from "./activity.js";
import { loadMemoryRepoApi, loadRules, loadUcp } from "./adapters.js";
import { Clock } from "./clock.js";
import type { Config } from "./config.js";
import { Store } from "./db.js";
import { Gate } from "./gate.js";
import { hashKey } from "./ids.js";
import { ensureOwnerKey, loadFixtures, seedStore, type Fixtures } from "./seed.js";
import { CardService } from "./services/card.js";
import { CommerceService } from "./services/commerce.js";
import type { Ctx } from "./services/context.js";
import { Delivery } from "./services/delivery.js";
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
  close(): void;
}

export async function createDeps(config: Config, overrides: { ucp?: UcpApi } = {}): Promise<Deps> {
  const store = new Store(config.sqlitePath);
  const clock = new Clock();
  const log = activityLogger(store, clock);
  const fixtures = loadFixtures(config.fixturesDir);
  const rules = loadRules();
  const ucp = overrides.ucp ?? loadUcp(config);
  const repo = await loadMemoryRepoApi(() => fixtures.contributions).openMemoryRepo({
    path: config.memoryRepoPath, seedDir: resolve(config.fixturesDir, FIXTURE_FILES.memory), userId: fixtures.users[0]!.userId, rules,
  });
  const delivery = new Delivery({ timeoutMs: config.callbackTimeoutMs, attempts: config.callbackRetries }, log);
  const ctx: Ctx = { config, store, clock, rules, ucp, repo: () => repo, log, delivery };
  const card = new CardService(ctx);
  const sessions = new SessionService(ctx, card);
  const fields = new FieldService(ctx, sessions, card);
  const notes = new NoteService(ctx, sessions);
  const commerce = new CommerceService(ctx, card, sessions, fields, notes);

  if (!store.firstUser()) seedStore(store, fixtures, config, clock.nowIso());
  // Sample keys are public: outside demo/test mode they must not open anything, even if a file DB kept them.
  if (!config.demo && !config.test) {
    for (const key of Object.keys(fixtures.devKeys)) store.deleteKey(hashKey(key));
    ensureOwnerKey(store, config, clock.nowIso());
  }
  card.get(fixtures.users[0]!.userId);

  const gate = new Gate();
  return {
    config, store, clock, rules, ucp, repo, log, delivery, fixtures, card, sessions, fields, notes, commerce, gate,
    reset: () => gate.exclusive(async () => {
      await delivery.settle();
      clock.setOffset(0);
      store.clearAll();
      const now = clock.nowIso();
      seedStore(store, fixtures, config, now);
      await repo.resetToSeed();
      card.get(fixtures.users[0]!.userId);
      log({ event: "demo.reset", actor: "owner", result: "ok" });
      return now;
    }),
    close() {
      store.close();
    },
  };
}
