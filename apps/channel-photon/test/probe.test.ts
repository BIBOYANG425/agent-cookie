import { describe, expect, it, vi } from 'vitest';
import { configurationReport, readConfig } from '../src/config.js';
import { matchPing, ProbeFailure, runProbe, type ProbePort } from '../src/probe.js';
import { runLocalDemo, sampleConfig, samplePing } from '../src/sample.js';

const time = Date.parse('2026-10-17T19:00:00Z');
const ping = () => samplePing(new Date(time).toISOString());

describe('message eligibility', () => {
  it('uses the receiving agent and incoming conversation, not phone strings, for replies', () => {
    expect(matchPing(ping(), sampleConfig, time, time)).toEqual({
      messageId: 'sample-message', spaceId: 'sample-space', agentId: 'sample-agent',
    });
  });
  it.each(['other-human', 'wrong-agent', 'group', 'outbound', 'same-user', 'old', 'future', 'invalid-date', 'email', 'rich-text', 'non-ping', 'missing-space'])(
    'does not reply to %s', condition => {
      const message = ping();
      switch (condition) {
        case 'other-human': message.sentBy.handle = '+15550109999'; break;
        case 'wrong-agent': message.receivedBy.handle = '+15550109999'; break;
        case 'group': message.space.kind = 'group'; break;
        case 'outbound': message.status = 'sent'; break;
        case 'same-user': message.sentBy.id = message.receivedBy.id; break;
        case 'old': message.createdAt = new Date(time - 1).toISOString(); break;
        case 'future': message.createdAt = new Date(time + 1).toISOString(); break;
        case 'invalid-date': message.createdAt = 'not-a-date'; break;
        case 'email': message.sentBy.platform = 'email'; break;
        case 'rich-text': message.content.format = 'markdown'; break;
        case 'non-ping': message.content.text = 'ping and buy shoes'; break;
        case 'missing-space': message.space.id = ''; break;
      }
      expect(matchPing(message, sampleConfig, time, time)).toBeUndefined();
    },
  );
  it.each([null, {}, [], 'ping', 3])('rejects malformed payload %j', value => {
    expect(matchPing(value, sampleConfig, time, time)).toBeUndefined();
  });
});

describe('bounded probe', () => {
  it('observes a message without sending by default', async () => {
    const send = vi.fn();
    const result = await runProbe(sampleConfig, { list: async () => ({ items: [ping()] }), send }, { sendReply: false, now: () => time });
    expect(result).toEqual({ status: 'received', deliveryConfirmed: false });
    expect(send).not.toHaveBeenCalled();
  });
  it('sends once for duplicate input with a stable idempotency key', async () => {
    const send = vi.fn(async () => {});
    const result = await runProbe(sampleConfig, { list: async () => ({ items: [ping(), ping()] }), send }, { sendReply: true, now: () => time });
    expect(result).toEqual({ status: 'accepted', deliveryConfirmed: false });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]).toEqual([
      { messageId: 'sample-message', spaceId: 'sample-space', agentId: 'sample-agent' },
      'agent-cookie-smoke:sample-message', expect.any(AbortSignal),
    ]);
  });
  it('paginates and stops after the first eligible message', async () => {
    const tokens: Array<string | undefined> = [];
    const result = await runProbe(sampleConfig, {
      list: async ({ pageToken }) => { tokens.push(pageToken); return pageToken ? { items: [ping()] } : { items: [], nextPageToken: 'page-2' }; },
      send: async () => {},
    }, { sendReply: false, now: () => time });
    expect(tokens).toEqual([undefined, 'page-2']);
    expect(result.status).toBe('received');
  });
  it('stops at the deadline without sending stale messages', async () => {
    let clock = time;
    const list = vi.fn(async () => ({ items: [samplePing(new Date(time - 1).toISOString())] }));
    const send = vi.fn();
    const result = await runProbe(sampleConfig, { list, send }, {
      sendReply: true, timeoutMs: 5_000, now: () => clock, wait: async ms => { clock += ms; },
    });
    expect(result.status).toBe('timeout');
    expect(list).toHaveBeenCalledTimes(3);
    expect(send).not.toHaveBeenCalled();
  });
  it('does not automatically resend after an uncertain send failure', async () => {
    const send = vi.fn(async () => { throw new Error('credential + contact details'); });
    await expect(runProbe(sampleConfig, { list: async () => ({ items: [ping()] }), send }, { sendReply: true, now: () => time }))
      .rejects.toEqual(new ProbeFailure('SEND_OUTCOME_UNKNOWN'));
    expect(send).toHaveBeenCalledTimes(1);
  });
  it('stops on an API error instead of increasing polling or exposing raw data', async () => {
    const list = vi.fn(async () => { throw new Error('429 with sensitive details'); });
    const port: ProbePort = { list, send: async () => {} };
    await expect(runProbe(sampleConfig, port, { sendReply: true, now: () => time })).rejects.toEqual(new ProbeFailure('READ_FAILED'));
    expect(list).toHaveBeenCalledTimes(1);
  });
  it('stops a repeating pagination cursor', async () => {
    const list = vi.fn(async () => ({ items: [], nextPageToken: 'loop' }));
    await expect(runProbe(sampleConfig, { list, send: async () => {} }, { sendReply: false, now: () => time })).rejects.toEqual(new ProbeFailure('PAGINATION_LIMIT'));
    expect(list).toHaveBeenCalledTimes(2);
  });
  it('never sends if a response arrives after the time limit', async () => {
    let clock = time;
    const send = vi.fn();
    const result = await runProbe(sampleConfig, { list: async () => { clock += 10_000; return { items: [ping()] }; }, send }, { sendReply: true, timeoutMs: 5_000, now: () => clock });
    expect(result.status).toBe('timeout');
    expect(send).not.toHaveBeenCalled();
  });
  it('labels the offline example as Sample with zero external traffic', async () => {
    expect(await runLocalDemo()).toMatchObject({ mode: 'Sample', externalCalls: 0, outboundMessages: 0, deliveryConfirmed: false });
  });
});

describe('configuration', () => {
  it('reports missing variable names without credentials', () => {
    const report = configurationReport({ PHOTON_API_KEY: 'do-not-print-this' });
    expect(report.valid).toBe(false);
    expect(report.missing).toContain('PHOTON_PROJECT_ID');
    expect(JSON.stringify(report)).not.toContain('do-not-print-this');
    expect(() => readConfig({})).toThrow('PHOTON_API_KEY');
  });
});
