import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPhotonPort } from '../src/photon.js';
import { sampleConfig } from '../src/sample.js';

const { sendMessage } = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock('@photon-ai/api', () => ({
  Photon: class {
    projects = { sendMessage };
  },
}));

afterEach(() => vi.resetAllMocks());

describe('shared iMessage transport', () => {
  it('sends into the incoming conversation without unsupported quoted-reply metadata', async () => {
    // The live shared-line API returns HTTP 409 when parentMessageId is present.
    sendMessage.mockImplementation(async ({ body }) => {
      if ('parentMessageId' in body) throw new Error('SPACE_NOT_SENDABLE');
      return { status: 'dispatched' };
    });
    const signal = AbortSignal.timeout(1_000);
    await expect(createPhotonPort(sampleConfig).send(
      { spaceId: 'sample-space', agentId: 'sample-agent', messageId: 'sample-message' },
      'agent-cookie-smoke:sample-message', signal,
    )).resolves.toBeUndefined();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({
      path: { id: sampleConfig.projectId },
      headers: { 'idempotency-key': 'agent-cookie-smoke:sample-message' },
      body: {
        spaceId: 'sample-space', senderId: 'sample-agent',
        content: { type: 'text', format: 'plain', text: 'Agent Cookie: ping received. This is a channel connection test.' },
      },
    }, { signal });
  });
});
