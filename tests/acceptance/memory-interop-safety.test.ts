import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { indexTargets, interopConfig } from './memory-interop.js';

const config = { AGENT_COOKIE_A23_TEST: '1', AGENT_COOKIE_ISOLATED_PROBE: '1',
  AGENT_COOKIE_URL: 'http://127.0.0.1:4332', MEMORY_REPO_PATH: '/private/tmp/sample-a23-memory',
  AGENT_COOKIE_KEY: 'SYNTHETIC_OWNER_KEY', AGENT_COOKIE_PERSONAL_KEY: 'SYNTHETIC_PERSONAL_KEY' };

describe('A23 opt-in and stock-format safety · offline only', () => {
  it('requires both explicit opt-ins and an absolute external-repository configuration', () => {
    expect(interopConfig(config).repo).toBe(config.MEMORY_REPO_PATH);
    for (const change of [{ AGENT_COOKIE_A23_TEST: '0' }, { AGENT_COOKIE_ISOLATED_PROBE: '0' },
      { MEMORY_REPO_PATH: '' }, { MEMORY_REPO_PATH: 'relative-memory' }]) {
      expect(() => interopConfig({ ...config, ...change })).toThrow();
    }
  });
  it('refuses the existing user services and the separately run real-skill instance', () => {
    for (const port of [4310, 5173, 4331]) {
      expect(() => interopConfig({ ...config, AGENT_COOKIE_URL: `http://127.0.0.1:${port}` })).toThrow('A23_DEDICATED_PORT_REQUIRED');
    }
  });
  it('keeps malformed URL and credential values out of diagnostics', () => {
    const marker = 'SYNTHETIC_A23_PRIVATE_CANARY';
    for (const change of [{ AGENT_COOKIE_URL: `http://user:${marker}@[bad` }, { AGENT_COOKIE_PERSONAL_KEY: `${marker}\n` }]) {
      let caught: unknown;
      try { interopConfig({ ...config, ...change }); } catch (error) { caught = error; }
      expect(caught instanceof Error).toBe(true);
      expect(inspect(caught, { showHidden: true, depth: 10 }).includes(marker)).toBe(false);
    }
  });
  it('resolves only Index wiki links from the root, retaining non-Markdown extensions', () => {
    expect(indexTargets('# Memory\n\n## Index\n- [[topics/preference]]\n- [[metrics/query.sql]]\n\n## Later\n[[unrelated]]\n'))
      .toEqual(['topics/preference.md', 'metrics/query.sql']);
  });
  it('rejects absent indexes and links that escape the memory boundary', () => {
    for (const body of ['# Memory', '# Memory\n## Index\n', '## Index\n[[../private]]', '## Index\n[[/private/file]]',
      '## Index\n[[dir\\secret]]', '## Index\n[[note#fragment]]']) expect(() => indexTargets(body)).toThrow();
  });
});
