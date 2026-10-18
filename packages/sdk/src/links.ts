// Consent links (bring-your-own-agent plan §3): validation of the owner's Link and the assistant's LinkView.
import { LINK_STATUSES, type Link, type LinkStatus, type LinkView } from '@agent-cookie/contract';
import { isObject, jarAccess, validDate, validId } from './core.js';

/** Every LinkStatus, in lifecycle order: the contract's own list. */
export { LINK_STATUSES };
const linkStatus = (v: unknown): v is LinkStatus => (LINK_STATUSES as readonly unknown[]).includes(v);

/**
 * The page where the owner decides, as something a person can open. The contract documents it as an ABSOLUTE URL of
 * the workspace resource: an http(s) URL without credentials. Anything else (a bare path included) → undefined.
 */
function ownerPage(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\x00-\x20\x7f]/.test(value)) return undefined;
  let url: URL;
  try { url = new URL(value); } catch { return undefined; }
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
}

/**
 * POST /assistant/link and GET /assistant/link/:id → LinkView, projected to the contract's keys. `jar` (hosted gateway
 * only) is kept when it is well formed: `url` by the clients' base URL rule (normalised), `key` a bearer key. It is
 * refused on a link that is not approved. A refusal is the fixed "Invalid link response.": never the URL or the key.
 */
export function linkView(payload: unknown): LinkView {
  const url = isObject(payload) ? ownerPage(payload.url) : undefined;
  const jar = isObject(payload) && payload.jar !== undefined ? jarAccess(payload.jar) : undefined;
  if (!isObject(payload) || !validId(payload.id) || !linkStatus(payload.status) || !url || !validDate(payload.expiresAt)
    || (payload.sessionId !== undefined && !validId(payload.sessionId))
    // "Present once approved": an approval without the pairwise session is not one.
    || (payload.status === 'approved' && payload.sessionId === undefined)
    // The jar comes with the approval (and is dropped once the link expires), never before it.
    || (payload.jar !== undefined && (!jar || payload.status !== 'approved'))) throw new Error('Invalid link response.');
  return { id: payload.id, status: payload.status, url, expiresAt: payload.expiresAt,
    ...(payload.sessionId !== undefined ? { sessionId: payload.sessionId } : {}), ...(jar ? { jar } : {}) };
}

/** One row of GET /owner/links (and the answer of approve/decline), projected to the contract's keys; undefined if malformed. */
export function ownerLink(v: unknown): Link | undefined {
  if (!isObject(v) || !validId(v.id) || !validId(v.agentId) || typeof v.agentName !== 'string' || v.agentName.length > 200
    || !linkStatus(v.status) || !validDate(v.createdAt) || !validDate(v.expiresAt)
    || (v.decidedAt !== undefined && !validDate(v.decidedAt)) || (v.sessionId !== undefined && !validId(v.sessionId))) return undefined;
  return { id: v.id, agentId: v.agentId, agentName: v.agentName, status: v.status, createdAt: v.createdAt, expiresAt: v.expiresAt,
    ...(v.decidedAt !== undefined ? { decidedAt: v.decidedAt } : {}), ...(v.sessionId !== undefined ? { sessionId: v.sessionId } : {}) };
}
