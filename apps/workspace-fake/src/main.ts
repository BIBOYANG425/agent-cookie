import { resolve } from 'node:path';
import { loadFixtures } from './fixtures.js';
import { createFakeWorkspace } from './server.js';

try {
  if (process.env.AGENT_COOKIE_DEMO !== '1' && process.env.AGENT_COOKIE_TEST !== '1') throw new Error('Demo mode required.');
  const directory = resolve(process.env.AGENT_COOKIE_FIXTURES ?? '../../fixtures');
  const fixtures = await loadFixtures(directory);
  const server = createFakeWorkspace(fixtures, { demo: process.env.AGENT_COOKIE_DEMO === '1' });
  server.on('error', () => { console.error('Sample workspace could not listen on 127.0.0.1:4310.'); process.exitCode = 1; });
  server.listen(4310, '127.0.0.1', () => console.log('Sample workspace ready at http://127.0.0.1:4310. No live merchant calls or payments.'));
  const stop = () => { server.closeAllConnections(); server.close(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
} catch {
  console.error('Sample workspace startup failed. Check AGENT_COOKIE_FIXTURES and the local contract dependency.');
  process.exitCode = 1;
}
