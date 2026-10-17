import type { CommitRef, Intent, MemoryRepo, OpenMemoryRepoOptions, Quote, WriteMeta } from '@agent-cookie/contract';
import type { LearningCard, LearningContribution, LearningMergeOptions, LearningRulesApi } from '@agent-cookie/rules';

// Structural projection of lane A 0129f08 while main retains the previous contract.
// TODO(contract): import IntentRecord after that contract lands on main.
export interface WorkspaceIntentRecord {
  id: string;
  userId: string;
  agentId: string;
  text?: string;
  query?: string;
  kind?: string;
  public: Record<string, string>;
  createdAt: string;
  chosenQuote?: { id: string; title?: string; seller?: string; price: number; currency: 'USD' };
}

/** Compatibility input for C preview history already written before A's contract. */
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
  appendIntent(input: AppendIntentInput | WorkspaceIntentRecord, meta: WriteMeta): Promise<CommitRef>;
  searchIntents(q: string): Promise<IntentSummary[]>;
}

export type MemoryRepoWithIntents = Omit<MemoryRepo, 'appendIntent'> & IntentHistoryApi;

export type OpenLearningMemoryRepoOptions = Omit<OpenMemoryRepoOptions, 'rules'> & { rules: LearningRulesApi };
export type LearningMemoryRepo = Omit<MemoryRepoWithIntents, 'appendContribution' | 'listContributions' | 'regenerateCard'> & {
  appendContribution(c: LearningContribution, meta: WriteMeta): Promise<CommitRef>;
  listContributions(): Promise<LearningContribution[]>;
  regenerateCard(merge: LearningMergeOptions, meta: WriteMeta): Promise<{ card: LearningCard; commit: CommitRef }>;
};
