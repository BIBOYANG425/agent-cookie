import type { CommitRef, Intent, MemoryRepo, OpenMemoryRepoOptions, Quote, WriteMeta } from '@agent-cookie/contract';
import type { LearningCard, LearningContribution, LearningMergeOptions, LearningRulesApi } from '@agent-cookie/rules';

// TODO(contract): local additive learning seam until lane A publishes the learning API.
export interface AppendIntentInput {
  intent: Pick<Intent, 'id' | 'userId' | 'expiresAt'> & Partial<Pick<Intent, 'kind'>>;
  extracted: readonly LearningContribution[];
  chosenQuote?: Pick<Quote, 'id' | 'agentId' | 'price' | 'currency'>;
}

export interface IntentSummary {
  intentId: string;
  date: string;
  summary: string;
}

export interface IntentHistoryApi {
  appendIntent(input: AppendIntentInput, meta: WriteMeta): Promise<CommitRef>;
  searchIntents(q: string): Promise<IntentSummary[]>;
}

export type MemoryRepoWithIntents = MemoryRepo & IntentHistoryApi;

export type OpenLearningMemoryRepoOptions = Omit<OpenMemoryRepoOptions, 'rules'> & { rules: LearningRulesApi };
export type LearningMemoryRepo = Omit<MemoryRepoWithIntents, 'appendContribution' | 'listContributions' | 'regenerateCard'> & {
  appendContribution(c: LearningContribution, meta: WriteMeta): Promise<CommitRef>;
  listContributions(): Promise<LearningContribution[]>;
  regenerateCard(merge: LearningMergeOptions, meta: WriteMeta): Promise<{ card: LearningCard; commit: CommitRef }>;
};
