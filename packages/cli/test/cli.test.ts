import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceClient } from '@agent-cookie/sdk';
import { runCli } from '../src/cli.js';

function harness(role = 'personal') {
  const output = { out: '', err: '' };
  const io = { out: (s: string) => { output.out += s; }, err: (s: string) => { output.err += s; } };
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => String(url).endsWith('/me')
    ? Response.json({ agentId: 'sample', role, category: 'personal' })
    : Response.json({ sample: true, card: [], candidates: [] }));
  const createClient = vi.fn(() => new WorkspaceClient({ baseUrl: 'http://127.0.0.1:4310', key: 'sample-key', fetch: fetcher }));
  return { output, io, fetcher, createClient };
}

it('offers help without credentials or any network call', async () => {
  const h = harness();
  expect(await runCli(['--help'], {}, h.io, h.createClient)).toBe(0);
  expect(h.output.out).toContain('card');
  expect(h.output.out).not.toContain('accept');
  expect(h.createClient).not.toHaveBeenCalled();
});
it('reads the card through the SDK and supports pretty JSON', async () => {
  const h = harness();
  expect(await runCli(['card', '--pretty'], {}, h.io, h.createClient)).toBe(0);
  expect(JSON.parse(h.output.out)).toEqual({ sample: true, card: [], candidates: [] });
  expect(h.output.out).toContain('\n  "sample"');
  expect(h.fetcher).toHaveBeenCalledTimes(2);
  expect(h.output.err).toBe('');
});
it('does not read a personal card with a merchant key', async () => {
  const h = harness('merchant');
  expect(await runCli(['card'], {}, h.io, h.createClient)).toBe(1);
  expect(h.fetcher).toHaveBeenCalledTimes(1);
  expect(h.output.out).toBe('');
  expect(h.output.err).toContain('SCOPE_DENIED');
});
it('rejects unfinished commands without echoing arbitrary arguments', async () => {
  const h = harness();
  expect(await runCli(['secret-token'], {}, h.io, h.createClient)).toBe(1);
  expect(h.output.out).toBe('');
  expect(h.output.err).not.toContain('secret-token');
  expect(h.createClient).not.toHaveBeenCalled();
});
it('reports missing configuration without leaking values', async () => {
  const h = harness();
  expect(await runCli(['card'], {}, h.io)).toBe(1);
  expect(h.output.err).toContain('configuration');
  expect(h.output.out).toBe('');
});

// ---- funnel and policy (owner analytics + policy document) ----
const ownerKey = 'sample-owner-secret-key';
const at = '2026-10-17T20:00:00.000Z';
const funnel = { sample: true, generatedAt: at, rows: [
  { intentId: 'sample-intent-2', createdAt: '2026-10-17T19:10:00.000Z', source: 'sample', introduced: 1, quoted: 0, accepted: false,
    fieldsGranted: 6, fieldsRead: 0, purposeReleases: 0 },
  { intentId: 'sample-intent-1', createdAt: '2026-10-17T18:05:00.000Z', source: 'sample', introduced: 2, quoted: 2, firstQuoteMs: 1200,
    accepted: true, outcome: 'handoff', fieldsGranted: 7, fieldsRead: 3, purposeReleases: 1,
    search: { offers: 4, droppedAvoid: 0, droppedCurrency: 0, droppedUnavailable: 1, droppedShipsTo: 0, droppedBudget: 0, droppedInvalid: 0,
      eligible: 3, eligibleSellers: 3, picked: 2 } },
] };
const doc = {
  v: 1,
  auto: { personal: ['lang', 'tone', 'length', 'shipping_address'], shoe: ['lang', 'tone', 'length', 'shoe_size'], retail: ['lang', 'tone', 'length'] },
  purpose: { personal: {}, shoe: { shipping_address: ['checkout'] }, retail: { shipping_address: ['checkout'] } },
  write: { personal: ['lang', 'tone', 'length', 'shipping_address'], shoe: ['shoe_size'], retail: ['shoe_size'] },
};
const view = { policy: doc, policyId: '0123456789ab', source: 'default', sample: true };
const shadow = { candidateId: 'c4ndidate000', currentId: '0123456789ab', unchanged: 7, changed: [
  { ref: 'sample-receipt-1', kind: 'receipt', field: 'shipping_address', before: 'allow', after: 'PURPOSE_MISMATCH' },
  { ref: 'sample-read-1', kind: 'read', field: 'shoe_size', before: 'allow', after: 'SCOPE_DENIED' },
] };
const floor = 'auto.shoe must include lang (every handshake carries it); write.shoe: merchants may write shoe_size only, not budget';
const files: string[] = [];
afterAll(async () => { for (const dir of files.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function policyFile(content: string) {
  const dir = await mkdtemp(join(tmpdir(), 'cookie-cli-')); files.push(dir);
  const path = join(dir, 'policy.json'); await writeFile(path, content); return path;
}
function owner(respond: (url: URL, init?: RequestInit) => Response) {
  const output = { out: '', err: '' };
  const io = { out: (s: string) => { output.out += s; }, err: (s: string) => { output.err += s; } };
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, init) => respond(new URL(String(url)), init));
  const createClient = vi.fn(() => new WorkspaceClient({ baseUrl: 'http://127.0.0.1:4310', key: ownerKey, fetch: fetcher }));
  return { output, io, fetcher, createClient, printed: () => output.out + output.err };
}
const denied = () => Response.json({ error: { code: 'SCOPE_DENIED', message: 'wrong role for this route' } }, { status: 403 });

describe('funnel', () => {
  it('lists the new commands in help without calling the workspace', async () => {
    const h = owner(denied);
    expect(await runCli(['--help'], {}, h.io, h.createClient)).toBe(0);
    expect(h.output.out).toMatch(/funnel[\s\S]*policy/);
    expect(await runCli(['policy'], {}, h.io, h.createClient)).toBe(0);
    expect(h.output.out).toMatch(/show[\s\S]*shadow[\s\S]*set/);
    expect(await runCli(['policy', 'bogus'], {}, h.io, h.createClient)).toBe(1);
    expect(h.output.err).not.toContain('bogus');
    expect(h.createClient).not.toHaveBeenCalled();
  });

  it('prints a Sample-labelled table and forwards since/limit', async () => {
    const h = owner(() => Response.json(funnel));
    expect(await runCli(['funnel', '--since', '2026-10-17T00:00:00Z', '--limit', '5'], {}, h.io, h.createClient)).toBe(0);
    const url = new URL(String(h.fetcher.mock.calls[0][0]));
    expect(url.pathname).toBe('/owner/funnel');
    expect(Object.fromEntries(url.searchParams)).toEqual({ since: '2026-10-17T00:00:00Z', limit: '5' });
    const lines = h.output.out.trimEnd().split('\n');
    expect(lines[0]).toBe(`Sample funnel · generated ${at} · 2 intents`);
    expect(lines[1].split(/\s{2,}/)).toEqual(['intent', 'time', 'introduced', 'quoted', 'first quote ms', 'accepted', 'outcome',
      'fields read/granted', 'receipts', 'sellers picked/eligible']);
    expect(lines[2].split(/\s{2,}/)).toEqual(['sample-intent-2', '2026-10-17T19:10:00.000Z', '1', '0', '-', 'no', '-', '0/6', '0', '-']);
    expect(lines[3].split(/\s{2,}/)).toEqual(['sample-intent-1', '2026-10-17T18:05:00.000Z', '2', '2', '1200', 'yes', 'handoff', '3/7', '1', '2/3']);
    expect(h.output.err).toBe('');
    expect(h.printed()).not.toContain(ownerKey);
  });

  it('prints JSON with --json and omits the Sample label for live data', async () => {
    const h = owner(() => Response.json({ ...funnel, sample: false, rows: [] }));
    expect(await runCli(['funnel', '--json', '--pretty'], {}, h.io, h.createClient)).toBe(0);
    expect(JSON.parse(h.output.out)).toEqual({ ...funnel, sample: false, rows: [] });
    expect(h.output.out).toContain('\n  "rows"');
    const t = owner(() => Response.json({ ...funnel, sample: false, rows: [] }));
    expect(await runCli(['funnel'], {}, t.io, t.createClient)).toBe(0);
    expect(t.output.out).toBe(`Funnel · generated ${at} · 0 intents\nNo intents.\n`);
  });

  it.each([['--limit', '0'], ['--limit', '1001'], ['--limit', '2.5'], ['--since', 'yesterday']])('refuses %s %s before any request', async (flag, value) => {
    const h = owner(() => Response.json(funnel));
    expect(await runCli(['funnel', flag, value], {}, h.io, h.createClient)).toBe(1);
    expect(JSON.parse(h.output.err).error.message).toContain(flag);
    expect(h.fetcher).not.toHaveBeenCalled();
  });

  it('reports an owner-only denial for a personal key', async () => {
    const h = owner(denied);
    expect(await runCli(['funnel'], {}, h.io, h.createClient)).toBe(1);
    expect(JSON.parse(h.output.err)).toEqual({ error: { status: 403, code: 'SCOPE_DENIED', message: 'Workspace policy denied this request.' } });
    expect(h.output.out).toBe('');
  });
});

describe('policy', () => {
  it('shows id, source and one row per field with a column per category', async () => {
    const h = owner(() => Response.json(view));
    expect(await runCli(['policy', 'show'], {}, h.io, h.createClient)).toBe(0);
    expect(String(h.fetcher.mock.calls[0][0])).toBe('http://127.0.0.1:4310/personal/policy');
    const lines = h.output.out.trimEnd().split('\n');
    expect(lines[0]).toBe('Sample · Policy 0123456789ab · source default');
    expect(lines[1].split(/\s{2,}/)).toEqual(['field', 'personal', 'shoe', 'retail']);
    expect(lines[2].split(/\s{2,}/)).toEqual(['lang', 'auto w', 'auto', 'auto']);
    expect(lines[5].split(/\s{2,}/)).toEqual(['shipping_address', 'auto w', 'purpose:checkout', 'purpose:checkout']);
    expect(lines[6].split(/\s{2,}/)).toEqual(['shoe_size', '-', 'auto w', '- w']);
    expect(lines[7]).toContain('w = writable');
  });

  it('prints the view as JSON with --json', async () => {
    const h = owner(() => Response.json({ ...view, policy: { ...doc, ranking: { winRate: 40, failure: 60 } } }));
    expect(await runCli(['policy', 'show', '--json'], {}, h.io, h.createClient)).toBe(0);
    expect(JSON.parse(h.output.out)).toEqual({ ...view, policy: { ...doc, ranking: { winRate: 40, failure: 60 } } });
    const t = owner(() => Response.json({ ...view, policy: { ...doc, ranking: { winRate: 40, failure: 60 } } }));
    expect(await runCli(['policy', 'show'], {}, t.io, t.createClient)).toBe(0);
    expect(t.output.out).toContain('ranking: winRate 40, failure 60\n');
  });

  it('shadows a file and prints each change and the unchanged count', async () => {
    const h = owner(() => Response.json(shadow));
    expect(await runCli(['policy', 'shadow', await policyFile(JSON.stringify(doc, null, 2))], {}, h.io, h.createClient)).toBe(0);
    const [url, init] = h.fetcher.mock.calls[0];
    expect(String(url)).toBe('http://127.0.0.1:4310/personal/policy/shadow');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ policy: doc });
    expect(h.output.out).toBe('Candidate c4ndidate000 vs current 0123456789ab\n'
      + 'sample-receipt-1 receipt shipping_address allow -> PURPOSE_MISMATCH\n'
      + 'sample-read-1 read shoe_size allow -> SCOPE_DENIED\n'
      + 'unchanged: 7\n');
  });

  it('accepts the output of policy show --json as a policy file', async () => {
    const h = owner(() => Response.json({ ...shadow, changed: [], sample: true }));
    expect(await runCli(['policy', 'shadow', await policyFile(JSON.stringify(view))], {}, h.io, h.createClient)).toBe(0);
    expect(JSON.parse(String(h.fetcher.mock.calls[0][1]?.body))).toEqual({ policy: doc });
    expect(h.output.out).toBe('Sample · Candidate c4ndidate000 vs current 0123456789ab\nNo decision changes.\nunchanged: 7\n');
  });

  it('installs a file with PUT and prints the new id', async () => {
    const h = owner(() => Response.json({ ...view, policyId: 'fedcba987654', source: 'installed', sample: false }));
    expect(await runCli(['policy', 'set', await policyFile(JSON.stringify(doc))], {}, h.io, h.createClient)).toBe(0);
    const [url, init] = h.fetcher.mock.calls[0];
    expect(String(url)).toBe('http://127.0.0.1:4310/personal/policy');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual(doc);
    expect(h.output.out).toBe('Installed policy fedcba987654 (source installed)\n');
    expect(h.printed()).not.toContain(ownerKey);
  });

  it('prints every floor violation on its own line and exits 1', async () => {
    const h = owner(() => Response.json({ error: { code: 'MISSING_FIELD', message: floor } }, { status: 422 }));
    expect(await runCli(['policy', 'set', await policyFile(JSON.stringify(doc))], {}, h.io, h.createClient)).toBe(1);
    expect(h.output.out).toBe('');
    expect(h.output.err.trimEnd().split('\n')).toEqual([
      'Policy rejected (422 MISSING_FIELD); nothing was changed:',
      '- auto.shoe must include lang (every handshake carries it)',
      '- write.shoe: merchants may write shoe_size only, not budget',
    ]);
  });

  it('reports shadow violations the same way', async () => {
    const h = owner(() => Response.json({ error: { code: 'MISSING_FIELD', message: 'v must be 1' } }, { status: 422 }));
    expect(await runCli(['policy', 'shadow', await policyFile(JSON.stringify({ ...doc, v: 2 }))], {}, h.io, h.createClient)).toBe(1);
    expect(h.output.err).toContain('\n- v must be 1\n');
  });

  it('passes an owner-only denial through for install', async () => {
    const h = owner(denied);
    expect(await runCli(['policy', 'set', await policyFile(JSON.stringify(doc))], {}, h.io, h.createClient)).toBe(1);
    expect(JSON.parse(h.output.err).error).toMatchObject({ status: 403, code: 'SCOPE_DENIED' });
  });

  it.each([
    ['missing', undefined, 'Unable to read the policy file.'],
    ['not JSON', 'secret-token {', 'The policy file is not valid JSON.'],
    ['not an object', '["lang"]', 'The policy file must hold a JSON object.'],
    ['too large', `{"v":1,"pad":"${'x'.repeat(70 * 1024)}"}`, 'The policy file is larger than 64 KB.'],
  ])('refuses a %s file locally without echoing it', async (_, content, message) => {
    const h = owner(() => Response.json(view));
    const path = content === undefined ? join(tmpdir(), 'agent-cookie-missing-policy.json') : await policyFile(content);
    for (const command of ['set', 'shadow']) {
      expect(await runCli(['policy', command, path], {}, h.io, h.createClient)).toBe(1);
    }
    expect(h.output.err.trimEnd().split('\n').map(line => JSON.parse(line).error.message)).toEqual([message, message]);
    expect(h.output.err).not.toContain('secret-token');
    expect(h.createClient).not.toHaveBeenCalled();
  });

  it('reports missing configuration for policy commands without leaking values', async () => {
    const h = owner(() => Response.json(view));
    expect(await runCli(['policy', 'show'], { AGENT_COOKIE_URL: 'http://127.0.0.1:4310' }, h.io)).toBe(1);
    expect(JSON.parse(h.output.err).error.message).toBe('Unable to read the policy. Check local configuration and workspace availability.');
  });
});
