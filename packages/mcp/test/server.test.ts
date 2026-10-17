import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createPersonalServer, type PersonalWorkspaceBinding } from '../src/server.js';
import { readConfig } from '../src/config.js';

const sampleCard = { sample: true, card: [
  { field: 'lang', value: 'zh' }, { field: 'tone', value: 'concise' }, { field: 'shoe_size', value: '42' },
], candidates: [] };
const closers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(closers.splice(0).map(close => close())); });

async function connect(read: PersonalWorkspaceBinding['getMyCard']) {
  const server = await createPersonalServer({ getAuthenticatedRole: async () => 'personal', getMyCard: read });
  const client = new Client({ name: 'B-lane-test', version: '0.0.0' });
  const [left, right] = InMemoryTransport.createLinkedPair();
  await server.connect(left);
  await client.connect(right);
  closers.push(() => client.close(), () => server.close());
  return client;
}

describe('personal MCP boundary', () => {
  it('exposes only the implemented tool and completes a real MCP protocol call', async () => {
    const client = await connect(async () => sampleCard);
    const list = await client.listTools();
    expect(list.tools.map(t => t.name)).toEqual(['get_my_card']);
    const result = await client.callTool({ name: 'get_my_card', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(sampleCard) }]);
  });
  it('does not expose personal tools for merchant or unknown roles', async () => {
    for (const role of ['merchant', 'owner', 'unknown', '']) {
      await expect(createPersonalServer({ getAuthenticatedRole: async () => role, getMyCard: async () => sampleCard })).rejects.toThrow('personal workspace credential');
    }
  });
  it('reads again on each call and propagates a revoked read without cached data', async () => {
    let calls = 0;
    const client = await connect(async () => {
      if (++calls > 1) throw { code: 'GRANT_REVOKED', message: 'private address + secret key' };
      return sampleCard;
    });
    await client.callTool({ name: 'get_my_card', arguments: {} });
    const denied = await client.callTool({ name: 'get_my_card', arguments: {} });
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied)).toContain('GRANT_REVOKED');
    expect(JSON.stringify(denied)).not.toContain('private address');
    expect(JSON.stringify(denied)).not.toContain('shoe_size');
  });
  it('redacts unknown upstream failures', async () => {
    const client = await connect(async () => { throw new Error('Bearer private-test-key'); });
    const failed = await client.callTool({ name: 'get_my_card', arguments: {} });
    expect(failed.isError).toBe(true);
    expect(JSON.stringify(failed)).toContain('WORKSPACE_UNAVAILABLE');
    expect(JSON.stringify(failed)).not.toContain('private-test-key');
  });
});

describe('workspace configuration', () => {
  it('requires a key and uses the agreed loopback address', () => {
    expect(() => readConfig({})).toThrow('AGENT_COOKIE_KEY');
    expect(readConfig({ AGENT_COOKIE_KEY: 'sample-test-key' }).baseUrl).toBe('http://127.0.0.1:4310');
  });
  it('refuses destinations or embedded credentials outside the local contract', () => {
    for (const url of ['http://remote.example', 'http://user:secret@localhost:4310', 'http://localhost:4310/?key=secret', 'file:///tmp/x', 'not a url']) {
      expect(() => readConfig({ AGENT_COOKIE_KEY: 'sample-test-key', AGENT_COOKIE_URL: url })).toThrow();
    }
  });
});
