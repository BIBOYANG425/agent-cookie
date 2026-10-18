import type { Contribution } from '@agent-cookie/contract';
import { mergeLegacyCard } from './legacy-merge.js';
import { mergeLearningCard } from './learning.js';
import type { EvidenceCard, LearningCard, LearningContribution, LearningMergeOptions } from './learning-types.js';

export function mergeCard(contributions: readonly Contribution[], options: LearningMergeOptions): EvidenceCard;
export function mergeCard(contributions: readonly LearningContribution[], options: LearningMergeOptions): LearningCard;
export function mergeCard(contributions: readonly LearningContribution[], options: LearningMergeOptions): LearningCard {
  if (contributions.some(row => row.field.startsWith('pref.') || row.intentId !== undefined || row.conversationId !== undefined || row.evidence !== undefined)) {
    return mergeLearningCard(contributions, options);
  }
  const legacy = mergeLegacyCard(contributions as readonly Contribution[], options);
  return { ...legacy, card: legacy.card.map(row => ({ ...row, evidenceSources: [] })),
    candidates: legacy.candidates.map(row => ({ ...row, evidenceSources: [] })) };
}
