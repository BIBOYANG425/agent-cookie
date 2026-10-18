// Consent links (bring-your-own-agent plan §3): validation of the owner's Link and the assistant's LinkView.
import type { Link, LinkStatus, LinkView } from '@agent-cookie/contract';
import { isObject, validDate, validId } from './core.js';

/** Every LinkStatus, in lifecycle order. */
export const LINK_STATUSES = ['pending', 'approved', 'declined', 'expired'] as const satisfies readonly LinkStatus[];
const linkStatus = (v: unknown): v is LinkStatus => (LINK_STATUSES as readonly unknown[]).includes(v);

/**
 * The page where the owner decides, as something a person can open: an absolute http(s) URL without credentials; a
 * path ("/owner/links/…", the workspace resource) is resolved against the workspace origin. Anything else → undefined.
 */
function ownerPage(value: unknown, origin: string): string | undefined {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\x00-\x20\x7f]/.test(value)) return undefined;
  let url: URL;
  try { url = value.startsWith('/') && !value.startsWith('//') ? new URL(value, origin) : new URL(value); } catch { return undefined; }
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
}

/** POST /assistant/link and GET /assistant/link/:id → LinkView, projected to the contract's keys. */
export function linkView(payload: unknown, origin: string): LinkView {
  const url = isObject(payload) ? ownerPage(payload.url, origin) : undefined;
  if (!isObject(payload) || !validId(payload.id) || !linkStatus(payload.status) || !url || !validDate(payload.expiresAt)
    || (payload.sessionId !== undefined && !validId(payload.sessionId))
    // "Present once approved": an approval without the pairwise session is not one.
    || (payload.status === 'approved' && payload.sessionId === undefined)) throw new Error('Invalid link response.');
  return { id: payload.id, status: payload.status, url, expiresAt: payload.expiresAt,
    ...(payload.sessionId !== undefined ? { sessionId: payload.sessionId } : {}) };
}

/** One row of GET /owner/links (and the answer of approve/decline), projected to the contract's keys; undefined if malformed. */
export function ownerLink(v: unknown): Link | undefined {
  if (!isObject(v) || !validId(v.id) || !validId(v.agentId) || typeof v.agentName !== 'string' || v.agentName.length > 200
    || !linkStatus(v.status) || !validDate(v.createdAt) || !validDate(v.expiresAt)
    || (v.decidedAt !== undefined && !validDate(v.decidedAt)) || (v.sessionId !== undefined && !validId(v.sessionId))) return undefined;
  return { id: v.id, agentId: v.agentId, agentName: v.agentName, status: v.status, createdAt: v.createdAt, expiresAt: v.expiresAt,
    ...(v.decidedAt !== undefined ? { decidedAt: v.decidedAt } : {}), ...(v.sessionId !== undefined ? { sessionId: v.sessionId } : {}) };
}
