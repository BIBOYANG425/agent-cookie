// A23(c,d), authorized exception: real HTTP plus the explicitly selected independent git memory repo.
// Synthetic ordinary-agent commits exercise stock format; they are NOT evidence of running Claude's skill.
import { randomUUID, createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertIndexResolves, assertMemoryBoundary, git, interopConfig, managedSeedDifferences,
  type InteropConfig } from './memory-interop.js';

type Json = Record<string, any>;
const suite = process.env.AGENT_COOKIE_A23_TEST === '1' ? describe.sequential : describe.skip;
const digest = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');

suite('A23 · Synthetic ordinary-agent memory interoperability · git + HTTP', () => {
  const runId = randomUUID();
  const skillAuthor = 'Synthetic A23 ordinary agent';
  const topic = `sample-a23/${runId}/preference.md`;
  const sql = `sample-a23/${runId}/query.sql`;
  const kind = `a23_${runId.replaceAll('-', '')}`;
  const tone = `Sample A23 concise ${runId}`;
  let config: InteropConfig;
  let skillCommit = '';
  let personalId = '';
  let callbackUrl = '';
  let server: Server | undefined;
  let interoperabilityCompleted = false;
  const preserved = new Map<string, string>();
  const sessions = new Map<string, string>();

  async function request(method: string, path: string, key: string | undefined, body?: Json, status = 200): Promise<Json> {
    let response: Response;
    try {
      response = await fetch(new URL(path, config.base), { method, redirect: 'error', credentials: 'omit', cache: 'no-store',
        headers: { Accept: 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000) });
    } catch { throw new Error('A23_HTTP_REQUEST_FAILED'); }
    // Report only status and a fixed operation path, never upstream error bodies, headers or credentials.
    expect(response.status, `A23 ${method} ${path.split('?')[0]} must complete without a persistence 500`).toBe(status);
    try { return await response.json() as Json; } catch { throw new Error('A23_INVALID_HTTP_RESPONSE'); }
  }

  async function changedSkillFiles(): Promise<string[]> {
    const changed: string[] = [];
    for (const [path, expected] of preserved) {
      try { if (digest(await readFile(join(config.repo, path))) !== expected) changed.push(path); }
      catch { changed.push(path); }
    }
    return changed;
  }

  beforeAll(async () => {
    config = interopConfig(process.env);
    config.repo = await assertMemoryBoundary(config.repo);
    // The stock skill reads MEMORY first and refuses dirty repositories before editing.
    const memory = await readFile(join(config.repo, 'MEMORY.md'), 'utf8');
    const owner = await request('GET', '/me', config.ownerKey);
    const personal = await request('GET', '/me', config.personalKey);
    expect(owner.role === 'owner').toBe(true);
    expect(personal.role === 'personal' && typeof personal.agentId === 'string').toBe(true);
    personalId = personal.agentId;
    if ((await git(config.repo, ['status', '--porcelain=v1', '--untracked-files=all'])).length > 0) throw new Error('A23_MEMORY_NOT_CLEAN');

    const links = `\n- [[${topic.slice(0, -3)}]]\n- [[${sql}]]`;
    const index = /^## Index[ \t]*\r?$/mu.exec(memory);
    const updated = index ? memory.slice(0, index.index + index[0].length) + links + memory.slice(index.index + index[0].length)
      : `${memory.replace(/\s*$/u, '')}\n\n## Index${links}\n`;
    const files = new Map([
      ['MEMORY.md', updated],
      [topic, '# Synthetic A23 preference\n\n- Sample preference: concise summaries; automated ordinary-agent fixture, not a Claude skill recording. [added: 2026-10-17]\n'],
      [sql, "-- Synthetic A23 file; data only, never executed.\nSELECT 'sample-a23' AS label;\n"],
    ]);
    for (const [path, content] of files) {
      await mkdir(dirname(join(config.repo, path)), { recursive: true });
      await writeFile(join(config.repo, path), content, { flag: path === 'MEMORY.md' ? 'w' : 'wx', mode: 0o600 });
      preserved.set(path, digest(content));
    }
    const changed = (await git(config.repo, ['status', '--porcelain=v1', '--untracked-files=all']))
      .trimEnd().split('\n').map(line => line.slice(3)).sort();
    expect(changed).toEqual([...files.keys()].sort());
    await git(config.repo, ['add', '--', ...files.keys()]);
    await git(config.repo, ['-c', `user.name=${skillAuthor}`, '-c', 'user.email=synthetic-a23@example.invalid',
      'commit', '--only', '-m', 'Synthetic A23: ordinary-agent stock-format memory update', '--', ...files.keys()]);
    skillCommit = (await git(config.repo, ['rev-parse', 'HEAD'])).trim();
    expect((await git(config.repo, ['status', '--porcelain=v1', '--untracked-files=all'])).length).toBe(0);
    await assertIndexResolves(config.repo, updated);

    // Inert local merchant callback: retain only introduction IDs, never full request payloads.
    server = createServer(async (req, res) => {
      if (req.method !== 'POST') { res.writeHead(405).end(); return; }
      try {
        let raw = '';
        for await (const chunk of req) {
          raw += chunk.toString();
          if (Buffer.byteLength(raw) > 64 * 1024) { res.writeHead(413).end(); return; }
        }
        const payload = JSON.parse(raw) as Json;
        if (payload.type === 'introduce' && typeof payload.intent?.id === 'string' && typeof payload.sessionId === 'string') {
          sessions.set(payload.intent.id, payload.sessionId);
        }
        res.writeHead(204).end();
      } catch { res.writeHead(400).end(); }
    });
    await new Promise<void>((resolve, reject) => { server!.once('error', reject); server!.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('A23_CALLBACK_BIND_FAILED');
    callbackUrl = `http://127.0.0.1:${address.port}/callback`;
  }, 30_000);

  afterAll(async () => {
    if (!server) return;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()));
    // Keep the dedicated repo and commits as evidence. No cleanup reset, checkout, clean or history rewrite.
  });

  it('A23(c) Synthetic topic files coexist with HTTP contributions, CARD regeneration and purpose receipts', async () => {
    const contribution = await request('POST', '/personal/contributions', config.personalKey, { field: 'tone', value: tone }, 201);
    expect(contribution.field === 'tone' && contribution.value === tone).toBe(true);
    const card = await request('GET', '/personal/card', config.personalKey);
    expect(Array.isArray(card.card) && card.card.some((row: Json) => row.field === 'tone' && row.value === tone)).toBe(true);
    expect((await readFile(join(config.repo, 'CARD.md'), 'utf8')).includes(tone), 'HTTP target must write the explicitly selected memory repo').toBe(true);

    const address = JSON.parse(await readFile(new URL('../../fixtures/address.json', import.meta.url), 'utf8')).value;
    await request('POST', '/personal/contributions', config.personalKey, { field: 'shipping_address', value: address }, 201);
    // retail is an existing category in main 32490f1. Unique capability prevents UCP or other merchants matching.
    const merchant = await request('POST', '/agents/register', undefined,
      { name: 'Synthetic A23 callback merchant', category: 'retail', capabilities: [kind], callbackUrl }, 201);
    expect(typeof merchant.key === 'string' && !!merchant.key && merchant.role === 'merchant').toBe(true);
    const intent = await request('POST', '/personal/intents', config.personalKey, { kind, public: { budget: '10.00' } }, 201);
    expect(intent.introduced).toBe(1);
    await expect.poll(() => sessions.has(intent.intentId), { timeout: 5000, interval: 20 }).toBe(true);
    const sessionId = sessions.get(intent.intentId)!;
    const quote = await request('POST', '/agent/quotes', merchant.key, { intentId: intent.intentId,
      text: 'Synthetic A23 offer; no real product or purchase', price: 100, currency: 'USD', etaDate: null,
      checkoutUrl: 'https://example.invalid/a23-synthetic-checkout' }, 201);
    const accepted = await request('POST', `/personal/quotes/${encodeURIComponent(quote.id)}/accept`, config.personalKey, {});
    expect(accepted.status).toBe('handoff');
    const fields = await request('GET', `/agent/fields?${new URLSearchParams({ sessionId, fields: 'shipping_address', purpose: 'checkout' })}`, merchant.key);
    expect(fields.fields?.shipping_address === address).toBe(true);
    const receipts = await request('GET', '/personal/receipts', config.personalKey);
    expect(Array.isArray(receipts.receipts) && receipts.receipts.some((row: Json) => row.sessionId === sessionId
      && row.agentId === merchant.agentId && row.purpose === 'checkout' && row.fields.includes('shipping_address'))).toBe(true);
    expect((await readFile(join(config.repo, 'receipts.md'), 'utf8')).includes(sessionId)).toBe(true);
    await request('PUT', `/agent/notes/a23_interop?${new URLSearchParams({ sessionId })}`, merchant.key,
      { value: 'Synthetic A23 note for reset verification' });
    const note = await request('GET', `/agent/notes/a23_interop?${new URLSearchParams({ sessionId })}`, merchant.key);
    expect(note.value === 'Synthetic A23 note for reset verification').toBe(true);
    const changedManaged = await managedSeedDifferences(config.repo);
    expect(changedManaged.some(path => path.startsWith('contributions/'))).toBe(true);
    expect(changedManaged.some(path => path.startsWith('notes/'))).toBe(true);
    expect(changedManaged).toContain('CARD.md');
    expect(changedManaged).toContain('receipts.md');
    expect(await changedSkillFiles()).toEqual([]);
    await assertIndexResolves(config.repo, await readFile(join(config.repo, 'MEMORY.md'), 'utf8'));
    const authors = (await git(config.repo, ['log', '--format=%an', `${skillCommit}..HEAD`])).split('\n');
    expect(authors).toContain('workspace');
    expect(authors).toContain(personalId);
    expect((await git(config.repo, ['show', '-s', '--format=%an', skillCommit])).trim()).toBe(skillAuthor);
    expect((await git(config.repo, ['log', '--format=%H'])).split('\n')).toContain(skillCommit);
    expect((await git(config.repo, ['status', '--porcelain=v1', '--untracked-files=all'])).length).toBe(0);
    interoperabilityCompleted = true;
  }, 60_000);

  it('A23(d) reset preserves Synthetic topic files and MEMORY Index while managed paths return to fixtures-seed', async () => {
    // Never reset a URL until the preceding HTTP/CARD check has bound it to this exact dedicated repo.
    if (!interoperabilityCompleted) throw new Error('A23_RESET_BLOCKED_UNVERIFIED_INTEROPERABILITY');
    const reset = await request('POST', '/demo/reset', config.ownerKey, {});
    expect(reset.ok).toBe(true);
    expect.soft(await changedSkillFiles(), 'ordinary-agent files and MEMORY edits must survive reset').toEqual([]);
    let linksResolve = false;
    try { await assertIndexResolves(config.repo, await readFile(join(config.repo, 'MEMORY.md'), 'utf8')); linksResolve = true; } catch { /* report boolean only */ }
    expect.soft(linksResolve, 'MEMORY Index root wiki links must still resolve').toBe(true);
    expect.soft((await git(config.repo, ['log', '--format=%H'])).split('\n'), 'ordinary-agent commit must remain in history').toContain(skillCommit);
    // Deliberately strict: do not disguise A's post-reset reconcile/CARD rewrites as byte-equal seed restoration.
    expect.soft(await managedSeedDifferences(config.repo), 'managed paths differ from fixtures-seed after HTTP reset').toEqual([]);
    expect((await git(config.repo, ['status', '--porcelain=v1', '--untracked-files=all'])).length).toBe(0);
  }, 30_000);
});
