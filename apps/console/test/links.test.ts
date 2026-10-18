import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import agents from '../../../fixtures/agents.json';
import { LINK_TTL_MS, type Link } from '../../../packages/contract/src/types';
import { createLiveAdapter, createSampleAdapter } from '../src/adapters';
import { ConsoleController } from '../src/controller';
import { LinksPanel } from '../src/LinksPanel';
import { isDecisionAck, LinkNotPendingError, normalizeLinks, orderLinks, SAMPLE_ASSISTANT, SAMPLE_LINK_ID, type LinkList } from '../src/links';
import type { Section } from '../src/model';

const at = Date.parse('2026-10-18T09:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
afterEach(() => { vi.restoreAllMocks(); });

const link = (over: Partial<Link> = {}): Link => ({ id: 'l_0123456789ab', agentId: 'a_assist', agentName: 'Acme Assistant', status: 'pending',
  createdAt: iso(at), expiresAt: iso(at + LINK_TTL_MS), ...over });
const core = (path: string) => path.endsWith('/me') ? json({ role: 'owner' })
  : path.endsWith('/personal/card') ? json({ card: [], candidates: [], superseded: [] })
  : path.endsWith('/personal/grants') ? json({ grants: [] }) : path.endsWith('/owner/activity') ? json({ events: [] }) : undefined;
const panel = (props: Partial<Parameters<typeof LinksPanel>[0]>) => renderToStaticMarkup(createElement(LinksPanel, {
  state: undefined, sample: false, blocked: false, handled: [], decide: () => {}, ...props }));
const ready = (links: Link[], sample?: boolean): Section<LinkList> => ({ availability: 'ready', data: { links }, ...(sample ? { sample } : {}) });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('consent links: Sample mode', () => {
  it('starts with one pending link from the Sample assistant in fixtures/agents.json, ten minutes long', async () => {
    const network = vi.spyOn(globalThis, 'fetch');
    const fixture = agents.find((agent) => agent.category === 'assistant');
    expect(fixture).toMatchObject({ agentId: SAMPLE_ASSISTANT.agentId, name: SAMPLE_ASSISTANT.agentName });
    const snapshot = await createSampleAdapter(() => at).load();
    expect(snapshot.links).toEqual(ready([{ id: SAMPLE_LINK_ID, agentId: 'sample-assistant', agentName: 'Sample · Assistant',
      status: 'pending', createdAt: iso(at), expiresAt: iso(at + LINK_TTL_MS) }], true));
    const html = panel({ state: snapshot.links, sample: true });
    for (const text of ['<h2 id="links-title" tabindex="-1">连接请求</h2>', 'Sample · 公司助理申请连接，由你批准', '1 条待批准，共 1 条。',
      '<h3>Sample · Assistant</h3>', '<p class="muted small">sample-assistant</p>', '<code title="sample-link-assistant">…ssistant</code>',
      '<span class="link-status ">待批准</span>', '<dt>处理时间</dt><dd>尚未处理</dd>', 'aria-label="批准 Sample · Assistant 的连接请求">批准</button>',
      'aria-label="拒绝 Sample · Assistant 的连接请求">拒绝</button>', 'Sample 数据：批准或拒绝只改变本页', '30 天的授权', '10 分钟后过期',
      '永远读不到收货地址和支付方式']) expect(html).toContain(text);
    expect(network).not.toHaveBeenCalled();
  });

  it('approve changes only page state after the adapter answers; a second decision reads 已处理; reset restores the pending link', async () => {
    const network = vi.spyOn(globalThis, 'fetch');
    let now = at;
    const controller = new ConsoleController(createSampleAdapter(() => now));
    await controller.refresh();
    now += 60_000;
    await controller.decideLink(SAMPLE_LINK_ID, 'approve');
    let state = controller.getState();
    expect(state.data!.links).toEqual(ready([expect.objectContaining({ id: SAMPLE_LINK_ID, status: 'approved', decidedAt: iso(at + 60_000) })], true));
    expect(state.notice).toBe('Sample · 仅本页：批准连接请求完成。');
    expect(state.error).toBe('');
    expect(state.data!.events[0]).toMatchObject({ event: '批准连接请求', object: SAMPLE_LINK_ID, actor: 'Sample · 本地控制台' });
    expect(state.data!.grants.map((grant) => grant.agentId)).not.toContain('sample-assistant');
    const approved = panel({ state: state.data!.links, sample: true, handled: state.handledLinks });
    expect(approved).toContain('<span class="link-status inactive">已批准</span>');
    expect(approved).toContain('0 条待批准，共 1 条。');
    expect(approved).not.toContain('>批准</button>');

    await controller.decideLink(SAMPLE_LINK_ID, 'decline');
    state = controller.getState();
    expect(state.notice).toBe('Sample · 这条连接请求已处理：它已被批准、拒绝或已过期，这次没有更改。');
    expect(state.error).toBe('');
    expect(state.handledLinks).toEqual([SAMPLE_LINK_ID]);
    expect((state.data!.links as { data: LinkList }).data.links[0].status).toBe('approved');
    expect(panel({ state: state.data!.links, sample: true, handled: state.handledLinks })).toContain('已批准 · 已处理');

    await controller.reset();
    state = controller.getState();
    expect(state.handledLinks).toEqual([]);
    expect((state.data!.links as { data: LinkList }).data.links).toEqual([expect.objectContaining({ status: 'pending' })]);
    expect(network).not.toHaveBeenCalled();
  });

  it('decline records the decision; a link past its ten minutes reads expired and cannot be approved', async () => {
    let now = at;
    const sample = createSampleAdapter(() => now);
    await sample.decideLink(SAMPLE_LINK_ID, 'decline');
    expect((await sample.load()).links).toEqual(ready([expect.objectContaining({ status: 'declined', decidedAt: iso(at) })], true));
    await expect(sample.decideLink('unknown', 'approve')).rejects.toThrow('Sample 连接请求不存在');
    await sample.reset();
    now += LINK_TTL_MS;
    const expired = (await sample.load()).links!;
    expect(expired).toEqual(ready([expect.objectContaining({ status: 'expired' })], true));
    expect(expired.availability === 'ready' ? expired.data.links[0].decidedAt : 'not ready').toBeUndefined();
    await expect(sample.decideLink(SAMPLE_LINK_ID, 'approve')).rejects.toBeInstanceOf(LinkNotPendingError);
    const html = panel({ state: expired, sample: true });
    expect(html).toContain('<span class="link-status inactive">已过期</span>');
    expect(html).toContain('<dt>处理时间</dt><dd>未处理，已过期</dd>');
    expect(html).not.toContain('</button>');
  });
});

describe('consent links: live adapter and controller', () => {
  it('reads GET /owner/links into its own section, keeping only contract keys; 404 is unavailable and malformed is an error', async () => {
    const rows = [{ ...link(), value: 'secret-address' }, link({ id: 'l_2', status: 'approved', decidedAt: iso(at + 1000), sessionId: 's_2' })];
    const paths: string[] = [];
    const live = createLiveAdapter(async (path) => { paths.push(path); return core(path)
      ?? (path.endsWith('/owner/links') ? json({ links: rows, extra: 'secret-extra' }) : json({ error: { code: 'NOT_FOUND' } }, 404)); }, () => at);
    const snapshot = await live.load();
    expect(paths).toContain('/workspace-api/owner/links');
    expect(snapshot.links).toEqual(ready([link(), link({ id: 'l_2', status: 'approved', decidedAt: iso(at + 1000), sessionId: 's_2' })]));
    expect(JSON.stringify(snapshot.links)).not.toContain('secret');

    const missing = await createLiveAdapter(async (path) => core(path) ?? json({ error: { code: 'NOT_FOUND' } }, 404), () => at).load();
    expect(missing.links).toEqual({ availability: 'unavailable', message: '工作台尚未提供连接请求接口。其他面板可继续使用。' });
    expect(panel({ state: missing.links })).toContain('工作台尚未提供连接请求接口');
    for (const bad of [{ links: [{ ...link(), status: 'maybe' }] }, { links: [{ ...link(), createdAt: 'yesterday' }] }, { links: {} }, [link()]]) {
      const snapshot = await createLiveAdapter(async (path) => core(path)
        ?? (path.endsWith('/owner/links') ? json(bad) : json({ error: { code: 'NOT_FOUND' } }, 404)), () => at).load();
      expect(snapshot.links).toEqual({ availability: 'error', message: expect.stringContaining('连接请求响应格式') });
      expect(snapshot.card.card).toEqual([]);
    }
    expect(normalizeLinks({ links: [], sample: true })).toEqual({ links: [], sample: true });
  });

  it('approve POSTs the exact path with no body, and the row changes only after the acknowledgement and reload', async () => {
    let current = [link()];
    const answer = deferred<Response>();
    const posts: Array<{ path: string; options: RequestInit }> = [];
    const live = createLiveAdapter(async (path, options) => {
      if (options.method === 'POST') { posts.push({ path, options }); return answer.promise; }
      return core(path) ?? (path.endsWith('/owner/links') ? json({ links: current }) : json({ error: { code: 'NOT_FOUND' } }, 404));
    }, () => at);
    const controller = new ConsoleController(live);
    await controller.refresh();
    const flight = controller.decideLink('l_0123456789ab', 'approve');
    await Promise.resolve();
    expect(posts).toHaveLength(1);
    expect(posts[0].path).toBe('/workspace-api/owner/links/l_0123456789ab/approve');
    expect(posts[0].options.body).toBeUndefined();
    expect(posts[0].options.headers).toEqual({ 'X-Agent-Cookie-Console': '1' });
    // In flight: the action is pending, the row is still pending, and both buttons are disabled.
    let state = controller.getState();
    expect(state.pending).toBe('批准连接请求');
    expect(state.notice).toBe('');
    const during = panel({ state: state.data!.links, blocked: !!state.pending, handled: state.handledLinks });
    expect(during).toContain('<span class="link-status ">待批准</span>');
    expect(during).not.toContain('已批准');
    expect(during).toContain('<button type="button" class="primary" disabled=""');
    expect(during).toContain('<button type="button" class="danger" disabled=""');

    current = [link({ status: 'approved', decidedAt: iso(at + 5000), sessionId: 's_new' })];
    answer.resolve(json(current[0]));
    await flight;
    state = controller.getState();
    expect(state.pending).toBe('');
    expect(state.error).toBe('');
    expect(state.notice).toBe('工作台已确认：批准连接请求完成。');
    expect(state.data!.links).toEqual(ready(current));
    const after = panel({ state: state.data!.links, handled: state.handledLinks });
    expect(after).toContain('<span class="link-status inactive">已批准</span>');
    expect(after).not.toContain('Sample');
    expect(after).toContain('按钮只在工作台确认后才改变这一行。');
  });

  it('decline POSTs its own path; an acknowledgement that is not the decided link is not a success', async () => {
    const posted: string[] = [];
    const replies = [json(link({ status: 'declined', decidedAt: iso(at) })), json(link()), json(link({ id: 'l_other', status: 'declined' })),
      json({ ok: true }), json(link({ status: 'approved' }))];
    const live = createLiveAdapter(async (path, options) => {
      if (options.method === 'POST') { posted.push(path); return replies.shift()!; }
      return core(path) ?? (path.endsWith('/owner/links') ? json({ links: [link()] }) : json({ error: { code: 'NOT_FOUND' } }, 404));
    }, () => at);
    await live.decideLink('l_0123456789ab', 'decline');
    expect(posted).toEqual(['/workspace-api/owner/links/l_0123456789ab/decline']);
    const controller = new ConsoleController(live);
    await controller.refresh();
    const before = controller.getState().data;
    for (let i = 0; i < 4; i++) {
      await controller.decideLink('l_0123456789ab', 'decline');
      expect(controller.getState().data).toBe(before);
      expect(controller.getState().notice).toBe('');
      expect(controller.getState().error).toContain('拒绝连接请求未确认成功');
      expect(controller.getState().handledLinks).toEqual([]);
    }
    await live.decideLink('a/b c', 'approve').catch(() => {});
    expect(posted.at(-1)).toBe('/workspace-api/owner/links/a%2Fb%20c/approve');
    expect(isDecisionAck(link({ status: 'approved', sessionId: 's_1' }), 'l_0123456789ab', 'approve')).toBe(true);
    expect(isDecisionAck(link({ status: 'approved', sessionId: 's_1' }), 'l_0123456789ab', 'decline')).toBe(false);
    // An approval that names no pairwise session is not an approval.
    expect(isDecisionAck(link({ status: 'approved' }), 'l_0123456789ab', 'approve')).toBe(false);
    expect(isDecisionAck({ ...link({ status: 'declined' }), sample: false }, 'l_0123456789ab', 'decline')).toBe(true);
  });

  it('a 409 reads 已处理: no error, the snapshot reloads, and that row loses its buttons even while the list still says pending', async () => {
    const replies = [json({ error: { code: 'LINK_NOT_PENDING', message: 'secret-key' } }, 409), json({ error: { code: 'SCOPE_DENIED' } }, 403)];
    let loads = 0;
    const live = createLiveAdapter(async (path, options) => {
      if (options.method === 'POST') return replies.shift()!;
      if (path.endsWith('/me')) loads++;
      return core(path) ?? (path.endsWith('/owner/links') ? json({ links: [link(), link({ id: 'l_2', createdAt: iso(at - 1000) })] })
        : json({ error: { code: 'NOT_FOUND' } }, 404));
    }, () => at);
    const controller = new ConsoleController(live);
    await controller.refresh();
    await controller.decideLink('l_0123456789ab', 'approve');
    let state = controller.getState();
    expect(loads).toBe(2);
    expect(state.error).toBe('');
    expect(state.notice).toBe('这条连接请求已处理：它已被批准、拒绝或已过期，这次没有更改。');
    expect(state.notice).not.toContain('secret');
    expect(state.handledLinks).toEqual(['l_0123456789ab']);
    const html = panel({ state: state.data!.links, handled: state.handledLinks });
    expect(html).toContain('<span class="link-status inactive">已处理</span>');
    expect(html).toContain('1 条待批准，共 2 条。');
    expect(html.match(/>批准<\/button>/gu)).toHaveLength(1);
    expect(html).toContain('aria-label="批准 Acme Assistant 的连接请求"');
    // Any other refusal is an unconfirmed action, never 已处理.
    await controller.decideLink('l_2', 'approve');
    state = controller.getState();
    expect(state.error).toContain('批准连接请求未确认成功');
    expect(state.error).toContain('403 SCOPE_DENIED');
    expect(state.handledLinks).toEqual(['l_0123456789ab']);
  });
});

describe('consent links panel', () => {
  it('orders pending first, then newest first; shows decided times; empty and unconnected states; names, ids and times only', () => {
    const rows = [link({ id: 'l_old_declined', status: 'declined', createdAt: iso(at - 9000), decidedAt: iso(at - 8000) }),
      link({ id: 'l_new_approved', status: 'approved', createdAt: iso(at + 5000), decidedAt: iso(at + 6000), sessionId: 's_secret_session' }),
      link({ id: 'l_pending_old', createdAt: iso(at - 1000) }), link({ id: 'l_pending_new', createdAt: iso(at + 1000) })];
    expect(orderLinks(rows).map((row) => row.id)).toEqual(['l_pending_new', 'l_pending_old', 'l_new_approved', 'l_old_declined']);
    const tie = [link({ id: 'first' }), link({ id: 'second' })];
    expect(orderLinks(tie).map((row) => row.id)).toEqual(['first', 'second']);
    const html = panel({ state: ready(rows) });
    expect(html.indexOf('l_pending_new')).toBeLessThan(html.indexOf('l_pending_old'));
    expect(html.indexOf('l_pending_old')).toBeLessThan(html.indexOf('l_new_approved'));
    expect(html.match(/>批准<\/button>/gu)).toHaveLength(2);
    expect(html.match(/>拒绝<\/button>/gu)).toHaveLength(2);
    expect(html).toContain('<span class="link-status inactive">已拒绝</span>');
    expect(html).toContain(`<time dateTime="${iso(at - 8000)}">`);
    expect(html).toContain('<code title="l_pending_new">…ding_new</code>');
    expect(html).not.toContain('s_secret_session');
    expect(html).not.toContain('Sample');
    expect(panel({ state: ready([]) })).toContain('还没有连接请求。');
    expect(panel({})).toContain('连接后显示连接请求。');
    expect(panel({ state: ready([link()], true) })).toContain('Sample · 公司助理申请连接');
    expect(panel({ state: ready([link()]), blocked: true })).toMatch(/class="primary" disabled=""/u);
  });
});
