import type { CardField } from './model';

// Local wire projection of A 0129f085e297942ad174b34f02b26ab28d789822:
// packages/contract/src/types.ts (LearningState, LearnedResponse, LearnedEntry, LearnedEvidence, PREF_KEYS).
// TODO(contract): import these exports after A's contract is merged; main currently lacks them.
export const LEARNED_FIELDS = ['pref.brand', 'pref.color', 'pref.material', 'pref.style', 'pref.fit',
  'pref.avoid', 'pref.occasion', 'pref.recipient', 'pref.price_band', 'pref.size_system'] as const;
export type LearnedField = typeof LEARNED_FIELDS[number];
export interface LearnedEvidence {
  contributionId: string; agentId: string; basis: 'observed' | 'stated' | 'inferred'; createdAt: string;
  intentId?: string; conversationId?: string; snippet?: string;
}
export interface LearnedEntry {
  field: LearnedField; value: string; status: 'card' | 'candidate'; sources: string[]; evidence: LearnedEvidence[];
}
export interface LearnedResponse { paused: boolean; learned: LearnedEntry[] }

// Console view state. No record/group IDs are fabricated for the revoke API.
export interface LearningState {
  availability: 'ready' | 'unavailable' | 'error'; paused: boolean | null; entries: LearnedEntry[];
  message?: string; sample?: boolean;
  sampleStages?: Array<{ id: string; label: string }>;
  sampleStage?: string; sampleDescription?: string;
}
export interface LearningSeed extends LearnedResponse {
  stages?: Array<{ id: string; label: string; description: string; learned: LearnedEntry[]; card?: CardField[] }>;
}

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string';
const identifier = (v: unknown): v is string => text(v) && v.length > 0;
const date = (v: unknown): v is string => text(v) && Number.isFinite(Date.parse(v));
const malformed = () => new Error('学习响应格式与 A 线已核对契约不一致。');

export function normalizeLearningPaused(body: unknown): boolean {
  if (!object(body) || typeof body.paused !== 'boolean') throw malformed();
  return body.paused;
}

export function normalizeLearning(body: unknown): LearningState {
  const paused = normalizeLearningPaused(body);
  if (!object(body) || !Array.isArray(body.learned)) throw malformed();
  const groups = new Set<string>();
  const ids = new Set<string>();
  const entries = body.learned.map((row): LearnedEntry => {
    if (!object(row) || !LEARNED_FIELDS.includes(row.field as LearnedField) || !text(row.value)
      || !['card', 'candidate'].includes(String(row.status)) || !Array.isArray(row.sources) || !row.sources.every(identifier)
      || !Array.isArray(row.evidence)) throw malformed();
    const group = JSON.stringify([row.field, row.value]);
    if (groups.has(group)) throw malformed();
    groups.add(group);
    const evidence = row.evidence.map((item): LearnedEvidence => {
      if (!object(item) || !identifier(item.contributionId) || ids.has(item.contributionId) || !identifier(item.agentId)
        || !['observed', 'stated', 'inferred'].includes(String(item.basis)) || !date(item.createdAt)
        || (item.intentId !== undefined && !identifier(item.intentId))
        || (item.conversationId !== undefined && !identifier(item.conversationId))
        || (item.snippet !== undefined && (!text(item.snippet) || [...item.snippet].length > 200))) throw malformed();
      ids.add(item.contributionId);
      return { contributionId: item.contributionId, agentId: item.agentId, basis: item.basis as LearnedEvidence['basis'], createdAt: item.createdAt,
        ...(text(item.intentId) ? { intentId: item.intentId } : {}), ...(text(item.conversationId) ? { conversationId: item.conversationId } : {}),
        ...(text(item.snippet) ? { snippet: item.snippet } : {}) };
    });
    return { field: row.field as LearnedField, value: row.value, status: row.status as LearnedEntry['status'],
      sources: [...new Set(row.sources as string[])], evidence };
  });
  return { availability: 'ready', paused, entries, ...(body.sample === true ? { sample: true } : {}) };
}

/** Display-only source count. Both IDs on one evidence item are aliases, including aliases shared across items. */
export function countEvidenceSources(evidence: readonly LearnedEvidence[]): number {
  const components: Set<string>[] = [];
  for (const item of evidence) {
    const aliases = [item.conversationId && `conversation:${item.conversationId}`, item.intentId && `intent:${item.intentId}`]
      .filter((id): id is string => !!id);
    if (aliases.length === 0) aliases.push(`agent:${item.agentId}`);
    const combined = new Set(aliases);
    for (let index = components.length - 1; index >= 0; index--) {
      const component = components[index];
      if ([...component].some((id) => combined.has(id))) {
        for (const id of component) combined.add(id);
        components.splice(index, 1);
      }
    }
    components.push(combined);
  }
  return components.length;
}
