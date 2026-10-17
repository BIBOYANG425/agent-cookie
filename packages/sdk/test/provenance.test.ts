import { expect, it } from 'vitest';
import { WorkspaceClient } from '../src/index.js';

const connect = (payload: unknown) => new WorkspaceClient({
  baseUrl: 'http://127.0.0.1:4310', key: 'sample-source-test', fetch: async () => Response.json(payload),
});

it.each(['sample', 'fixture', 'live'] as const)('preserves card source %s without requiring a local Sample flag', async source => {
  const card = { source, card: [], candidates: [] };
  expect(await connect(card).getMyCard()).toEqual(source === 'live' ? card : { ...card, sample: true });
});

it.each(['sample', 'fixture', 'live'] as const)('labels a quote list containing source %s', async source => {
  const quotes = [{ id: 'q', intentId: 'i', agentId: 'a', text: 'Trail shoe', price: 10995,
    currency: 'USD', etaDate: null, source }];
  expect(await connect({ quotes }).getQuotes('i')).toEqual({ quotes, sample: source !== 'live' });
});

it('retains provenance when revoking a contribution returns a nested card', async () => {
  const card = { source: 'sample', card: [], candidates: [], superseded: [] };
  expect(await connect({ ok: true, card }).revokeContribution('known-source'))
    .toEqual({ ok: true, card, sample: true });
});
