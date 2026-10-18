// Learning metadata matches main; preview aliases remain readable for existing memory files.
// evidenceSources is the canonical ID list, matching the shared B49 contract.
import { isField, PREF_KEYS, PREF_FIELDS, type Card, type CardField, type Candidate, type Contribution, type ContributionEvidence, type Field, type MergeOptions, type PrefField, type RulesApi } from '@agent-cookie/contract';

export const LEARNING_PREF_KEYS = PREF_KEYS;
export type LearningPrefField = PrefField;
export const LEARNING_PREF_FIELDS = PREF_FIELDS;
export type LearningField = Field;
export type LearningEvidence = ContributionEvidence;
/** Top-level IDs and string evidence remain readable for already-written C preview records. */
export interface LearningMetadata { intentId?: string; conversationId?: string; evidence?: string | LearningEvidence }
export type LearningContribution = Omit<Contribution, 'field' | 'evidence'> & LearningMetadata & { field: LearningField };
export type EvidenceCard = Omit<Card, 'card' | 'candidates'> & {
  card: Array<CardField & { evidenceSources: string[] }>;
  candidates: Array<Candidate & { evidenceSources: string[] }>;
};
export type LearningCardField = Omit<CardField, 'field'> & { field: LearningField; evidenceSources: string[] };
export type LearningCandidate = Omit<Candidate, 'field'> & { field: LearningField; evidenceSources: string[] };
export type LearningSuperseded = Omit<Card['superseded'][number], 'field'> & { field: LearningField };
export type LearningCard = Omit<Card, 'card' | 'candidates' | 'superseded'> & {
  card: LearningCardField[]; candidates: LearningCandidate[]; superseded: LearningSuperseded[];
};
export type LearningMergeOptions = Readonly<Omit<MergeOptions, 'personalAgentIds'>> & { readonly personalAgentIds: readonly string[] };
export type LearningRulesApi = Omit<RulesApi, 'mergeCard' | 'renderCard' | 'renderContribution' | 'parseContributions'> & {
  mergeCard(contributions: readonly LearningContribution[], options: LearningMergeOptions): LearningCard;
  renderCard(card: LearningCard, meta: Parameters<RulesApi['renderCard']>[1]): string;
  renderContribution(contribution: LearningContribution): string;
  parseContributions(markdown: string, owner: Parameters<RulesApi['parseContributions']>[1]): LearningContribution[];
};

export function isLearningField(value: unknown): value is LearningField {
  return isField(value);
}

/** Evidence is never truncated; 200 Unicode code points, including punctuation/whitespace. */
export function isLearningContributionMetadata(value: unknown): value is LearningMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const metadata = value as Record<string, unknown>;
  for (const key of ['intentId', 'conversationId']) {
    if (metadata[key] !== undefined && (typeof metadata[key] !== 'string' || !metadata[key].trim())) return false;
  }
  if (metadata.evidence === undefined) return true;
  if (typeof metadata.evidence === 'string') return [...metadata.evidence].length <= 200;
  if (typeof metadata.evidence !== 'object' || metadata.evidence === null || Array.isArray(metadata.evidence)) return false;
  const evidence = metadata.evidence as Record<string, unknown>;
  if (Object.keys(evidence).some(key => !['intentId', 'conversationId', 'snippet'].includes(key))) return false;
  for (const key of ['intentId', 'conversationId']) {
    if (evidence[key] !== undefined && (typeof evidence[key] !== 'string' || !evidence[key].trim())) return false;
    // A preview alias must not disagree with its canonical nested identifier.
    if (metadata[key] !== undefined && evidence[key] !== undefined && metadata[key] !== evidence[key]) return false;
  }
  return evidence.snippet === undefined || (typeof evidence.snippet === 'string' && [...evidence.snippet].length <= 200);
}

export function learningEvidence(record: LearningMetadata): LearningEvidence {
  const nested = typeof record.evidence === 'object' && record.evidence !== null ? record.evidence : {};
  return { ...(record.intentId === undefined ? {} : { intentId: record.intentId }),
    ...(record.conversationId === undefined ? {} : { conversationId: record.conversationId }), ...nested,
    ...(typeof record.evidence === 'string' ? { snippet: record.evidence } : {}) };
}

/** Single-record handle; merge resolves both IDs' transitive aliases before counting. Never use agentId as fallback. */
export function learningSourceId(record: LearningMetadata): string | undefined {
  if (!isLearningContributionMetadata(record)) return undefined;
  const evidence = learningEvidence(record);
  if (evidence.conversationId !== undefined) return `conversation:${evidence.conversationId}`;
  if (evidence.intentId !== undefined) return `intent:${evidence.intentId}`;
  return undefined;
}
