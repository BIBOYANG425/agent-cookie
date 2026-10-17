interface LearningEnvironment {
  AGENT_COOKIE_URL?: string;
  AGENT_COOKIE_KEY?: string;
}

/** Pure configuration boundary; never attach raw environment values to failures. */
export function learningHttpConfig(env: LearningEnvironment): { base: URL; key: string } {
  if (!env.AGENT_COOKIE_URL) throw new Error('LEARNING_URL_REQUIRED');
  if (!env.AGENT_COOKIE_KEY) throw new Error('LEARNING_KEY_REQUIRED');
  if (/[^\x21-\x7e]/u.test(env.AGENT_COOKIE_KEY)) throw new Error('INVALID_LEARNING_KEY');
  let base: URL;
  try { base = new URL(env.AGENT_COOKIE_URL); }
  catch {
    // ERR_INVALID_URL carries the complete input, which test reporters serialize.
    throw new Error('INVALID_LEARNING_ORIGIN');
  }
  if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)
    || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
    throw new Error('INVALID_LEARNING_ORIGIN');
  }
  return { base, key: env.AGENT_COOKIE_KEY };
}
