import { Photon } from '@photon-ai/api';
import type { PhotonConfig } from './config.js';
import type { ProbePort } from './probe.js';

export function createPhotonPort(config: PhotonConfig): ProbePort {
  const client = new Photon({
    baseUrl: 'https://api.photon.codes',
    headers: { Authorization: `Bearer ${config.apiKey}` },
    timeoutMs: 10_000,
    retry: false,
  });
  return {
    async list({ createdSince, pageToken, signal }) {
      const page = await client.projects.listMessages({
        path: { id: config.projectId },
        query: { platform: 'imessage', direction: 'received', order: 'asc', pageSize: 100, createdSince, ...(pageToken ? { pageToken } : {}) },
      }, { signal });
      return { items: page.items, nextPageToken: page.nextPageToken ?? undefined };
    },
    async send(route, idempotencyKey, signal) {
      await client.projects.sendMessage({
        path: { id: config.projectId },
        headers: { 'idempotency-key': idempotencyKey },
        body: {
          spaceId: route.spaceId,
          senderId: route.agentId,
          parentMessageId: route.messageId,
          content: { type: 'text', format: 'plain', text: 'Agent Cookie: ping received. This is a channel connection test.' },
        },
      }, { signal });
    },
  };
}
