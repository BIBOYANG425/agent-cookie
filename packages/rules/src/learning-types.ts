// TODO(contract): provisional local learning types until A publishes the shared contract.
import { isField, type Card, type CardField, type Candidate, type Contribution, type Field, type MergeOptions, type RulesApi } from '@agent-cookie/contract';

export type LearningField = Field | `pref.${string}`;
export interface LearningMetadata { intentId?: string; conversationId?: string; evidence?: string }
export type LearningContribution = Omit<Contribution, 'field'> & LearningMetadata & { field: LearningField };
export type LearningCardField = Omit<CardField, 'field'> & { field: LearningField };
export type LearningCandidate = Omit<Candidate, 'field'> & { field: LearningField };
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
  return isField(value) || (typeof value === 'string' && value.length <= 128
    && /^pref\.[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/u.test(value));
}

/** Evidence is never truncated; 200 Unicode code points, including punctuation/whitespace. */
export function isLearningContributionMetadata(value: unknown): value is LearningMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const metadata = value as Record<string, unknown>;
  for (const key of ['intentId', 'conversationId']) {
    if (metadata[key] !== undefined && (typeof metadata[key] !== 'string' || !metadata[key].trim())) return false;
  }
  return metadata.evidence === undefined || (typeof metadata.evidence === 'string' && [...metadata.evidence].length <= 200);
}

/** Single-record handle; merge resolves both IDs' transitive aliases before counting. Never use agentId as fallback. */
export function learningSourceId(record: LearningMetadata): string | undefined {
  if (!isLearningContributionMetadata(record)) return undefined;
  if (record.conversationId !== undefined) return `conversation:${record.conversationId}`;
  if (record.intentId !== undefined) return `intent:${record.intentId}`;
  return undefined;
}
