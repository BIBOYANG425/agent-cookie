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
it('connects the configured provider through the real learner: Jev Decisions gate, then chat extraction, both on the ZDR route', async () => {
  const text = 'I always prefer black clothing.';
  // B59: lane B's learner asks OpenRouter's Jev Decisions endpoint first (sensitive / stable / which whitelisted key),
  // and only then the open-weight chat model for the value and evidence.
  const decision = { answers: { stable: { type: 'noul', noul: 0.98 }, sensitive: { type: 'noul', noul: 0.01 },
    key: { type: 'choice', choice: 'pref.color', confidence: 1, probabilities: { 'pref.color': 1, none: 0 } } } };
  const completion = { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({
    sensitive: false, stable: true, preferences: [{ key: 'pref.color', value: 'black', evidence: text, basis: 'stated' }],
  }) } }] };
  const fetch = vi.fn(async (url: unknown) => Response.json(String(url).includes('/decisions') ? decision : completion)); vi.stubGlobal('fetch', fetch);
  const runtime = loadLearn(loadConfig({ AGENT_COOKIE_LEARN_PROVIDER: 'openrouter', OPENROUTER_API_KEY: 'test-key' }));
  const context = { channel: 'test', conversationId: 'synthetic' };
  expect(await runtime.api.extractFromConversation([{ role: 'user', text, at: new Date().toISOString() }], context))
    .toEqual([expect.objectContaining({ field: 'pref.color', value: 'black', basis: 'stated' })]);
  expect(fetch).toHaveBeenCalledTimes(2);
  const calls = fetch.mock.calls as unknown as Array<[string, RequestInit]>;
  expect(calls.map(([url]) => url)).toEqual(['https://openrouter.ai/api/alpha/decisions', 'https://openrouter.ai/api/v1/chat/completions']);
  for (const [, init] of calls) {
    const provider = JSON.parse(String(init.body)).provider;
    expect(provider).toMatchObject({ zdr: true, data_collection: 'deny', allow_fallbacks: true });
    expect(provider).not.toHaveProperty('only');
  }
  // a sensitive turn is refused before any model call: still two requests in all
  expect(await runtime.api.extractFromConversation([{ role: 'user', text: 'I have asthma and prefer black.', at: new Date().toISOString() }], context)).toEqual([]);
  expect(fetch).toHaveBeenCalledTimes(2); await runtime.shutdown();
});
it('rejects missing credentials and unsupported routes without a network request', () => {
  expect(() => loadConfig({ AGENT_COOKIE_LEARN_PROVIDER: 'openrouter' })).toThrow('requires its API key');
  expect(() => loadConfig({ AGENT_COOKIE_LEARN_PROVIDER: 'other' })).toThrow('Invalid learning provider');
});
