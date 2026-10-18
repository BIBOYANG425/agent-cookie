import { afterEach, expect, it, vi } from 'vitest';
import { loadLearn } from '../src/adapters.js';
import { loadConfig } from '../src/config.js';

afterEach(() => vi.unstubAllGlobals());
it('does not enable model requests merely because an API key exists', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const runtime = loadLearn(loadConfig({ OPENROUTER_API_KEY: 'test-key' }));
  expect(await runtime.api.extractFromConversation([{ role: 'user', text: 'I always prefer black.', at: new Date().toISOString() }],
    { channel: 'test', conversationId: 'one' })).toEqual([]);
  expect(fetch).not.toHaveBeenCalled(); await runtime.shutdown();
});
it('connects the configured provider through the real learner, keeping filters and the privacy route', async () => {
  const text = 'I always prefer black clothing.';
  const fetch = vi.fn(async () => Response.json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({
    sensitive: false, stable: true, preferences: [{ key: 'pref.color', value: 'black', evidence: text, basis: 'stated' }],
  }) } }] })); vi.stubGlobal('fetch', fetch);
  const runtime = loadLearn(loadConfig({ AGENT_COOKIE_LEARN_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'test-key' }));
  const context = { channel: 'test', conversationId: 'synthetic' };
  expect(await runtime.api.extractFromConversation([{ role: 'user', text, at: new Date().toISOString() }], context))
    .toEqual([expect.objectContaining({ field: 'pref.color', value: 'black', basis: 'stated' })]);
  const call = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(JSON.parse(String(call[1].body)).provider).toMatchObject({ zdr: true, allow_fallbacks: false, data_collection: 'deny' });
  expect(await runtime.api.extractFromConversation([{ role: 'user', text: 'I have asthma and prefer black.', at: new Date().toISOString() }], context)).toEqual([]);
  expect(fetch).toHaveBeenCalledTimes(1); await runtime.shutdown();
});
it('rejects missing credentials and unsupported routes without a network request', () => {
  expect(() => loadConfig({ AGENT_COOKIE_LEARN_PROVIDER: 'openrouter' })).toThrow('requires its API key');
  expect(() => loadConfig({ AGENT_COOKIE_LEARN_PROVIDER: 'other' })).toThrow('Invalid learning provider');
});
