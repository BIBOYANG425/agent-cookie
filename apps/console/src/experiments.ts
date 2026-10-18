// Mirrors of packages/contract/src/analytics.ts (Phase 4, holdout experiment E1). Kept local like src/policy.ts so the
// browser build never depends on the contract's runtime modules; test/experiments.test.ts checks at compile time that
// these stay identical to the contract types.
export type ExperimentArm = 'control' | 'treatment';
export interface ExperimentArmStats {
  n: number;
  accepted: number;
  rate: number;
  wilson95: [number, number];
  medianAcceptMs?: number;
}
export interface ExperimentReport {
  experiment: 'ranking';
  arms: Record<ExperimentArm, ExperimentArmStats>;
  sample: boolean;
  generatedAt: string;
}

export const EXPERIMENT_ARMS: readonly ExperimentArm[] = ['control', 'treatment'];
export const isExperimentArm = (value: unknown): value is ExperimentArm => value === 'control' || value === 'treatment';
export const armLabels: Record<ExperimentArm, string> = { control: '对照', treatment: '处理' };
export const armNotes: Record<ExperimentArm, string> = {
  control: '今天的顺序：指定商家、尺码、偏好、预算、目录顺序',
  treatment: '按卖家在你过往意图中的结果记录排序',
};
/** docs/commerce-analytics-plan.md §6: no sentence about lift before each E1 arm has at least this many intents. */
export const MIN_ARM_N = 40;

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const unit = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const malformed = () => new Error('实验响应格式与契约不一致。');

function normalizeArm(value: unknown): ExperimentArmStats {
  if (!object(value) || !count(value.n) || !count(value.accepted) || value.accepted > value.n || !unit(value.rate)
    || !Array.isArray(value.wilson95) || value.wilson95.length !== 2 || !unit(value.wilson95[0]) || !unit(value.wilson95[1])
    || value.wilson95[0] > value.wilson95[1]
    || (value.medianAcceptMs !== undefined && !(typeof value.medianAcceptMs === 'number' && Number.isFinite(value.medianAcceptMs)
      && value.medianAcceptMs >= 0))) throw malformed();
  return { n: value.n, accepted: value.accepted, rate: value.rate, wilson95: [value.wilson95[0], value.wilson95[1]],
    ...(value.medianAcceptMs !== undefined ? { medianAcceptMs: value.medianAcceptMs as number } : {}) };
}

/** Copies only the contract's keys: both arms' counts, the rate, its interval and the median. Nothing else reaches the page. */
export function normalizeExperimentReport(body: unknown): ExperimentReport {
  if (!object(body) || body.experiment !== 'ranking' || !object(body.arms) || typeof body.sample !== 'boolean'
    || !date(body.generatedAt)) throw malformed();
  const arms = body.arms;
  return { experiment: 'ranking', arms: { control: normalizeArm(arms.control), treatment: normalizeArm(arms.treatment) },
    sample: body.sample, generatedAt: body.generatedAt };
}

export type ArmComparison = { kind: 'off' }
  | { kind: 'insufficient'; control: number; treatment: number }
  /** treatment − control, as a proportion, and its 95 % interval (Newcombe's hybrid score method from both Wilson intervals). */
  | { kind: 'ready'; difference: number; interval: [number, number] };

/**
 * Below the plan's minimum n in either arm the comparison is `insufficient` and no difference is computed at all.
 * At or above it, the difference of the two rates with Newcombe's interval (method 10), built only from the workspace's
 * own rates and Wilson bounds, so the console adds no statistic of its own beyond the combination.
 */
export function compareArms(report: ExperimentReport): ArmComparison {
  const { control, treatment } = report.arms;
  if (control.n === 0 && treatment.n === 0) return { kind: 'off' };
  if (control.n < MIN_ARM_N || treatment.n < MIN_ARM_N) return { kind: 'insufficient', control: control.n, treatment: treatment.n };
  const difference = treatment.rate - control.rate;
  const [tl, tu] = treatment.wilson95;
  const [cl, cu] = control.wilson95;
  const below = Math.sqrt((treatment.rate - tl) ** 2 + (cu - control.rate) ** 2);
  const above = Math.sqrt((tu - treatment.rate) ** 2 + (control.rate - cl) ** 2);
  return { kind: 'ready', difference, interval: [Math.max(-1, difference - below), Math.min(1, difference + above)] };
}

/** A proportion as a percentage with at most one decimal, clamped to [0, 100]. */
export function percent(value: number): string {
  const clamped = Math.min(1, Math.max(0, value));
  return `${Math.round(clamped * 1000) / 10}%`;
}
/** The Wilson interval as "低–高" percentages. */
export function intervalText([lo, hi]: [number, number]): string {
  return `${percent(lo)}–${percent(hi)}`;
}
/** A signed difference of proportions in percentage points, one decimal. */
export function points(value: number): string {
  const rounded = Math.round(value * 1000) / 10;
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : ''}${Math.abs(rounded).toFixed(1)}`;
}
export function durationText(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} 毫秒`;
  if (ms < 60000) return `${Math.round(ms / 100) / 10} 秒`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
  return `${Math.floor(seconds / 3600)} 小时 ${Math.floor((seconds % 3600) / 60)} 分`;
}

/**
 * Sample only: authored counts, labelled Sample, matching the arms on the Sample funnel rows (sample-intent-3 treatment
 * and accepted; sample-intent-2 control and accepted; sample-intent-1 control, not accepted). Both arms are far below
 * MIN_ARM_N, so the panel shows 样本不足. The intervals are the Wilson z = 1.96 values for those counts (checked in
 * test/experiments.test.ts); the medians are authored, not measured.
 */
export function sampleExperimentReport(now: number): ExperimentReport {
  return { experiment: 'ranking', sample: true, generatedAt: new Date(now).toISOString(), arms: {
    control: { n: 2, accepted: 1, rate: 0.5, wilson95: [0.09452865480086614, 0.9054713451991339], medianAcceptMs: 212000 },
    treatment: { n: 1, accepted: 1, rate: 1, wilson95: [0.20654329147389294, 1], medianAcceptMs: 96000 },
  } };
}
