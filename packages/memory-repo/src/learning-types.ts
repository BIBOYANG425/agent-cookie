import type { CommitRef, ContributionEvidence, Intent, IntentRecord, MemoryRepo, OpenMemoryRepoOptions, Quote, WriteMeta } from '@agent-cookie/contract';
import type { LearningCard, LearningContribution, LearningMergeOptions, LearningRulesApi } from '@agent-cookie/rules';

/** Existing C export name; the flat record is the formal shared type. */
export type WorkspaceIntentRecord = IntentRecord;

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

/** TODO(contract): additive C selector; the shared API currently accepts only a record ID. */
export type ContributionRevocationTarget = import('@agent-cookie/contract').ContributionRevocationTarget;
export interface ContributionRevocationApi {
  revokeContribution(target: ContributionRevocationTarget, revokedAt: string, meta: WriteMeta): Promise<CommitRef>;
}

export type MemoryRepoWithIntents = Omit<MemoryRepo, 'appendIntent' | 'revokeContribution'> & IntentHistoryApi & ContributionRevocationApi;

export type OpenLearningMemoryRepoOptions = Omit<OpenMemoryRepoOptions, 'rules'> & { rules: LearningRulesApi };
export type LearningMemoryRepo = Omit<MemoryRepoWithIntents, 'appendContribution' | 'listContributions' | 'regenerateCard'> & {
  appendContribution(c: LearningContribution, meta: WriteMeta): Promise<CommitRef>;
  listContributions(): Promise<LearningContribution[]>;
  regenerateCard(merge: LearningMergeOptions, meta: WriteMeta): Promise<{ card: LearningCard; commit: CommitRef }>;
};
