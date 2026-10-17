// TODO(contract): import these wire types from B's SDK when it lands in main.
// Card/Contribution/ActivityEvent: bd9d6e3 packages/contract/src/types.ts.
// GrantView: bd9d6e3 apps/workspace/src/services/sessions.ts.
export interface Contribution {
  id: string; userId: string; agentId: string; field: string; value: string;
  basis: 'observed' | 'stated' | 'inferred'; createdAt: string; revokedAt?: string;
}
export interface CardField {
  field: string; value: string; confidence: 'high' | 'medium'; sources: string[];
  updatedAt: string; lastSupportedAt: string; changedRecently: boolean;
}
export interface Candidate { field: string; value: string; sources: string[]; reason: 'single_source' | 'inferred' }
export interface Superseded { field: string; value: string; sources: string[]; lastSupportedAt: string; supersededBy: string }
export interface Card { card: CardField[]; candidates: Candidate[]; superseded: Superseded[] }
export interface GrantView {
  id: string; sessionId: string; agentId: string; agentName: string; fields: string[]; purpose: string;
  createdAt: string; expiresAt: string; remainingMs: number; revokedAt?: string; status: 'live' | 'expired' | 'revoked';
}
export interface ActivityEvent { id: string; at: string; event: string; actor: string; object: string; result: string; reason: string }
// View state, not a workspace wire response. null means no source-record API exists.
export interface ConsoleSnapshot {
  card: Card; contributions: Contribution[] | null; grants: GrantView[]; events: ActivityEvent[]; receivedAt: number;
  sample?: boolean;
  learning?: import('./learning').LearningState;
}
export interface ConsoleAdapter {
  mode: 'sample' | 'live';
  load(signal?: AbortSignal): Promise<ConsoleSnapshot>;
  revokeContribution(id: string, signal?: AbortSignal): Promise<void>;
  revokeGrant(id: string, signal?: AbortSignal): Promise<void>;
  reset(signal?: AbortSignal): Promise<void>;
  setLearning(enabled: boolean, signal?: AbortSignal): Promise<void>;
  selectLearningStage?(id: string): Promise<void>;
}
