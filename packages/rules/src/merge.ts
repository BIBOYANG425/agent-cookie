import type { Card, Contribution } from '@agent-cookie/contract';
import { mergeLegacyCard } from './legacy-merge.js';
import { mergeLearningCard } from './learning.js';
import type { LearningCard, LearningContribution, LearningMergeOptions } from './learning-types.js';

export function mergeCard(contributions: readonly Contribution[], options: LearningMergeOptions): Card;
export function mergeCard(contributions: readonly LearningContribution[], options: LearningMergeOptions): LearningCard;
export function mergeCard(contributions: readonly LearningContribution[], options: LearningMergeOptions): LearningCard {
  return contributions.some(row => row.field.startsWith('pref.') || row.intentId !== undefined || row.conversationId !== undefined || row.evidence !== undefined)
    ? mergeLearningCard(contributions, options)
    : mergeLegacyCard(contributions as readonly Contribution[], options);
}
