import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_POLICY, policyId, policyViolations } from '@agent-cookie/contract';
import { WorkspaceClient, WorkspaceError, type PolicyDocument } from '../src/index.js';

const config = { baseUrl: 'http://127.0.0.1:4310', key: 'sample-owner-test-key' };
const at = '2026-10-17T20:00:00.000Z';
const search = { offers: 9, droppedAvoid: 1, droppedCurrency: 0, droppedUnavailable: 2, droppedShipsTo: 0, droppedBudget: 3,
  droppedInvalid: 0, eligible: 3, eligibleSellers: 2, picked: 2 };
const row = { intentId: 'sample-intent-1', createdAt: at, source: 'fixture', introduced: 2, quoted: 2, firstQuoteMs: 840,
  accepted: true, outcome: 'handoff', fieldsGranted: 6, fieldsRead: 2, purposeReleases: 1, search };
const bare = { intentId: 'sample-intent-2', createdAt: at, source: 'live', introduced: 1, quoted: 0, accepted: false,
  fieldsGranted: 6, fieldsRead: 0, purposeReleases: 0 };
const view = { policy: DEFAULT_POLICY, policyId: policyId(DEFAULT_POLICY), source: 'default' };
const stub = (...payloads: Array<[unknown, number?]>) => vi.fn<typeof fetch>(async () => {
  const [body, status] = payloads.shift() ?? [{}];
  return Response.json(body, { status: status ?? 200 });
});
const client = (fetcher: typeof fetch, sample?: boolean) => new WorkspaceClient({ ...config, fetch: fetcher, ...(sample ? { sample } : {}) });
const violations = 'auto.shoe must include lang (every handshake carries it); auto.shoe: payment_method may never be auto';

describe('owner funnel', () => {
  it('reads the report with an encoded query and keeps only contract row keys', async () => {
    const fetcher = stub([{ rows: [{ ...row, privateValue: '123 Example St', search: { ...search, extra: 1 } }, bare],
      sample: true, generatedAt: at, debug: 'excluded' }]);
    expect(await client(fetcher).getFunnel({ since: '2026-10-17T00:00:00+08:00', limit: 2 }))
      .toEqual({ rows: [row, bare], sample: true, generatedAt: at });
    expect(String(fetcher.mock.calls[0][0])).toBe(`${config.baseUrl}/owner/funnel?since=2026-10-17T00%3A00%3A00%2B08%3A00&limit=2`);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'GET', headers: { Authorization: `Bearer ${config.key}` } });
  });

  it('keeps a valid holdout arm and rejects an unknown one', async () => {
    expect((await client(stub([{ rows: [{ ...bare, arm: 'treatment' }], generatedAt: at }])).getFunnel()).rows).toEqual([{ ...bare, arm: 'treatment' }]);
    await expect(client(stub([{ rows: [{ ...bare, arm: 'both' }], generatedAt: at }])).getFunnel()).rejects.toThrow('Invalid funnel response');
  });

  it('omits the query when none is given and reports live data as not Sample', async () => {
    const fetcher = stub([{ rows: [], sample: false, generatedAt: at }]);
    expect(await client(fetcher).getFunnel()).toEqual({ rows: [], sample: false, generatedAt: at });
    expect(String(fetcher.mock.calls[0][0])).toBe(`${config.baseUrl}/owner/funnel`);
  });

  it.each([{ since: 'yesterday' }, { since: '' }, { limit: 0 }, { limit: 1.5 }, { limit: 1001 }, { limit: '5' as unknown as number }])
  ('refuses an invalid query before sending: %j', async query => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(client(fetcher).getFunnel(query)).rejects.toThrow('Invalid funnel query');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    {}, { rows: [row] }, { rows: [null], generatedAt: at }, { rows: [{ ...row, introduced: -1 }], generatedAt: at },
    { rows: [{ ...row, source: 'guess' }], generatedAt: at }, { rows: [{ ...row, outcome: 'paid' }], generatedAt: at },
    { rows: [{ ...row, accepted: 'yes' }], generatedAt: at }, { rows: [{ ...row, firstQuoteMs: 1.5 }], generatedAt: at },
    { rows: [{ ...row, search: { ...search, picked: undefined } }], generatedAt: at }, { rows: [{ ...row, intentId: 'a\nb' }], generatedAt: at },
  ])('rejects a malformed report instead of showing it', async payload => {
    await expect(client(stub([payload])).getFunnel()).rejects.toThrow('Invalid funnel response');
  });

  it('passes an owner-only denial through as a WorkspaceError without violations', async () => {
    const fetcher = stub([{ error: { code: 'SCOPE_DENIED', message: 'wrong role for this route' } }, 403]);
    const error = await client(fetcher).getFunnel().catch(e => e);
    expect(error).toBeInstanceOf(WorkspaceError);
    expect(error).toMatchObject({ status: 403, code: 'SCOPE_DENIED' });
    expect(error.violations).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('policy document', () => {
  it('reads the installed document, id and source, labelling Sample only when told', async () => {
    const fetcher = stub([{ ...view, extra: 'excluded' }], [{ ...view, source: 'installed', sample: true }]);
    expect(await client(fetcher).getPolicy()).toEqual({ ...view, sample: false });
    expect(await client(fetcher).getPolicy()).toEqual({ ...view, source: 'installed', sample: true });
    expect(String(fetcher.mock.calls[0][0])).toBe(`${config.baseUrl}/personal/policy`);
    expect(fetcher.mock.calls[0][1]?.method).toBe('GET');
  });

  it('accepts a document with or without the optional history section', async () => {
    expect(DEFAULT_POLICY.history).toEqual({ personal: true, assistant: false });
    const { history: _history, ...older } = structuredClone(DEFAULT_POLICY);
    const legacy = { policy: older, policyId: policyId(older), source: 'installed' };
    expect(await client(stub([legacy])).getPolicy()).toEqual({ ...legacy, sample: false });
  });

  it('labels the document Sample when the client is configured for demo data', async () => {
    expect(await client(stub([view]), true).getPolicy()).toMatchObject({ sample: true });
  });

  it.each([
    {}, { ...view, source: 'model' }, { ...view, policyId: '' }, { ...view, policy: { ...DEFAULT_POLICY, v: 2 } },
    { ...view, policy: { ...DEFAULT_POLICY, auto: { personal: [], shoe: [] } } },
    { ...view, policy: { ...DEFAULT_POLICY, auto: { ...DEFAULT_POLICY.auto, shoe: ['lang', 'ssn'] } } },
    { ...view, policy: { ...DEFAULT_POLICY, purpose: { ...DEFAULT_POLICY.purpose, shoe: { shipping_address: [] } } } },
    { ...view, policy: { ...DEFAULT_POLICY, ranking: { winRate: 101, failure: 0 } } },
    { ...view, policy: { ...DEFAULT_POLICY, notes: 'x' } },
    { ...view, policy: { ...DEFAULT_POLICY, history: { assistant: 'yes' } } },
    { ...view, policy: { ...DEFAULT_POLICY, history: { robot: true } } },
    { ...view, policy: { ...DEFAULT_POLICY, history: [true] } },
  ])('rejects a malformed policy view', async payload => {
    await expect(client(stub([payload])).getPolicy()).rejects.toThrow('Invalid policy response');
  });

  it('installs with PUT and returns the new view', async () => {
    const doc: PolicyDocument = { ...structuredClone(DEFAULT_POLICY), ranking: { winRate: 40, failure: 60 } };
    const installed = { policy: doc, policyId: policyId(doc), source: 'installed' };
    const fetcher = stub([installed]);
    expect(await client(fetcher).setPolicy(doc)).toEqual({ ...installed, sample: false });
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe(`${config.baseUrl}/personal/policy`);
    expect(init).toMatchObject({ method: 'PUT', redirect: 'manual', credentials: 'omit', headers: { 'Content-Type': 'application/json' } });
    expect(JSON.parse(String(init?.body))).toEqual(doc);
    expect(new Headers(init?.headers).has('Idempotency-Key')).toBe(false);
  });

  it('exposes every floor violation on a 422 without copying the message into the error text', async () => {
    const bad = { ...structuredClone(DEFAULT_POLICY), auto: { ...DEFAULT_POLICY.auto, shoe: ['tone', 'length', 'payment_method'] } };
    const fetcher = stub([{ error: { code: 'MISSING_FIELD', message: violations } }, 422]);
    const error = await client(fetcher).setPolicy(bad as PolicyDocument).catch(e => e);
    expect(error).toBeInstanceOf(WorkspaceError);
    expect(error).toMatchObject({ status: 422, code: 'MISSING_FIELD', message: 'A required field is missing.' });
    expect(error.violations).toEqual(['auto.shoe must include lang (every handshake carries it)', 'auto.shoe: payment_method may never be auto']);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('matches the violation format of the contract floor check', async () => {
    const bad = { ...structuredClone(DEFAULT_POLICY), write: { ...DEFAULT_POLICY.write, shoe: ['shoe_size', 'budget'] } };
    const expected = policyViolations(bad);
    const error = await client(stub([{ error: { code: 'MISSING_FIELD', message: expected.join('; ') } }, 422]))
      .setPolicy(bad as PolicyDocument).catch(e => e);
    expect(error.violations).toEqual(expected);
  });

  it('bounds and cleans violation text and tolerates a missing message', async () => {
    const noisy = `a\u001b[31m${'x'.repeat(400)}; ; second`;
    const first = await client(stub([{ error: { code: 'MISSING_FIELD', message: noisy } }, 422])).setPolicy(DEFAULT_POLICY).catch(e => e);
    expect(first.violations).toHaveLength(2);
    expect(first.violations[0]).not.toMatch(/[\u0000-\u001f]/);
    expect(Array.from(first.violations[0] as string).length).toBe(300);
    const second = await client(stub([{ error: { code: 'MISSING_FIELD' } }, 422])).setPolicy(DEFAULT_POLICY).catch(e => e);
    expect(second.violations).toEqual([]);
  });

  it('passes an owner-only denial through on install and shadow', async () => {
    const denied: [unknown, number] = [{ error: { code: 'SCOPE_DENIED', message: 'wrong role for this route' } }, 403];
    const fetcher = stub(denied, denied);
    for (const call of [(c: WorkspaceClient): Promise<unknown> => c.setPolicy(DEFAULT_POLICY),
      (c: WorkspaceClient): Promise<unknown> => c.shadowPolicy(DEFAULT_POLICY)]) {
      const error = await call(client(fetcher)).catch((e: WorkspaceError) => e) as WorkspaceError;
      expect(error).toBeInstanceOf(WorkspaceError);
      expect(error).toMatchObject({ status: 403, code: 'SCOPE_DENIED' });
      expect(error.violations).toBeUndefined();
    }
  });

  it('keeps upstream messages out of 422 errors on other routes', async () => {
    const error = await client(stub([{ error: { code: 'MISSING_FIELD', message: 'private 123 Example St' } }, 422])).getMyCard().catch((e: WorkspaceError) => e) as WorkspaceError;
    expect(error).toMatchObject({ status: 422, code: 'MISSING_FIELD' });
    expect(error.violations).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain('Example');
  });

  it.each([null, [], 'policy'])('refuses a non-object document before sending: %j', async doc => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(client(fetcher).setPolicy(doc as unknown as PolicyDocument)).rejects.toThrow('Invalid policy document');
    await expect(client(fetcher).shadowPolicy(doc as unknown as PolicyDocument)).rejects.toThrow('Invalid policy document');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('policy shadow', () => {
  const report = { candidateId: 'c4ndidate000', currentId: policyId(DEFAULT_POLICY), unchanged: 7, changed: [
    { ref: 'r-1', kind: 'receipt', field: 'shipping_address', before: 'allow', after: 'PURPOSE_MISMATCH' },
    { ref: 'e-2', kind: 'read', field: 'budget', before: 'allow', after: 'SCOPE_DENIED' },
  ] };

  it('posts the candidate wrapped as { policy } and returns ids, names and codes only', async () => {
    const fetcher = stub([{ ...report, changed: report.changed.map(c => ({ ...c, value: 'excluded' })), sample: true }]);
    expect(await client(fetcher).shadowPolicy(DEFAULT_POLICY)).toEqual({ ...report, sample: true });
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe(`${config.baseUrl}/personal/policy/shadow`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ policy: DEFAULT_POLICY });
  });

  it.each([
    {}, { ...report, unchanged: -1 }, { ...report, candidateId: '' }, { ...report, changed: [{ ...report.changed[0], kind: 'guess' }] },
    { ...report, changed: [{ ...report.changed[0], field: 'ssn' }] }, { ...report, changed: [{ ...report.changed[0], after: 'maybe' }] },
  ])('rejects a malformed report', async payload => {
    await expect(client(stub([payload])).shadowPolicy(DEFAULT_POLICY)).rejects.toThrow('Invalid policy shadow response');
  });

  it('exposes violations for an invalid candidate', async () => {
    const error = await client(stub([{ error: { code: 'MISSING_FIELD', message: violations } }, 422])).shadowPolicy(DEFAULT_POLICY).catch(e => e);
    expect(error).toMatchObject({ status: 422, code: 'MISSING_FIELD' });
    expect(error.violations).toHaveLength(2);
  });
});

describe('additive grant and receipt keys', () => {
  const grant = { id: 'g', sessionId: 's', agentId: 'merchant', agentName: 'Sample merchant', fields: ['lang'],
    purpose: 'handshake', createdAt: at, expiresAt: at, remainingMs: 0, status: 'expired' };
  const receipt = { id: 'r', sessionId: 's', agentId: 'merchant', fields: ['shipping_address'], purpose: 'checkout', createdAt: at };

  it('accepts and returns policyId, stage and intentId for display', async () => {
    const grants = [grant, { ...grant, id: 'g2', policyId: 'abcdef012345', stage: 'introduced' }, { ...grant, id: 'g3', stage: 'checkout' }];
    const receipts = [receipt, { ...receipt, id: 'r2', intentId: 'intent-1', policyId: 'abcdef012345' }];
    const fetcher = stub([{ grants }], [{ receipts }]);
    expect((await client(fetcher).getGrants()).grants).toEqual(grants);
    expect((await client(fetcher).getReceipts()).receipts).toEqual(receipts);
  });

  it.each([{ stage: 'shipped' }, { stage: null }, { policyId: 7 }, { policyId: '' }])('rejects a grant with a malformed additive key %j', async extra => {
    await expect(client(stub([{ grants: [{ ...grant, ...extra }] }])).getGrants()).rejects.toThrow('Invalid grants response');
  });

  it.each([{ intentId: 7 }, { intentId: '' }, { policyId: null }])('rejects a receipt with a malformed additive key %j', async extra => {
    await expect(client(stub([{ receipts: [{ ...receipt, ...extra }] }])).getReceipts()).rejects.toThrow('Invalid receipts response');
  });
});
