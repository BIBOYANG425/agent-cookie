// Keys the owner mints for the person's own agents (bring-your-own-agent plan §7): POST/GET /owner/keys and
// POST /owner/keys/:agentId/revoke, plus the personal agent's own stated fact (POST /personal/contributions).
// A minted key is a bearer credential shown once: it is validated like one, returned to the caller, and never put in
// an error message. A listed key row never carries a key; one that does is refused.
import type { Contribution, Field, KeyView, MintKeyRequest, MintKeyResult, PersonalContributionRequest, RevokeKeyResult } from '@agent-cookie/contract';
import { bearerKey, count, fieldName, isObject, text, validDate, validId } from './core.js';

export type { KeyView, MintKeyRequest, MintKeyResult, KeysResponse, PersonalContributionRequest, RevokeKeyResult } from '@agent-cookie/contract';
export type MintedKey = MintKeyResult & { sample: boolean };
export interface KeyList { keys: KeyView[]; sample: boolean }
export type RevokedKeys = RevokeKeyResult & { sample: boolean };
export type PersonalContribution = Contribution & { sample: boolean };

/** MintKeyRequest.agentId: the owner's own name for the agent. */
export const AGENT_ID = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
const ROLES = ['personal', 'merchant'] as const;
const role = (v: unknown): v is MintKeyRequest['role'] => (ROLES as readonly unknown[]).includes(v);
const agentId = (v: unknown): v is string => typeof v === 'string' && AGENT_ID.test(v);
/** 1–200 UTF-8 bytes, not blank, no control characters (it is shown in a terminal and the console). */
const label = (v: unknown): v is string => text(v, 200) && !/[\x00-\x1f\x7f]/.test(v);
/** Properties a listed row must never carry, and the shape of a workspace key (`ck_` + base32) inside any text. */
const SECRET_KEYS = ['key', 'keyHash', 'hash', 'secret', 'token'];
const KEY_LIKE = /ck_[A-Za-z0-9]{16,}/;

/** The MintKeyRequest body; a refusal is the fixed 'Invalid key request.', never the input. */
export function mintKeyBody(input: MintKeyRequest): MintKeyRequest {
  if (!isObject(input) || !agentId(input.agentId) || !role(input.role) || !label(input.label)) throw new Error('Invalid key request.');
  return { agentId: input.agentId, role: input.role, label: input.label };
}

/** 201 MintKeyResult for `request`: the key a bearer key, the rest the request echoed back. Never names the key. */
export function mintedKey(payload: unknown, request: MintKeyRequest): MintedKey {
  if (!isObject(payload) || !bearerKey(payload.key) || payload.agentId !== request.agentId || payload.role !== request.role
    || payload.label !== request.label || !validDate(payload.createdAt)) throw new Error('Invalid key response.');
  return { key: payload.key, agentId: request.agentId, role: request.role, label: request.label, createdAt: payload.createdAt,
    sample: payload.sample === true };
}

/** One KeyView row projected to the contract's keys; undefined when malformed or when it carries anything key-like. */
function keyView(v: unknown): KeyView | undefined {
  if (!isObject(v) || SECRET_KEYS.some(k => Object.hasOwn(v, k))
    || Object.values(v).some(x => typeof x === 'string' && KEY_LIKE.test(x))
    || !agentId(v.agentId) || !role(v.role) || typeof v.label !== 'string' || !v.label || v.label.length > 200
    || !validDate(v.createdAt) || (v.revokedAt !== undefined && !validDate(v.revokedAt))) return undefined;
  return { agentId: v.agentId, role: v.role, label: v.label, createdAt: v.createdAt,
    ...(v.revokedAt !== undefined ? { revokedAt: v.revokedAt } : {}) };
}

export function keyList(payload: unknown): KeyList {
  const keys = isObject(payload) && Array.isArray(payload.keys) ? payload.keys.map(keyView) : undefined;
  if (!isObject(payload) || !keys || !keys.every((k): k is KeyView => k !== undefined)) throw new Error('Invalid keys response.');
  return { keys, sample: payload.sample === true };
}

/** The agentId of a revoke path, checked before sending; the refusal never echoes it. */
export function revokeAgentId(value: string): string {
  if (!agentId(value)) throw new Error('Invalid agent id.');
  return value;
}

export function revokedKeys(payload: unknown): RevokedKeys {
  if (!isObject(payload) || payload.ok !== true || !validDate(payload.revokedAt) || !count(payload.revoked)) {
    throw new Error('Invalid key revocation response.');
  }
  return { ok: true, revokedAt: payload.revokedAt, revoked: payload.revoked, sample: payload.sample === true };
}

/** PersonalContributionRequest: a contract field name and at most 512 UTF-8 bytes. Never echoes the value. */
export function personalContributionBody(input: PersonalContributionRequest): PersonalContributionRequest {
  if (!isObject(input) || !fieldName(input.field) || !text(input.value, 512)) throw new Error('Invalid contribution.');
  return { field: input.field, value: input.value };
}

const BASES = ['observed', 'stated', 'inferred'];
/** 201 Contribution, projected to the contract's keys (a stated fact carries no evidence). */
export function personalContribution(payload: unknown): PersonalContribution {
  const c = payload;
  if (!isObject(c) || !validId(c.id) || !validId(c.userId) || !validId(c.agentId) || !fieldName(c.field) || typeof c.value !== 'string'
    || !BASES.includes(String(c.basis)) || !validDate(c.createdAt) || (c.revokedAt !== undefined && !validDate(c.revokedAt))) {
    throw new Error('Invalid contribution response.');
  }
  return { id: c.id, userId: c.userId, agentId: c.agentId, field: c.field as Field, value: c.value, basis: c.basis as Contribution['basis'],
    createdAt: c.createdAt, ...(c.revokedAt !== undefined ? { revokedAt: c.revokedAt } : {}), sample: c.sample === true };
}
