import { FIELDS, PREF_FIELDS, type Category, type Field } from '../../../packages/contract/src/types';
import type { RankingWeights } from '../../../packages/contract/src/analytics';

// Mirrors of packages/contract/src/policy-document.ts and policy.ts. Those modules import node:crypto, so even a type
// import would pull Node into the browser build; test/policy.test.ts checks at compile time that these stay identical.
export type ReadDecision = 'allow' | 'PURPOSE_MISMATCH' | 'SCOPE_DENIED';
export interface PolicyDocument {
  v: 1;
  auto: Record<Category, Field[]>;
  purpose: Record<Category, Partial<Record<Field, string[]>>>;
  write: Record<Category, Field[]>;
  ranking?: RankingWeights;
}
export interface PolicyView { policy: PolicyDocument; policyId: string; source: 'default' | 'repo' | 'installed' }
export interface ShadowReport {
  candidateId: string;
  currentId: string;
  changed: Array<{ ref: string; kind: 'receipt' | 'read'; field: Field; before: ReadDecision; after: ReadDecision }>;
  unchanged: number;
}

export const POLICY_CATEGORIES: readonly Category[] = ['personal', 'shoe', 'retail'];
export const categoryLabels: Record<Category, string> = { personal: '个人 agent', shoe: '鞋店', retail: '零售 · UCP 商店' };
export const sourceLabels: Record<PolicyView['source'], { label: string; note: string }> = {
  default: { label: '默认', note: '工作台内置的 v1 字段表（计划 §5 冻结），还没有安装过其他文档。' },
  repo: { label: '记忆库', note: '来自记忆库里的 POLICY.yaml；从这里安装时也会先写回记忆库。' },
  installed: { label: '已安装', note: 'owner 通过 PUT 安装，保存在工作台 SQLite；不在记忆库里。' },
};
export const decisionLabels: Record<ReadDecision, string> = { allow: '放行', PURPOSE_MISMATCH: '用途不符', SCOPE_DENIED: '不在范围' };
const DECISIONS: readonly ReadDecision[] = ['allow', 'PURPOSE_MISMATCH', 'SCOPE_DENIED'];
const MERCHANT_AUTO = ['lang', 'tone', 'length', 'shoe_size', 'budget', 'deadline'] as const;

/**
 * Sample only: the same shape and content as the contract's DEFAULT_POLICY (test/policy.test.ts compares them), built
 * from the browser-safe FIELDS lists. The id is a placeholder, not a hash; the workspace computes real ids.
 */
export function samplePolicyView(): PolicyView {
  return { policyId: 'sample-policy', source: 'default', policy: {
    v: 1,
    auto: { personal: [...FIELDS], shoe: [...MERCHANT_AUTO], retail: [...MERCHANT_AUTO, ...PREF_FIELDS] },
    purpose: { personal: {}, shoe: { shipping_address: ['checkout'], payment_method: ['payment'] },
      retail: { shipping_address: ['checkout'], payment_method: ['payment'] } },
    write: { personal: [...FIELDS], shoe: ['shoe_size'], retail: ['shoe_size'] },
  } };
}

/** The workspace's 422 for a candidate that fails the floor. Messages name sections and field names, never values. */
export class PolicyViolationError extends Error {
  constructor(readonly violations: string[]) {
    super(`工作台拒绝：候选策略有 ${violations.length} 项不满足底线，见策略面板。`);
  }
}

/** policyViolations(...).join("; ") → one line per violation; control characters dropped, length capped for display. */
export function parseViolations(message: string): string[] {
  return message.split('; ').map((line) => line.replace(/[\x00-\x1f\x7f]/gu, ' ').trim().slice(0, 300))
    .filter((line) => line.length > 0).slice(0, 100);
}

export type CandidateResult = { ok: true; value: Record<string, unknown> } | { ok: false; message: string };
/** Client-side parse only; the workspace alone decides whether a document may be installed. */
export function parseCandidate(text: string): CandidateResult {
  if (text.trim() === '') return { ok: false, message: '请先粘贴候选策略文档（JSON）。' };
  if (text.length > 16000) return { ok: false, message: '候选文档过长（上限 16000 个字符）。' };
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { ok: false, message: '候选文档不是合法的 JSON。' }; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, message: '候选文档必须是一个 JSON 对象。' };
  return { ok: true, value: value as Record<string, unknown> };
}

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200;
const texts = (v: unknown): v is string[] => Array.isArray(v) && v.every(text);
const count = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const malformed = () => new Error('策略响应格式与契约不一致。');

function normalizeDocument(doc: unknown): PolicyDocument {
  if (!object(doc) || doc.v !== 1 || !object(doc.auto) || !object(doc.purpose) || !object(doc.write)) throw malformed();
  const auto = doc.auto; const purpose = doc.purpose; const write = doc.write;
  const out = { v: 1, auto: {}, purpose: {}, write: {} } as PolicyDocument;
  for (const c of POLICY_CATEGORIES) {
    const p = purpose[c];
    if (!texts(auto[c]) || !texts(write[c]) || !object(p) || !Object.values(p).every(texts)) throw malformed();
    out.auto[c] = [...auto[c]] as PolicyDocument['auto'][Category];
    out.write[c] = [...write[c]] as PolicyDocument['write'][Category];
    out.purpose[c] = Object.fromEntries(Object.entries(p).map(([field, list]) => [field, [...(list as string[])]]));
  }
  if (doc.ranking !== undefined) {
    if (!object(doc.ranking) || !count(doc.ranking.winRate) || !count(doc.ranking.failure)) throw malformed();
    out.ranking = { winRate: doc.ranking.winRate, failure: doc.ranking.failure };
  }
  return out;
}

export function normalizePolicyView(body: unknown): PolicyView & { sample?: boolean } {
  if (!object(body) || !text(body.policyId) || !['default', 'repo', 'installed'].includes(String(body.source))) throw malformed();
  return { policy: normalizeDocument(body.policy), policyId: body.policyId, source: body.source as PolicyView['source'],
    ...(body.sample === true ? { sample: true } : {}) };
}

export function normalizeShadowReport(body: unknown): ShadowReport {
  if (!object(body) || !text(body.candidateId) || !text(body.currentId) || !count(body.unchanged) || !Array.isArray(body.changed)) throw malformed();
  const changed = body.changed.map((row) => {
    if (!object(row) || !text(row.ref) || !['receipt', 'read'].includes(String(row.kind)) || !text(row.field)
      || !DECISIONS.includes(row.before as ReadDecision) || !DECISIONS.includes(row.after as ReadDecision)) throw malformed();
    return { ref: row.ref, kind: row.kind, field: row.field, before: row.before, after: row.after } as ShadowReport['changed'][number];
  });
  return { candidateId: body.candidateId, currentId: body.currentId, changed, unchanged: body.unchanged };
}

/** Display form of a policy id: grants carry the 12-character id; show 8 and keep the full one in the title. */
export function shortPolicyId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}
