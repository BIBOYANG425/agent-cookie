import { expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

it('reads and rejects a later read through production stdio, SDK and a local Sample HTTP fixture', async () => {
  const requests: string[] = [];
  let cardReads = 0;
  const sampleCard = { sample: true, card: [
    { field: 'lang', value: 'zh' }, { field: 'tone', value: 'concise' }, { field: 'shoe_size', value: '42' },
  ], candidates: [] };
  const workspace = createServer((request, response) => {
    requests.push(request.url ?? '');
    response.setHeader('Content-Type', 'application/json');
    if (request.headers.authorization !== 'Bearer sample-stdio-key') {
      response.writeHead(401).end(JSON.stringify({ error: { code: 'AUTH_REQUIRED' } }));
    } else if (request.url === '/me') {
      response.end(JSON.stringify({ agentId: 'sample-personal', category: 'personal', role: 'personal' }));
    } else if (request.url === '/personal/card' && ++cardReads === 1) {
      response.end(JSON.stringify(sampleCard));
    } else {
      response.writeHead(403).end(JSON.stringify({ error: { code: 'GRANT_REVOKED', message: 'private-address' } }));
    }
  });
  workspace.listen(0, '127.0.0.1');
  await once(workspace, 'listening');
  const client = new Client({ name: 'stdio-smoke', version: '0.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', fileURLToPath(new URL('../src/main.ts', import.meta.url))],
    env: {
      AGENT_COOKIE_KEY: 'sample-stdio-key',
      AGENT_COOKIE_URL: `http://127.0.0.1:${(workspace.address() as AddressInfo).port}`,
    },
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    stderr: 'pipe',
  });
  let diagnostics = '';
  transport.stderr?.on('data', chunk => { diagnostics += String(chunk); });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: 'get_my_card', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(sampleCard) }]);
    const denied = await client.callTool({ name: 'get_my_card', arguments: {} });
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied)).toContain('GRANT_REVOKED');
    expect(JSON.stringify(denied)).not.toContain('private-address');
    expect(requests).toEqual(['/me', '/personal/card', '/personal/card']);
    expect(diagnostics).toBe('');
  } finally {
    await client.close();
    workspace.closeAllConnections();
    await new Promise<void>((resolve, reject) => workspace.close(error => error ? reject(error) : resolve()));
  }
}, 15_000);
