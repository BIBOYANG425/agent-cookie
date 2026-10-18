// POST /assistant/contributions and POST /agent/contributions share one wire shape: { field, value, basis } in (an
// assistant may add `evidence`), 201 { stored, contribution } out. The workspace filters by the policy document's
// write section and decides how a basis counts, not this SDK.
import type { Basis, Field } from '@agent-cookie/contract';
import { EVIDENCE_SNIPPET_MAX } from '@agent-cookie/contract';
import { fieldName, isObject, text, validDate, validId } from './core.js';

export const BASES = ['observed', 'stated', 'inferred'] as const satisfies readonly Basis[];
/** Longest conversation id accepted in evidence, in UTF-8 bytes (contract AssistantContributionInput). */
const CONVERSATION_ID_MAX_BYTES = 128;

export interface ContributionInput {
  field: Field;
  /** At most 512 UTF-8 bytes. Never a card number (the workspace refuses one). */
  value: string;
  basis: Basis;
}
/**
 * Where a "stated" fact came from: the conversation, and the person's OWN words in it (at most EVIDENCE_SNIPPET_MAX
 * characters, never another party's). The owner sees it next to the value.
 */
export interface ContributionEvidenceInput {
  conversationId: string;
  snippet: string;
}
export type AssistantContributionInput = ContributionInput & { evidence?: ContributionEvidenceInput };
/** The caller's own record as stored; never the user's id. */
export interface AgentContribution {
  id: string;
  agentId: string;
  field: Field;
  value: string;
  basis: Basis;
  createdAt: string;
  /** The evidence the record was stored with, when there was any. */
  evidence?: { conversationId?: string; snippet?: string };
}
export interface ContributionResult {
  /**
   * The basis the workspace stored it with. Different from the one sent when the policy does not let the caller write
   * that field or basis: it is then kept as an "inferred" record that never reaches the card.
   */
  stored: Basis;
  contribution: AgentContribution;
  sample: boolean;
}

const basis = (v: unknown): v is Basis => (BASES as readonly unknown[]).includes(v);
const conversationId = (v: unknown): v is string => validId(v) && text(v, CONVERSATION_ID_MAX_BYTES);
const snippet = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && Array.from(v).length <= EVIDENCE_SNIPPET_MAX;

/** The explicit wire body; validation messages never contain the value or the snippet. */
export function contributionBody(input: AssistantContributionInput, options: { sessionId?: string; evidence?: boolean } = {}): Record<string, unknown> {
  const { sessionId } = options;
  const evidence = isObject(input) ? input.evidence : undefined;
  if (!isObject(input) || !fieldName(input.field) || !text(input.value, 512) || !basis(input.basis)
    || (sessionId !== undefined && !validId(sessionId))
    // Only an assistant's write carries evidence; a merchant's never does.
    || (evidence !== undefined && (!options.evidence || !isObject(evidence) || !conversationId(evidence.conversationId) || !snippet(evidence.snippet)))) {
    throw new Error('Invalid contribution.');
  }
  return { field: input.field, value: input.value, basis: input.basis,
    ...(evidence !== undefined ? { evidence: { conversationId: evidence.conversationId, snippet: evidence.snippet } } : {}),
    ...(sessionId !== undefined ? { sessionId } : {}) };
}

export function contributionResult(payload: unknown): ContributionResult {
  const c = isObject(payload) ? payload.contribution : undefined;
  const e = isObject(c) ? c.evidence : undefined;
  if (!isObject(payload) || !basis(payload.stored) || !isObject(c) || !validId(c.id) || !validId(c.agentId) || !fieldName(c.field)
    || typeof c.value !== 'string' || !basis(c.basis) || !validDate(c.createdAt)
    || (e !== undefined && (!isObject(e) || (e.conversationId !== undefined && typeof e.conversationId !== 'string')
      || (e.snippet !== undefined && typeof e.snippet !== 'string')))) throw new Error('Invalid contribution response.');
  const evidence = isObject(e) && (e.conversationId !== undefined || e.snippet !== undefined)
    ? { ...(e.conversationId !== undefined ? { conversationId: e.conversationId as string } : {}),
      ...(e.snippet !== undefined ? { snippet: e.snippet as string } : {}) } : undefined;
  return { stored: payload.stored, contribution: { id: c.id, agentId: c.agentId, field: c.field as Field, value: c.value, basis: c.basis,
    createdAt: c.createdAt, ...(evidence ? { evidence } : {}) }, sample: payload.sample === true };
}
