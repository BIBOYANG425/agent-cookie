import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type * as Analytics from '../../../packages/contract/src/analytics';
import { EXPERIMENT_ARMS as CONTRACT_ARMS } from '../../../packages/contract/src/analytics';
import type * as Types from '../../../packages/contract/src/types';
import { createLiveAdapter, createSampleAdapter } from '../src/adapters';
import { ConsoleController } from '../src/controller';
import { compareArms, durationText, EXPERIMENT_ARMS, intervalText, MIN_ARM_N, normalizeExperimentReport, percent,
  sampleExperimentReport, type ExperimentArm, type ExperimentArmStats, type ExperimentReport } from '../src/experiments';
import { ExperimentPanel } from '../src/ExperimentPanel';
import { normalizeFunnelReport, sampleFunnelReport, type FunnelReport } from '../src/funnel';
import { FunnelPanel } from '../src/FunnelPanel';
import type { Section } from '../src/model';
import type { Receipt } from '../src/receipts';

// Compile-time (pnpm typecheck): the console's mirrors equal the contract types in both directions.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const mirrors: [Same<ExperimentArm, Analytics.ExperimentArm>, Same<ExperimentArmStats, Analytics.ExperimentArmStats>,
  Same<ExperimentReport, Analytics.ExperimentReport>, Same<Receipt, Types.Receipt>] = [true, true, true, true];

const at = Date.parse('2026-10-17T20:00:00.000Z');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const render = (state: Section<ExperimentReport> | undefined, sample = false) => renderToStaticMarkup(createElement(ExperimentPanel, { state, sample }));
/** Reference Wilson score interval, z = 1.96 (test only: the console never computes one for live data). */
function wilson(successes: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const p = successes / n; const z2 = 1.96 ** 2; const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (1.96 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [successes === 0 ? 0 : Math.max(0, center - half), successes === n ? 1 : Math.min(1, center + half)];
}
const arm = (accepted: number, n: number, medianAcceptMs?: number): ExperimentArmStats => ({ n, accepted,
  rate: n === 0 ? 0 : accepted / n, wilson95: wilson(accepted, n), ...(medianAcceptMs !== undefined ? { medianAcceptMs } : {}) });
const report = (control: ExperimentArmStats, treatment: ExperimentArmStats, sample = false): ExperimentReport => ({
  experiment: 'ranking', arms: { control, treatment }, sample, generatedAt: new Date(at).toISOString() });
const ready = (data: ExperimentReport): Section<ExperimentReport> => ({ availability: 'ready', data });
/** Every "低–高" range in the markup, as numbers. */
const ranges = (html: string) => [...html.matchAll(/([0-9.]+)%–([0-9.]+)%/gu)].map((m) => [Number(m[1]), Number(m[2])]);
const core = (path: string) => path.endsWith('/me') ? json({ role: 'owner' })
  : path.endsWith('/personal/card') ? json({ card: [], candidates: [], superseded: [] })
  : path.endsWith('/personal/grants') ? json({ grants: [] }) : path.endsWith('/owner/activity') ? json({ events: [] })
  : path.endsWith('/owner/experiments') ? undefined : json({ error: { code: 'NOT_FOUND' } }, 404);

describe('experiment panel', () => {
  it('renders the Sample report: both arms, Wilson ranges as percentages, medians, 样本不足 and no difference', async () => {
    const network = vi.spyOn(globalThis, 'fetch');
    const controller = new ConsoleController(createSampleAdapter(() => at));
    await controller.refresh();
    const state = controller.getState().data!.experiments!;
    expect(state).toMatchObject({ availability: 'ready', sample: true, data: { sample: true, experiment: 'ranking' } });
    const html = render(state, true);
    for (const text of ['Sample · 排序实验 E1 · 只含计数', '<th scope="col">意图数（n）</th>', '<th scope="col">95% 区间（Wilson）</th>',
      '对照（control）', '处理（treatment）', '今天的顺序', '按卖家在你过往意图中的结果记录排序', '<strong>样本不足</strong>',
      '每组至少需要 40 个意图才比较两组，现在对照 2 个、处理 1 个', '不计算两组之差', 'docs/commerce-analytics-plan.md §6',
      '<td data-label="接受率" class="num">50%</td>', '<td data-label="95% 区间（Wilson）" class="num">9.5%–90.5%</td>',
      '<td data-label="95% 区间（Wilson）" class="num">20.7%–100%</td>', '<td data-label="中位接受时长" class="num">3 分 32 秒</td>',
      '<td data-label="中位接受时长" class="num">1 分 36 秒</td>', 'Sample 数据：编写的分组计数']) expect(html).toContain(text);
    expect(html).not.toContain('个百分点');
    expect(html).not.toContain('处理 − 对照');
    expect(html.match(/<tr>/gu)).toHaveLength(3);
    expect(network).not.toHaveBeenCalled();
    network.mockRestore();
  });

  it('authored Sample intervals are the Wilson values for its counts and its arms match the Sample funnel rows', () => {
    const sample = sampleExperimentReport(at);
    const rows = sampleFunnelReport(at).rows;
    for (const name of EXPERIMENT_ARMS) {
      const stats = sample.arms[name];
      const mine = rows.filter((row) => row.arm === name);
      expect(stats.n).toBe(mine.length);
      expect(stats.accepted).toBe(mine.filter((row) => row.accepted).length);
      expect(stats.rate).toBe(stats.accepted / stats.n);
      expect(stats.wilson95[0]).toBeCloseTo(wilson(stats.accepted, stats.n)[0], 12);
      expect(stats.wilson95[1]).toBeCloseTo(wilson(stats.accepted, stats.n)[1], 12);
      expect(stats.n).toBeLessThan(MIN_ARM_N);
    }
    expect([...EXPERIMENT_ARMS]).toEqual([...CONTRACT_ARMS]);
  });

  it('shows 样本不足 and computes no difference whenever either arm is below 40', () => {
    for (const [control, treatment] of [[39, 400], [400, 39], [1, 0], [0, 45], [39, 39]]) {
      const data = report(arm(Math.floor(control / 2), control), arm(treatment, treatment));
      const comparison = compareArms(data);
      expect(comparison).toEqual({ kind: 'insufficient', control, treatment });
      expect(comparison).not.toHaveProperty('difference');
      const html = render(ready(data));
      expect(html).toContain('<strong>样本不足</strong>');
      expect(html).not.toContain('个百分点');
      expect(html).not.toContain('Sample');
    }
  });

  it('renders every Wilson interval as percentages within [0, 100], low before high', () => {
    const cases = [report(arm(0, 3), arm(3, 3)), report(arm(1, 2), arm(1, 1)), report(arm(0, 40), arm(40, 40)),
      report(arm(17, 41), arm(29, 52, 125000)), report(arm(0, 0), arm(2, 7))];
    for (const data of cases) {
      const found = ranges(render(ready(data)));
      expect(found.length).toBe(EXPERIMENT_ARMS.filter((name) => data.arms[name].n > 0).length);
      for (const [lo, hi] of found) {
        expect(lo).toBeGreaterThanOrEqual(0);
        expect(hi).toBeLessThanOrEqual(100);
        expect(lo).toBeLessThanOrEqual(hi);
      }
    }
    expect(intervalText([0, 1])).toBe('0%–100%');
    expect(intervalText([-0.2, 1.4])).toBe('0%–100%');
    expect(percent(0.33333)).toBe('33.3%');
    // An empty arm next to a running one has no rate or interval to show.
    expect(render(ready(report(arm(0, 0), arm(2, 7))))).toContain('<td data-label="接受率" class="num">—</td>');
  });

  it('at 40 or more per arm shows the difference with its Newcombe interval and says whether it excludes 0', () => {
    const overlap = report(arm(20, 40), arm(28, 40));
    const comparison = compareArms(overlap);
    expect(comparison.kind).toBe('ready');
    if (comparison.kind !== 'ready') return;
    expect(comparison.difference).toBeCloseTo(0.2, 12);
    expect(comparison.interval[0]).toBeCloseTo(-0.0138, 3);
    expect(comparison.interval[1]).toBeCloseTo(0.3901, 3);
    const html = render(ready(overlap));
    expect(html).toContain('<strong>+20.0 个百分点</strong>');
    expect(html).toContain('95% 区间 −1.4 至 +39.0 个百分点');
    expect(html).toContain('区间包含 0：现有数据不能说明两组的接受率不同。');
    expect(html).not.toContain('样本不足');
    expect(render(ready(report(arm(10, 40), arm(30, 40))))).toContain('区间在 0 以上');
    expect(render(ready(report(arm(30, 40), arm(10, 40))))).toContain('区间在 0 以下');
  });

  it('shows the off state when both arms are empty, and connection / endpoint states', () => {
    const off = render(ready(report(arm(0, 0), arm(0, 0))));
    expect(off).toContain('实验未开启：两组都还没有意图');
    expect(off).toContain('<code>AGENT_COOKIE_EXPERIMENT=ranking</code>');
    expect(off).not.toContain('<table');
    expect(off).not.toContain('样本不足');
    expect(compareArms(report(arm(0, 0), arm(0, 0)))).toEqual({ kind: 'off' });
    expect(render(undefined)).toContain('连接后显示实验');
    expect(render({ availability: 'unavailable', message: '工作台尚未提供实验接口。其他面板可继续使用。' })).toContain('工作台尚未提供实验接口');
    const workspaceSample = render(ready(report(arm(1, 2), arm(1, 1), true)));
    expect(workspaceSample).toContain('Sample · 排序实验 E1');
    expect(workspaceSample).toContain('Sample 数据，不代表真实商家或用户。工作台按意图上保存的分组重新计算');
    expect(workspaceSample).not.toContain('编写的分组计数');
  });

  it('formats median time to accept and leaves it out when nothing was accepted', () => {
    expect(durationText(850)).toBe('850 毫秒');
    expect(durationText(12340)).toBe('12.3 秒');
    expect(durationText(212000)).toBe('3 分 32 秒');
    expect(durationText(3 * 3600000 + 5 * 60000)).toBe('3 小时 5 分');
    expect(render(ready(report(arm(0, 3), arm(1, 3, 61000))))).toContain('<td data-label="中位接受时长" class="num">—</td>');
  });
});

describe('experiments over the live adapter', () => {
  it('reads /owner/experiments and keeps only the contract keys', async () => {
    const paths: string[] = [];
    const body = { ...report(arm(1, 2, 5000), arm(0, 1)), extra: 'secret-extra',
      arms: { control: { ...arm(1, 2, 5000), note: 'secret-note' }, treatment: arm(0, 1), handshake: arm(1, 1) } };
    const live = createLiveAdapter(async (path) => { paths.push(path); return core(path) ?? json(body); }, () => at);
    const snapshot = await live.load();
    expect(paths).toContain('/workspace-api/owner/experiments');
    expect(snapshot.experiments).toEqual({ availability: 'ready', data: report(arm(1, 2, 5000), arm(0, 1)) });
    expect(JSON.stringify(snapshot.experiments)).not.toContain('secret');
    expect(render(snapshot.experiments)).toContain('样本不足');
  });

  it('a missing endpoint or a malformed report degrades this panel only', async () => {
    const missing = await createLiveAdapter(async (path) => core(path) ?? json({ error: { code: 'NOT_FOUND' } }, 404), () => at).load();
    expect(missing.experiments).toEqual({ availability: 'unavailable', message: expect.stringContaining('实验') });
    const good = report(arm(1, 2), arm(1, 1));
    for (const bad of [{ ...good, experiment: 'handshake' }, { ...good, arms: { control: good.arms.control } },
      { ...good, arms: { ...good.arms, control: { ...good.arms.control, rate: 1.5 } } },
      { ...good, arms: { ...good.arms, control: { ...good.arms.control, wilson95: [0.8, 0.2] } } },
      { ...good, arms: { ...good.arms, control: { ...good.arms.control, wilson95: [0, 1.01] } } },
      { ...good, arms: { ...good.arms, control: { ...good.arms.control, accepted: 3 } } },
      { ...good, arms: { ...good.arms, treatment: { ...good.arms.treatment, n: 1.5 } } },
      { ...good, arms: { ...good.arms, treatment: { ...good.arms.treatment, medianAcceptMs: -1 } } },
      { ...good, sample: 'no' }, { ...good, generatedAt: 'now' }]) {
      expect(() => normalizeExperimentReport(bad)).toThrow('实验响应格式');
    }
    const broken = await createLiveAdapter(async (path) => core(path) ?? json({ ...good, experiment: 'other' }), () => at).load();
    expect(broken.experiments).toEqual({ availability: 'error', message: expect.stringContaining('实验响应格式') });
    expect(broken.grants).toEqual([]);
    const labelled = await createLiveAdapter(async (path) => core(path) ?? json({ ...good, sample: true }), () => at).load();
    expect(labelled.experiments).toMatchObject({ availability: 'ready', sample: true });
  });
});

describe('funnel arm column', () => {
  it('shows 对照 / 处理 / — from FunnelRow.arm next to the existing columns', async () => {
    const snapshot = await createSampleAdapter(() => at).load();
    const html = renderToStaticMarkup(createElement(FunnelPanel, { state: snapshot.funnel, sample: true }));
    expect(html).toContain('<th scope="col">分组</th>');
    for (const column of ['时间', '介绍', '报价', '首个报价(ms)', '接受', '结果', '字段(读/授)', '回执']) expect(html).toContain(`<th scope="col">${column}</th>`);
    expect(html.match(/<td data-label="分组">处理<\/td>/gu)).toHaveLength(1);
    expect(html.match(/<td data-label="分组">对照<\/td>/gu)).toHaveLength(2);
    const row = { intentId: 'i-1', createdAt: new Date(at).toISOString(), source: 'live', introduced: 1, quoted: 0, accepted: false,
      fieldsGranted: 6, fieldsRead: 0, purposeReleases: 0 };
    const live: FunnelReport = normalizeFunnelReport({ rows: [row, { ...row, intentId: 'i-2', arm: 'treatment' }], sample: false,
      generatedAt: new Date(at).toISOString() });
    expect(live.rows.map((r) => r.arm)).toEqual([undefined, 'treatment']);
    expect(live.rows[0]).not.toHaveProperty('arm');
    const liveHtml = renderToStaticMarkup(createElement(FunnelPanel, { state: { availability: 'ready', data: live }, sample: false }));
    expect(liveHtml).toContain('<td data-label="分组">—</td>');
    expect(liveHtml).toContain('<td data-label="分组">处理</td>');
    expect(() => normalizeFunnelReport({ rows: [{ ...row, arm: 'holdout' }], sample: false, generatedAt: new Date(at).toISOString() }))
      .toThrow('漏斗响应格式');
  });
});
