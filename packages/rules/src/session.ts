import { createHmac } from 'node:crypto';
import type { RulesApi } from '@agent-cookie/contract';

const CROCKFORD_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

export const deriveSessionId: RulesApi['deriveSessionId'] = (userSecret, merchantKey) => {
  if (userSecret.length === 0 || merchantKey.length === 0) {
    throw new Error('Session derivation requires a nonempty secret and merchant key');
  }

  const digest = createHmac('sha256', Buffer.from(userSecret, 'utf8'))
    .update(merchantKey, 'utf8')
    .digest();

  // Eight base32 characters consume exactly the first 40 digest bits, MSB first.
  const first40Bits = digest.readUIntBE(0, 5);
  let sessionId = '';
  for (let shift = 35; shift >= 0; shift -= 5) {
    sessionId += CROCKFORD_ALPHABET[Math.floor(first40Bits / 2 ** shift) % 32];
  }
  return sessionId;
};
