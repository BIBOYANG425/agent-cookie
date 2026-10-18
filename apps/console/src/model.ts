import type { IntentHistoryEntry, Receipt } from '../../../packages/contract/src/types';
// Display models keep field keys open for generic rendering; adapters validate wire responses.
// Card/Contribution/ActivityEvent mirror packages/contract/src/types.ts.
// GrantView projects the HTTP view from apps/workspace/src/services/sessions.ts.
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
  /** Optional on the wire: the policy document that issued the grant, and the funnel stage that opened it. */
  policyId?: string; stage?: import('../../../packages/contract/src/analytics').FunnelStage;
  // TODO(contract): owner-readable handshake projection on the existing grants response.
  handshake?: { unavailable?: string[] };
}
export interface ActivityEvent {
  id: string; at: string; event: string; actor: string; object: string; result: string; reason: string;
  // TODO(contract): needs_declared is optional until A/B publish and preserve the discriminator.
  kind?: string;
}
/** An optional panel's data: a workspace without the endpoint (404/501) or a failed read never blocks the core snapshot. */
export type Section<T> = { availability: 'ready'; data: T; sample?: boolean }
  | { availability: 'unavailable' | 'error'; message: string };
// View state, not a workspace wire response. null means no source-record API exists.
export interface ConsoleSnapshot {
  card: Card; contributions: Contribution[] | null; grants: GrantView[]; events: ActivityEvent[]; receivedAt: number;
  sample?: boolean;
  learning?: import('./learning').LearningState;
  policy?: Section<import('./policy').PolicyView>;
  funnel?: Section<import('./funnel').FunnelReport>;
  experiments?: Section<import('./experiments').ExperimentReport>;
  /** Optional histories: null is a failed or malformed read, distinct from a successful empty list. */
  receipts?: Receipt[] | null;
  intents?: IntentHistoryEntry[] | null;
}
export interface ConsoleAdapter {
  mode: 'sample' | 'live';
  load(signal?: AbortSignal): Promise<ConsoleSnapshot>;
  revokeContribution(id: string, signal?: AbortSignal): Promise<void>;
  revokeGrant(id: string, signal?: AbortSignal): Promise<void>;
  reset(signal?: AbortSignal): Promise<void>;
  setLearning(paused: boolean, signal?: AbortSignal): Promise<void>;
  selectLearningStage?(id: string): Promise<void>;
  /** POST /personal/policy/shadow { policy }. Read-only: nothing changes in the workspace. */
  shadowPolicy(candidate: unknown, signal?: AbortSignal): Promise<import('./policy').ShadowReport>;
  /** PUT /personal/policy. A floor violation rejects with PolicyViolationError and nothing changes. */
  installPolicy(candidate: unknown, signal?: AbortSignal): Promise<import('./policy').PolicyView>;
}
