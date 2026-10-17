import type { RulesApi } from '@agent-cookie/contract';
import { deriveSessionId } from './session.js';
import { mergeCard } from './merge.js';
import { renderCard, renderContribution, parseContributions } from './render.js';

export { deriveSessionId, mergeCard, renderCard, renderContribution, parseContributions };
export const rules: RulesApi = { deriveSessionId, mergeCard, renderCard, renderContribution, parseContributions };
