import { LINK_TTL_MS, type Link, type LinkStatus } from '../../../packages/contract/src/types';

// Consent links (bring-your-own-agent plan §3): a company assistant asks for a pairwise session and the owner approves
// or declines it here. GET /owner/links → { links: Link[] }; POST /owner/links/:id/approve | decline → Link; 409 when the
// link is no longer pending (decided elsewhere, or expired). Names, ids, statuses and times only: a link carries no
// field value, and approving it never shows one.

export interface LinkList { links: Link[] }
export type LinkDecision = 'approve' | 'decline';

export const LINK_STATUSES: readonly LinkStatus[] = ['pending', 'approved', 'declined', 'expired'];
export const linkStatusLabels: Record<LinkStatus, string> = { pending: '待批准', approved: '已批准', declined: '已拒绝', expired: '已过期' };
export const decisionStatus: Record<LinkDecision, LinkStatus> = { approve: 'approved', decline: 'declined' };
export const decisionLabels: Record<LinkDecision, string> = { approve: '批准连接请求', decline: '拒绝连接请求' };

/** The workspace's 409 (or the Sample adapter's equivalent): the link was already approved, declined or expired. Shown as 已处理. */
export class LinkNotPendingError extends Error {
  constructor() { super('这条连接请求已处理，不在待批准状态。'); }
}

/** Sample only: the agent in fixtures/agents.json (test/links.test.ts checks they match). */
export const SAMPLE_ASSISTANT = { agentId: 'sample-assistant', agentName: 'Sample · Assistant' } as const;
export const SAMPLE_LINK_ID = 'sample-link-assistant';

/** Sample only: one pending link from the Sample assistant, asked for at `now`, with the contract's ten-minute life. */
export function sampleLink(now: number): Link {
  return { id: SAMPLE_LINK_ID, agentId: SAMPLE_ASSISTANT.agentId, agentName: SAMPLE_ASSISTANT.agentName, status: 'pending',
    createdAt: new Date(now).toISOString(), expiresAt: new Date(now + LINK_TTL_MS).toISOString() };
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const malformed = () => new Error('连接请求响应格式与契约不一致。');

/** Copies only the contract's Link keys, so nothing else a response carries can reach the page. Undefined when invalid. */
export function linkRow(row: unknown): Link | undefined {
  if (!object(row) || !text(row.id) || !text(row.agentId) || !text(row.agentName) || !LINK_STATUSES.includes(row.status as LinkStatus)
    || !date(row.createdAt) || !date(row.expiresAt) || (row.decidedAt !== undefined && !date(row.decidedAt))
    || (row.sessionId !== undefined && !text(row.sessionId))) return undefined;
  return { id: row.id, agentId: row.agentId, agentName: row.agentName, status: row.status as LinkStatus,
    createdAt: row.createdAt, expiresAt: row.expiresAt,
    ...(row.decidedAt !== undefined ? { decidedAt: row.decidedAt as string } : {}),
    ...(row.sessionId !== undefined ? { sessionId: row.sessionId as string } : {}) };
}

export function normalizeLinks(body: unknown): LinkList & { sample?: boolean } {
  if (!object(body) || !Array.isArray(body.links)) throw malformed();
  const links: Link[] = [];
  for (const row of body.links) {
    const link = linkRow(row);
    if (!link) throw malformed();
    links.push(link);
  }
  return { links, ...(body.sample === true ? { sample: true } : {}) };
}

/**
 * The acknowledgement of a decision: the same link, now in the decided status; an approval also names the assistant's
 * pairwise session ("set on approval"), since an approval without one is not one. Anything else is not a confirmation.
 */
export function isDecisionAck(body: unknown, id: string, decision: LinkDecision): boolean {
  const link = linkRow(body);
  return !!link && link.id === id && link.status === decisionStatus[decision] && (decision === 'decline' || link.sessionId !== undefined);
}

/** Pending first (they wait on the owner), then newest first; ties keep the workspace's order. */
export function orderLinks(links: readonly Link[]): Link[] {
  return links.map((link, index) => ({ link, index })).sort((a, b) => Number(b.link.status === 'pending') - Number(a.link.status === 'pending')
    || Date.parse(b.link.createdAt) - Date.parse(a.link.createdAt) || a.index - b.index).map(({ link }) => link);
}
