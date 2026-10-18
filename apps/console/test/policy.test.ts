import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type * as Contract from '../../../packages/contract/src/policy-document';
import type * as ContractPolicy from '../../../packages/contract/src/policy';
import { DEFAULT_POLICY, policyHistory, policyViolations } from '../../../packages/contract/src/policy-document';
import { createLiveAdapter, createSampleAdapter } from '../src/adapters';
import { ConsoleController } from '../src/controller';
import type { ConsoleSnapshot } from '../src/model';
import { historyReadable, normalizePolicyView, parseViolations, PolicyViolationError, samplePolicyView, type PolicyDocument, type PolicyView, type ReadDecision,
  type ShadowReport } from '../src/policy';
import { PolicyPanel, PolicyResultView } from '../src/PolicyPanel';

// Compile-time (pnpm typecheck): the console's browser-safe mirrors equal the contract types in both directions.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const mirrors: [Same<PolicyDocument, Contract.PolicyDocument>, Same<PolicyView, Contract.PolicyView>,
  Same<ShadowReport, Contract.ShadowReport>, Same<ReadDecision, ContractPolicy.ReadDecision>] = [true, true, true, true];

const at = Date.parse('2026-10-17T20:00:00.000Z');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const view: PolicyView = { policy: structuredClone(DEFAULT_POLICY), policyId: 'a1b2c3d4e5f6', source: 'installed' };
const core = (path: string) => path.endsWith('/me') ? json({ role: 'owner' })
  : path.endsWith('/personal/card') ? json({ card: [], candidates: [], superseded: [] })
  : path.endsWith('/personal/grants') ? json({ grants: [] }) : path.endsWith('/owner/activity') ? json({ events: [] })
  : path.endsWith('/personal/learned') ? json({ error: { code: 'NOT_FOUND' } }, 404) : undefined;
const panel = (props: Partial<Parameters<typeof PolicyPanel>[0]>) => renderToStaticMarkup(createElement(PolicyPanel, {
  state: { availability: 'ready', data: view }, sample: false, disabled: false, shadow: () => {}, install: () => {}, ...props }));
// A candidate that breaks the floor in three ways (see packages/contract/src/policy-document.ts).
const broken = { ...structuredClone(DEFAULT_POLICY), auto: { ...DEFAULT_POLICY.auto, shoe: ['shoe_size', 'payment_method'] },
  write: { ...DEFAULT_POLICY.write, retail: ['shoe_size', 'budget'] } };

describe('policy panel', () => {
  it('Sample policy has exactly the contract DEFAULT_POLICY shape and a placeholder id', () => {
    const sample = samplePolicyView();
    expect(sample.policy).toEqual(DEFAULT_POLICY);
    expect(sample).toMatchObject({ policyId: 'sample-policy', source: 'default' });
  });

  it('renders from the Sample adapter: id, source, per-category table, Sample label, actions off', async () => {
    const network = vi.spyOn(globalThis, 'fetch');
    const snapshot = await createSampleAdapter(() => at).load();
    expect(snapshot.policy).toMatchObject({ availability: 'ready', sample: true });
    const html = panel({ state: snapshot.policy, sample: true });
    for (const text of ['Sample · access checked by purpose', '<code>sample-policy</code> (sample placeholder)', 'Default (default)',
      'Built-in v1 field policy', 'Personal agent', 'Shoe store', 'Retail · UCP store', '<code class="field-key">pref.avoid</code>',
      '<code class="field-key">shipping_address</code> only for <span><code>checkout</code></span>',
      '<code class="field-key">payment_method</code> only for <span><code>payment</code></span>', 'Default: merchant',
      'data-label="Automatic"', 'data-label="By purpose"', 'data-label="Writable"', 'Connect to a workspace to preview or install a policy',
      '<th scope="row">Connected assistant <code class="field-key">assistant</code></th>']) expect(html).toContain(text);
    // Header row plus one row per category: personal, shoe, retail, assistant.
    expect(html.match(/<tr>/gu)).toHaveLength(5);
    expect(html).toMatch(/<button type="button" disabled="">Policy preview<\/button>/u);
    expect(html).toMatch(/<button type="button" class="primary" disabled="">Install<\/button>/u);
    expect(html).toContain('<button type="button">Use current policy</button>');
    await expect(createSampleAdapter().shadowPolicy({})).rejects.toThrow('Connect to a workspace');
    await expect(createSampleAdapter().installPolicy({})).rejects.toThrow('Connect to a workspace');
    expect(network).not.toHaveBeenCalled();
    network.mockRestore();
  });

  it('shows the assistant category row like the others: its auto fields, no purpose field, its writes', () => {
    const html = panel({});
    const row = html.slice(html.indexOf('<th scope="row">Connected assistant'), html.indexOf('</tr>', html.indexOf('<th scope="row">Connected assistant')));
    const fieldList = (fields: readonly string[]) => `<ul class="policy-fields">${fields.map((field) => `<li><code class="field-key">${field}</code></li>`).join('')}</ul>`;
    expect(row).toContain(`<td data-label="Automatic">${fieldList(DEFAULT_POLICY.auto.assistant)}</td>`);
    expect(row).toContain('<td data-label="By purpose"><span class="muted">None</span></td>');
    expect(row).toContain(`<td data-label="Writable">${fieldList(DEFAULT_POLICY.write.assistant)}</td>`);
    for (const field of ['shipping_address', 'payment_method']) expect(row).not.toContain(field);
    expect(html.indexOf('Retail · UCP store')).toBeLessThan(html.indexOf('Connected assistant'));
  });

  it('labels each source, shows ranking weights when present, and enables actions when live', () => {
    const ranked = panel({ state: { availability: 'ready', data: { ...view, policy: { ...view.policy, ranking: { winRate: 30, failure: 70 } } } } });
    expect(ranked).toContain('winRate 30 · failure 70');
    expect(ranked).toContain('Installed (installed)');
    expect(ranked).toContain('stored in the workspace database');
    expect(ranked).not.toContain('Sample');
    expect(ranked).toContain('<button type="button">Policy preview</button>');
    expect(ranked).toContain('<button type="button" class="primary">Install</button>');
    expect(panel({ state: { availability: 'ready', data: { ...view, source: 'repo' } } })).toContain('POLICY.yaml');
    expect(panel({ state: { availability: 'ready', data: view, sample: true } })).toContain('Sample · access checked by purpose');
    expect(panel({ state: { availability: 'unavailable', message: 'The workspace does not support Policy yet. Other panels remain available.' } }))
      .toContain('does not support Policy yet');
    expect(panel({ disabled: true })).toMatch(/disabled="">Policy preview/u);
  });
});

describe('policy actions through the live adapter', () => {
  it('a 422 from PUT lists every floor violation and leaves the installed document unchanged', async () => {
    const message = policyViolations(broken).join('; ');
    const violations = policyViolations(broken);
    expect(violations.length).toBeGreaterThanOrEqual(3);
    const puts: RequestInit[] = [];
    const live = createLiveAdapter(async (path, options) => {
      if (path === '/workspace-api/personal/policy' && options.method === 'PUT') {
        puts.push(options);
        return json({ error: { code: 'MISSING_FIELD', message } }, 422);
      }
      return core(path) ?? (path.endsWith('/personal/policy') ? json(view) : json({ rows: [], sample: true, generatedAt: new Date(at).toISOString() }));
    }, () => at);
    await expect(live.installPolicy(broken)).rejects.toBeInstanceOf(PolicyViolationError);
    const controller = new ConsoleController(live);
    await controller.refresh();
    const before = controller.getState().data;
    await controller.installPolicy(JSON.stringify(broken, null, 2));
    expect(JSON.parse(String(puts[1].body))).toEqual(broken);
    expect(controller.getState().policyResult).toEqual({ kind: 'violations', action: 'Install', violations });
    expect(controller.getState().data).toBe(before);
    expect(controller.getState().error).toContain('Install policy was not confirmed');
    const html = renderToStaticMarkup(createElement(PolicyResultView, { result: controller.getState().policyResult }));
    expect(html).toContain('Installation rejected. The current policy is unchanged.');
    for (const line of violations) expect(html).toContain(`<li>${line}</li>`);
    expect(html.match(/<li>/gu)).toHaveLength(violations.length);
  });

  it('shows only the error code for other failures and never a server message', async () => {
    const live = createLiveAdapter(async () => json({ error: { code: 'SCOPE_DENIED', message: 'secret-key; 42' } }, 403));
    const failure = live.installPolicy(DEFAULT_POLICY);
    await expect(failure).rejects.toThrow('403 SCOPE_DENIED');
    await expect(live.shadowPolicy(DEFAULT_POLICY)).rejects.not.toThrow('secret-key');
    const notPolicy = createLiveAdapter(async () => json({ error: { code: 'MISSING_FIELD', message: 'a; b' } }, 422));
    await expect(notPolicy.reset()).rejects.not.toBeInstanceOf(PolicyViolationError);
    expect(parseViolations('x; \u0007y;  ; z')).toEqual(['x', 'y', 'z']);
  });

  it('shadow posts { policy }, renders "ref · kind · field: before → after" and the unchanged count, without reloading', async () => {
    const report: ShadowReport = { candidateId: '0f0f0f0f0f0f', currentId: 'a1b2c3d4e5f6', unchanged: 7, changed: [
      { ref: 'rcpt-1', kind: 'receipt', field: 'shipping_address', before: 'allow', after: 'PURPOSE_MISMATCH' },
      { ref: 'evt-9', kind: 'read', field: 'budget', before: 'allow', after: 'SCOPE_DENIED' },
    ] };
    const posts: Array<{ path: string; body: unknown }> = [];
    let loads = 0;
    const live = createLiveAdapter(async (path, options) => {
      if (options.method === 'POST') { posts.push({ path, body: JSON.parse(String(options.body)) }); return json(report); }
      if (path.endsWith('/me')) loads++;
      return core(path) ?? (path.endsWith('/personal/policy') ? json(view) : json({ rows: [], sample: false, generatedAt: new Date(at).toISOString() }));
    }, () => at);
    const controller = new ConsoleController(live);
    await controller.refresh();
    const candidate = { ...DEFAULT_POLICY, ranking: { winRate: 10, failure: 10 } };
    await controller.shadowPolicy(JSON.stringify(candidate));
    expect(posts).toEqual([{ path: '/workspace-api/personal/policy/shadow', body: { policy: candidate } }]);
    expect(loads).toBe(1);
    expect(controller.getState().policyResult).toEqual({ kind: 'shadow', report });
    expect(controller.getState().notice).toContain('Policy preview completed');
    const html = renderToStaticMarkup(createElement(PolicyResultView, { result: controller.getState().policyResult }));
    expect(html).toContain('2 decisions would change; 7 would stay the same');
    expect(html).toContain('<li><code>rcpt-1</code> · receipt · <code>shipping_address</code>: allow → PURPOSE_MISMATCH</li>');
    expect(html).toContain('<li><code>evt-9</code> · read · <code>budget</code>: allow → SCOPE_DENIED</li>');
    expect(html).toContain('PURPOSE_MISMATCH = Purpose mismatch');
  });

  it('a shadow 422 lists violations too, and invalid JSON never leaves the page', async () => {
    const fetcher = vi.fn(async (path: string, options: RequestInit) => options.method === 'POST'
      ? json({ error: { code: 'MISSING_FIELD', message: policyViolations({ v: 2 }).join('; ') } }, 422)
      : core(path) ?? json(view));
    const controller = new ConsoleController(createLiveAdapter(fetcher, () => at));
    for (const [text, message] of [['', 'Paste a candidate'], ['{"v":', 'not valid JSON'], ['[1]', 'must be a JSON object']]) {
      await controller.shadowPolicy(text);
      expect(controller.getState().policyResult).toEqual({ kind: 'invalid', message: expect.stringContaining(message) });
      await controller.installPolicy(text);
      expect(controller.getState().policyResult).toMatchObject({ kind: 'invalid' });
    }
    expect(fetcher).not.toHaveBeenCalled();
    await controller.shadowPolicy('{"v":2}');
    expect(controller.getState().policyResult).toEqual({ kind: 'violations', action: 'Policy preview', violations: policyViolations({ v: 2 }) });
    expect(renderToStaticMarkup(createElement(PolicyResultView, { result: controller.getState().policyResult })))
      .toContain('Policy preview rejected');
  });

  it('a successful install reports the new id and reloads the snapshot', async () => {
    let installed: PolicyView = view;
    const candidate = { ...DEFAULT_POLICY, ranking: { winRate: 20, failure: 40 } };
    const live = createLiveAdapter(async (path, options) => {
      if (options.method === 'PUT') { installed = { policy: JSON.parse(String(options.body)), policyId: 'bbbbbbbbbbbb', source: 'installed' }; return json(installed); }
      return core(path) ?? (path.endsWith('/personal/policy') ? json(installed) : json({ rows: [], sample: false, generatedAt: new Date(at).toISOString() }));
    }, () => at);
    const controller = new ConsoleController(live);
    await controller.installPolicy(JSON.stringify(candidate));
    expect(controller.getState().policyResult).toEqual({ kind: 'installed', policyId: 'bbbbbbbbbbbb' });
    const policy = (controller.getState().data as ConsoleSnapshot).policy;
    expect(policy).toEqual({ availability: 'ready', data: { policy: candidate, policyId: 'bbbbbbbbbbbb', source: 'installed' } });
    expect(renderToStaticMarkup(createElement(PolicyResultView, { result: controller.getState().policyResult })))
      .toContain('Installed policy <code>bbbbbbbbbbbb</code>');
  });

  it('degrades to an unavailable or error section without blocking the card', async () => {
    const missing = createLiveAdapter(async (path) => core(path) ?? json({ error: { code: 'NOT_FOUND' } }, 404), () => at);
    expect((await missing.load()).policy).toEqual({ availability: 'unavailable', message: expect.stringContaining('Policy') });
    const bad = createLiveAdapter(async (path) => core(path) ?? (path.endsWith('/personal/policy')
      ? json({ ...view, policy: { ...view.policy, v: 2 } }) : json({ error: { code: 'NOT_FOUND' } }, 404)), () => at);
    const snapshot = await bad.load();
    expect(snapshot.policy).toEqual({ availability: 'error', message: expect.stringContaining('Policy data does not match') });
    expect(snapshot.card.card).toEqual([]);
  });
});

describe('policy panel: history (Phase 4)', () => {
  const cells = (html: string) => [...html.matchAll(/<td data-label="History">(.*?)<\/td>/gu)].map((match) => match[1]);
  const NOTE = 'History access covers intents and purchases. Personal agents can read it; merchants cannot. Connected assistants need your permission. Every read creates a receipt.';

  it('Sample policy carries the default history switches', () => {
    expect(samplePolicyView().policy.history).toEqual({ personal: true, assistant: false });
  });

  it('renders a History column for the default: personal Allowed, merchants and the assistant Not allowed, plus the note', () => {
    const html = panel({});
    expect(html).toContain('<th scope="col">History</th>');
    expect(cells(html)).toEqual(['Allowed', '<span class="muted">Not allowed</span>', '<span class="muted">Not allowed</span>', '<span class="muted">Not allowed</span>']);
    expect(html).toContain(NOTE);
    expect(html.match(/<tr>/gu)).toHaveLength(5);
  });

  it('shows the assistant as Allowed once history.assistant is true; merchants stay Not allowed whatever the document says', () => {
    const on: PolicyView = { ...view, policy: { ...structuredClone(DEFAULT_POLICY), history: { personal: true, assistant: true } } };
    expect(cells(panel({ state: { availability: 'ready', data: on } })))
      .toEqual(['Allowed', '<span class="muted">Not allowed</span>', '<span class="muted">Not allowed</span>', 'Allowed']);
    // A floor-breaking or absent section is shown with the contract's evaluator semantics, never as written.
    const odd: PolicyView = { ...view, policy: { ...structuredClone(DEFAULT_POLICY), history: { personal: false, shoe: true, retail: true } } };
    expect(cells(panel({ state: { availability: 'ready', data: odd } })))
      .toEqual(['Allowed', '<span class="muted">Not allowed</span>', '<span class="muted">Not allowed</span>', '<span class="muted">Not allowed</span>']);
    const { history: _history, ...older } = structuredClone(DEFAULT_POLICY);
    expect(cells(panel({ state: { availability: 'ready', data: { ...view, policy: older } } })))
      .toEqual(['Allowed', '<span class="muted">Not allowed</span>', '<span class="muted">Not allowed</span>', '<span class="muted">Not allowed</span>']);
  });

  it('historyReadable matches the contract policyHistory for every category and document shape', () => {
    const docs = [DEFAULT_POLICY, { ...DEFAULT_POLICY, history: { personal: true, assistant: true } },
      { ...DEFAULT_POLICY, history: { personal: false, shoe: true, retail: true, assistant: false } }, { ...DEFAULT_POLICY, history: undefined }];
    for (const doc of docs) for (const category of ['personal', 'shoe', 'retail', 'assistant'] as const) {
      expect(historyReadable(doc as PolicyDocument, category)).toBe(policyHistory(doc, category));
    }
  });

  it('normalizePolicyView keeps a boolean history per known category and rejects anything else as malformed', () => {
    const body = (history: unknown) => ({ policyId: 'a1b2c3d4e5f6', source: 'installed',
      policy: { ...structuredClone(DEFAULT_POLICY), history } });
    expect(normalizePolicyView(body({ personal: true, assistant: true })).policy.history).toEqual({ personal: true, assistant: true });
    expect(normalizePolicyView(body({ personal: true, assistant: false })).policy).toEqual(DEFAULT_POLICY);
    expect(normalizePolicyView(body({})).policy.history).toEqual({});
    const { history: _history, ...older } = structuredClone(DEFAULT_POLICY);
    const olderView = normalizePolicyView({ policyId: '3526a909e404', source: 'repo', policy: older });
    expect(Object.hasOwn(olderView.policy, 'history')).toBe(false);
    for (const bad of [{ assistant: 'true' }, { assistant: 1 }, { assistant: null }, { company: true }, [], 'personal', null, true]) {
      expect(() => normalizePolicyView(body(bad))).toThrow('Policy data does not match the workspace contract.');
    }
  });
});
