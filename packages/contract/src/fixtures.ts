// What the workspace reads from FIXTURES_DIR (lane C owns fixtures/). All content is Sample data.
// Seeded at startup when the database is empty, and again by POST /demo/reset.
import type { Agent, Contribution, Role } from "./types.js";

export const FIXTURE_FILES = {
  /** SeedUser[] — the hackathon has one user. */
  users: "users.json",
  /** Agent[] — registered agents and UCP proxies (domain set). No keys in this file. */
  agents: "agents.json",
  /** Contribution[] — the initial card's sources. */
  contributions: "contributions.json",
  /** DevKeys — Sample keys. Loaded only when AGENT_COOKIE_DEMO=1 or AGENT_COOKIE_TEST=1. */
  devKeys: "dev-keys.json",
  /** Directory: the initial commit of the user's git memory repo (MemoryRepoApi seedDir). */
  memory: "memory",
  /** Directory: recorded `ucp` CLI responses (UcpOptions.fixturesDir). */
  ucp: "ucp",
} as const;

export interface SeedUser {
  userId: string;
  name: string;
  /** userSecret for deriveSessionId. Restored by reset, so session IDs survive reset (A22). */
  secret: string;
}

export type SeedAgent = Agent;

/**
 * key → who holds it. Keys are read by callers from AGENT_COOKIE_KEY only — never pasted into chat,
 * logs or commit messages. The real workspace mints keys at POST /agents/register; this file is for demo
 * and acceptance runs. An owner key uses agentId "owner" and needs no agents.json entry.
 */
export type DevKeys = Record<string, { agentId: string; role: Role }>;

export type SeedContribution = Contribution;
