import { SESSION_ID_VECTORS } from '@agent-cookie/contract';
import { describe, expect, it } from 'vitest';
import { deriveSessionId } from '../src/session.js';

describe('RulesApi.deriveSessionId', () => {
  it('matches the four published Crockford lowercase conformance vectors', () => {
    for (const { userSecret, merchantKey, sessionId } of SESSION_ID_VECTORS) {
      const actual = deriveSessionId(userSecret, merchantKey);
      expect(actual).toBe(sessionId);
      expect(actual).toMatch(/^[0-9a-hj-km-np-tv-z]{8}$/);
    }
  });

  it('uses exact UTF-8 inputs deterministically', () => {
    // Independent fixture: Python hmac/sha256 + base64.b32encode, then alphabet translation.
    expect(deriveSessionId('用户钥匙🔐', '商店.example')).toBe('3knw8zpw');
    expect(deriveSessionId('用户钥匙🔐', '商店.example')).toBe('3knw8zpw');
  });

  it('rejects an empty secret or merchant key', () => {
    expect(() => deriveSessionId('', 'shoebacca.com')).toThrow();
    expect(() => deriveSessionId('sample-user-secret-0001', '')).toThrow();
    expect(() => deriveSessionId('', '')).toThrow();
  });
});
