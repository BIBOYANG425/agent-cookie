import type { RulesApi } from '@agent-cookie/contract';
import { deriveSessionId } from './session.js';
import { mergeCard } from './merge.js';
import { renderCard, renderContribution, parseContributions, parseLearningContributions } from './render.js';
import { mergeLearningCard } from './learning.js';
import type { LearningRulesApi } from './learning-types.js';
export * from './learning-types.js';

export { deriveSessionId, mergeCard, mergeLearningCard, renderCard, renderContribution, parseContributions, parseLearningContributions };
export const rules: RulesApi = { deriveSessionId, mergeCard, renderCard, renderContribution, parseContributions };
export const learningRules: LearningRulesApi = { deriveSessionId, mergeCard: mergeLearningCard, renderCard, renderContribution,
  parseContributions: parseLearningContributions };
