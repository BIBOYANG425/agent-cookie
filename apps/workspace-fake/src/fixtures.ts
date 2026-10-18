import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isField, type Agent, type Contribution, type Quote, type Role, type Category, type SeedUser } from '@agent-cookie/contract';

export interface FixtureKey { key: string; userId: string; agentId: string; role: Role; category: Category }
export type FixtureUser = SeedUser;
export type FixtureQuote = Omit<Quote, 'id' | 'intentId'>;
export interface Fixtures {
  users: FixtureUser[]; agents: Agent[]; keys: FixtureKey[];
  contributions: Contribution[]; quotes: FixtureQuote[];
}

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Fixtures are local Sample inputs, never a substitute for a missing live workspace. */
export async function loadFixtures(directory: string): Promise<Fixtures> {
  const read = async (name: string): Promise<unknown> => JSON.parse(await readFile(join(directory, name), 'utf8'));
  const [users, agents, devKeys, contributions, quotes] = await Promise.all([
    read('users.json'), read('agents.json'), read('dev-keys.json'), read('contributions.json'), read('quotes.json'),
  ]);
  if (!Array.isArray(users) || users.length !== 1 || !Array.isArray(agents) || !object(devKeys)) {
    throw new Error('Sample fixture files must follow contract: one user and a dev-key map.');
  }
  const keys = Object.entries(devKeys).map(([key, binding]) => {
    if (!object(binding)) throw new Error('Invalid fixture key binding.');
    const agent = agents.find(a => a.agentId === binding.agentId);
    return { key, userId: users[0].userId, agentId: binding.agentId, role: binding.role,
      category: binding.role === 'owner' ? 'personal' : agent?.category };
  });
  return validateFixtures({ users, agents, keys, contributions, quotes });
}

export function validateFixtures(value: unknown): Fixtures {
  const fail = (): never => { throw new Error('Invalid Sample fixtures. Check the documented fixture schema; no credential values are logged.'); };
  if (!object(value)) return fail();
  const { users, agents, keys, contributions, quotes } = value;
  if (![users, agents, keys, contributions, quotes].every(Array.isArray)) return fail();
  const us = users as unknown[], as = agents as unknown[], ks = keys as unknown[], cs = contributions as unknown[], qs = quotes as unknown[];
  if (!us.length || !as.length || !ks.length) return fail();
  if (!us.every(u => object(u) && text(u.userId) && text(u.secret) && text(u.name))) return fail();
  const userIds = new Set(us.map(u => (u as FixtureUser).userId));
  if (userIds.size !== us.length) return fail();
  if (!as.every(a => object(a) && text(a.agentId) && text(a.name) && ['personal', 'shoe', 'retail'].includes(String(a.category))
      && Array.isArray(a.capabilities) && a.capabilities.every(text) && text(a.createdAt))) return fail();
  const agentIds = new Set(as.map(a => (a as Agent).agentId));
  if (agentIds.size !== as.length) return fail();
  if (!ks.every(k => object(k) && text(k.key) && /^[\x21-\x7e]+$/.test(k.key) && userIds.has(String(k.userId))
      && text(k.agentId) && ['personal', 'merchant', 'owner'].includes(String(k.role))
      && ['personal', 'shoe', 'retail'].includes(String(k.category))
      && (k.role === 'owner' || as.some(a => object(a) && a.agentId === k.agentId && a.category === k.category
        && (k.role === 'personal' ? k.category === 'personal' : k.category !== 'personal'))))) return fail();
  if (new Set(ks.map(k => (k as FixtureKey).key)).size !== ks.length) return fail();
  if (!cs.every(c => object(c) && text(c.id) && userIds.has(String(c.userId)) && agentIds.has(String(c.agentId))
      && isField(c.field) && typeof c.value === 'string' && ['observed', 'stated', 'inferred'].includes(String(c.basis))
      && typeof c.createdAt === 'string' && Number.isFinite(Date.parse(c.createdAt)))) return fail();
  if (!qs.every(q => object(q) && agentIds.has(String(q.agentId)) && typeof q.text === 'string'
      && Number.isSafeInteger(q.price) && Number(q.price) >= 0 && q.currency === 'USD'
      && (q.etaDate == null || typeof q.etaDate === 'string') && (q.sizeNote === undefined || typeof q.sizeNote === 'string')
      && (q.checkoutUrl === undefined || (typeof q.checkoutUrl === 'string' && safeSampleUrl(q.checkoutUrl))))) return fail();
  return structuredClone(value) as unknown as Fixtures;
}

export function safeSampleUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password
    && (url.hostname === 'example.com' || url.hostname.endsWith('.example.com')); } catch { return false; }
}
