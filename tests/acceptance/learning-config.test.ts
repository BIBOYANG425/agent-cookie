import { inspect } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { learningHttpConfig } from './learning-config.js';

// Deliberately synthetic markers. No real process environment or endpoint is read.
const urlMarker = 'URL_CONFIGURATION_SENTINEL';
const keyMarker = 'KEY_CONFIGURATION_SENTINEL';
const valid = { AGENT_COOKIE_URL: 'http://127.0.0.1:4318', AGENT_COOKIE_KEY: keyMarker };

function failure(env: Parameters<typeof learningHttpConfig>[0]): unknown {
  try { learningHttpConfig(env); } catch (error) { return error; }
  return undefined;
}
function sanitized(error: unknown, code: string): void {
  expect(error instanceof Error, 'configuration must fail before any HTTP request').toBe(true);
  expect(error instanceof Error && error.message === code, 'only the fixed configuration code may be reported').toBe(true);
  const diagnostic = inspect(error, { showHidden: true, depth: 10 });
  expect(diagnostic.includes(urlMarker), 'URL content must not appear in diagnostics').toBe(false);
  expect(diagnostic.includes(keyMarker), 'credential content must not appear in diagnostics').toBe(false);
  expect(error instanceof Error && ('cause' in error || 'input' in error), 'do not retain the parser exception').toBe(false);
}

afterEach(() => { vi.restoreAllMocks(); });
describe('learning HTTP configuration · no network', () => {
  it('accepts explicit loopback origins without altering the credential', () => {
    for (const origin of ['http://127.0.0.1:4318', 'http://localhost:4318', 'http://[::1]:4318']) {
      const config = learningHttpConfig({ ...valid, AGENT_COOKIE_URL: origin });
      expect(config.base.origin).toBe(origin);
      expect(config.key).toBe(keyMarker);
    }
  });
  it('reports missing settings without exposing the other configured value', () => {
    sanitized(failure({ AGENT_COOKIE_KEY: keyMarker }), 'LEARNING_URL_REQUIRED');
    sanitized(failure({ AGENT_COOKIE_URL: `http://user:${urlMarker}@127.0.0.1` }), 'LEARNING_KEY_REQUIRED');
  });
  it('discards malformed URL parser input, including embedded credentials', () => {
    for (const raw of [`http://user:${urlMarker}@[bad`, `not-a-url-${urlMarker}`]) {
      sanitized(failure({ ...valid, AGENT_COOKIE_URL: raw }), 'INVALID_LEARNING_ORIGIN');
    }
  });
  it('rejects credentials, queries, paths and non-loopback origins without echoing input', () => {
    for (const raw of [`http://user:${urlMarker}@127.0.0.1`, `http://127.0.0.1?key=${urlMarker}`,
      `http://127.0.0.1/#${urlMarker}`, `http://127.0.0.1/${urlMarker}`, `https://127.0.0.1/${urlMarker}`,
      `http://example.invalid/${urlMarker}`]) {
      sanitized(failure({ ...valid, AGENT_COOKIE_URL: raw }), 'INVALID_LEARNING_ORIGIN');
    }
  });
  it('rejects invalid bearer characters before fetch can include them in an error', () => {
    for (const key of [`${keyMarker}\n`, `${keyMarker} bad`, `${keyMarker}中`, '   ']) {
      sanitized(failure({ ...valid, AGENT_COOKIE_KEY: key }), 'INVALID_LEARNING_KEY');
    }
  });
  it('performs no HTTP calls for valid or invalid configuration', () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('NETWORK_FORBIDDEN'));
    learningHttpConfig(valid);
    failure({ ...valid, AGENT_COOKIE_URL: `http://user:${urlMarker}@[bad` });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
