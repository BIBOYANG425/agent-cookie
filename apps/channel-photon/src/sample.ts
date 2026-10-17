import type { PhotonConfig } from './config.js';
import { runProbe } from './probe.js';

export const sampleConfig: PhotonConfig = {
  apiKey: 'SAMPLE_NOT_A_CREDENTIAL', projectId: 'SAMPLE_PROJECT',
  testSender: '+15550100001', agentHandle: '+15550100002',
};

export function samplePing(createdAt: string) {
  return {
    id: 'sample-message', platform: 'imessage', status: 'received', createdAt,
    sentBy: { id: 'sample-human', kind: 'human', platform: 'imessage', handle: sampleConfig.testSender },
    receivedBy: { id: 'sample-agent', kind: 'agent', platform: 'imessage', handle: sampleConfig.agentHandle },
    space: { id: 'sample-space', kind: 'direct', platform: 'imessage' },
    content: { type: 'text', format: 'plain', text: 'ping' },
  };
}

export async function runLocalDemo() {
  const time = Date.parse('2026-10-17T19:00:00Z');
  const result = await runProbe(sampleConfig, {
    list: async () => ({ items: [samplePing(new Date(time).toISOString())] }),
    send: async () => { throw new Error('Offline sample cannot send.'); },
  }, { sendReply: false, now: () => time });
  return { mode: 'Sample', externalCalls: 0, outboundMessages: 0, ...result };
}
