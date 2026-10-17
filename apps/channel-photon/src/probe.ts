import type { PhotonConfig } from './config.js';

export interface ReplyRoute { messageId: string; spaceId: string; agentId: string }
export interface ProbePort {
  list(input: { createdSince: string; pageToken?: string; signal: AbortSignal }): Promise<{ items: unknown[]; nextPageToken?: string }>;
  send(route: ReplyRoute, idempotencyKey: string, signal: AbortSignal): Promise<void>;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}
function identifier(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }

/** Only a fresh, direct, plain-text ping between the configured two identities. */
export function matchPing(value: unknown, config: PhotonConfig, startedAt: number, now: number): ReplyRoute | undefined {
  const message = object(value);
  if (!message || message.platform !== 'imessage' || message.status !== 'received') return;
  const timestamp = typeof message.createdAt === 'string' ? Date.parse(message.createdAt) : NaN;
  if (!Number.isFinite(timestamp) || timestamp < startedAt || timestamp > now) return;
  const sender = object(message.sentBy), recipient = object(message.receivedBy);
  const space = object(message.space), content = object(message.content);
  if (!sender || !recipient || !space || !content) return;
  if ([sender, recipient, space].some(part => part.platform !== 'imessage')) return;
  if (sender.kind !== 'human' || sender.handle !== config.testSender) return;
  if (recipient.kind !== 'agent' || recipient.handle !== config.agentHandle) return;
  if (!identifier(sender.id) || !identifier(recipient.id) || sender.id === recipient.id) return;
  if (space.kind !== 'direct' || !identifier(space.id) || !identifier(message.id)) return;
  if (content.type !== 'text' || content.format !== 'plain' || typeof content.text !== 'string' || content.text.trim() !== 'ping') return;
  return { messageId: message.id, spaceId: space.id, agentId: recipient.id };
}

export class ProbeFailure extends Error {
  constructor(readonly code: 'READ_FAILED' | 'SEND_OUTCOME_UNKNOWN' | 'PAGINATION_LIMIT') {
    super(code);
  }
}

export interface ProbeOptions {
  sendReply: boolean;
  timeoutMs?: number;
  pollMs?: number;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
}

export async function runProbe(config: PhotonConfig, port: ProbePort, options: ProbeOptions) {
  const now = options.now ?? Date.now;
  const wait = options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const timeout = options.timeoutMs ?? 120_000;
  const poll = options.pollMs ?? 2_000;
  if (!(timeout > 0 && timeout <= 120_000 && poll >= 2_000)) throw new Error('Invalid probe timing.');
  const startedAt = now(), deadline = startedAt + timeout;
  const createdSince = new Date(startedAt - 5_000).toISOString();
  const signal = () => AbortSignal.timeout(Math.max(1, Math.min(10_000, deadline - now())));
  while (now() < deadline) {
    let pageToken: string | undefined;
    const visited = new Set<string>();
    for (let pageNumber = 0; now() < deadline; pageNumber++) {
      if (pageNumber >= 20) throw new ProbeFailure('PAGINATION_LIMIT');
      let page: Awaited<ReturnType<ProbePort['list']>>;
      try { page = await port.list({ createdSince, pageToken, signal: signal() }); }
      catch { throw new ProbeFailure('READ_FAILED'); }
      if (now() >= deadline) return { status: 'timeout' as const, deliveryConfirmed: false };
      for (const message of page.items) {
        const route = matchPing(message, config, startedAt, now());
        if (!route) continue;
        if (!options.sendReply) return { status: 'received' as const, deliveryConfirmed: false };
        try { await port.send(route, `agent-cookie-smoke:${route.messageId}`, signal()); }
        catch { throw new ProbeFailure('SEND_OUTCOME_UNKNOWN'); }
        return { status: 'accepted' as const, deliveryConfirmed: false };
      }
      pageToken = page.nextPageToken;
      if (!pageToken) break;
      if (visited.has(pageToken)) throw new ProbeFailure('PAGINATION_LIMIT');
      visited.add(pageToken);
    }
    if (now() + poll >= deadline) return { status: 'timeout' as const, deliveryConfirmed: false };
    await wait(poll);
  }
  return { status: 'timeout' as const, deliveryConfirmed: false };
}
