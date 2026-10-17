import type { CardField } from './model';

// TODO(contract): A has not published GET /personal/learned or PUT /personal/learning response types.
// These are provisional console view types, not additions to the shared workspace contract.
// Only this normalizer interprets the provisional { enabled, entries } response.
export interface LearnedSource {
  kind: 'conversation' | 'intent'; id: string; agentId?: string; label?: string; evidence?: string; at?: string;
}
export interface LearnedEntry {
  id: string; field: string; value: string; status: 'candidate' | 'on_card' | 'confirmed';
  createdAt?: string; updatedAt?: string; evidence?: string; sources: LearnedSource[]; revokedAt?: string;
  basis?: 'stated' | 'observed' | 'inferred';
  /** Only present when the response shape identifies an actual contribution ID, not a proposed observation ID. */
  contributionId?: string;
}
export interface LearningState {
  availability: 'ready' | 'unavailable' | 'error'; enabled: boolean | null; entries: LearnedEntry[];
  message?: string; sample?: boolean;
  sampleStages?: Array<{ id: string; label: string }>;
  sampleStage?: string; sampleDescription?: string;
}
export interface LearningSeed {
  enabled: boolean; entries: LearnedEntry[];
  stages?: Array<{ id: string; label: string; description: string; entries: LearnedEntry[]; card?: CardField[] }>;
}

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string';
const date = (v: unknown): v is string => text(v) && Number.isFinite(Date.parse(v));
const optionalText = (v: unknown) => v === undefined || text(v);
const optionalDate = (v: unknown) => v === undefined || date(v);
const malformed = () => new Error('学习响应尚未符合已约定的临时格式，请等待接口契约对齐。');

export function normalizeLearningEnabled(body: unknown): boolean {
  if (!object(body) || typeof body.enabled !== 'boolean') throw malformed();
  return body.enabled;
}

export function normalizeLearning(body: unknown): LearningState {
  const enabled = normalizeLearningEnabled(body);
  if (!object(body)) throw malformed();
  // TODO(contract): B's 35f6b38 proposal calls these `learned`/`key`/`confirmed`/`updatedAt`.
  // Confirmed is not silently promoted to on_card; no sources, creation time or revoke ID are invented.
  const proposal = body.entries === undefined && Array.isArray(body.learned);
  if (proposal && (typeof body.generation !== 'number' || !Number.isSafeInteger(body.generation) || body.generation < 0)) throw malformed();
  const records = proposal ? body.learned : body.entries;
  if (!Array.isArray(records)) throw malformed();
  const ids = new Set<string>();
  const entries = records.map((row): LearnedEntry => {
    if (!object(row)) throw malformed();
    const field = proposal ? row.key : row.field;
    const rawSources = proposal ? [] : row.sources;
    if (!text(row.id) || !row.id || ids.has(row.id) || !text(field) || !field
      || !text(row.value) || !(proposal ? ['candidate', 'confirmed'] : ['candidate', 'on_card']).includes(String(row.status))
      || !(proposal ? date(row.updatedAt) : date(row.createdAt))
      || !optionalText(row.evidence) || !optionalDate(row.revokedAt) || !Array.isArray(rawSources)
      || (row.basis !== undefined && !['stated', 'observed', 'inferred'].includes(String(row.basis)))) throw malformed();
    if (proposal && (!text(row.evidence) || !['stated', 'observed', 'inferred'].includes(String(row.basis)))) throw malformed();
    ids.add(row.id);
    const unique = new Map<string, LearnedSource>();
    for (const source of rawSources) {
      if (!object(source) || !['conversation', 'intent'].includes(String(source.kind)) || !text(source.id) || !source.id
        || !optionalText(source.agentId) || !optionalText(source.label) || !optionalText(source.evidence) || !optionalDate(source.at)) throw malformed();
      const value = source as unknown as LearnedSource;
      // Repeated messages within the same conversation/intent remain one source; never imply corroboration.
      const key = JSON.stringify([value.kind, value.id]);
      const previous = unique.get(key);
      if (!previous) unique.set(key, { ...value });
      else unique.set(key, { ...value, ...previous, evidence: previous.evidence ?? value.evidence });
    }
    return { id: row.id, field, value: row.value, status: row.status as LearnedEntry['status'],
      ...(proposal ? { updatedAt: row.updatedAt as string } : { createdAt: row.createdAt as string, contributionId: row.id }),
      ...(row.basis ? { basis: row.basis as LearnedEntry['basis'] } : {}), sources: [...unique.values()],
      ...(text(row.evidence) ? { evidence: row.evidence } : {}), ...(date(row.revokedAt) ? { revokedAt: row.revokedAt } : {}) };
  }).sort((a, b) => Date.parse(b.updatedAt ?? b.createdAt!) - Date.parse(a.updatedAt ?? a.createdAt!));
  return { availability: 'ready', enabled, entries, ...(body.sample === true ? { sample: true } : {}) };
}
