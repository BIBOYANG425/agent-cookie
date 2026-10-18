import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { GrantNeeds } from '../src/GrantNeeds';
import type { ActivityEvent, GrantView } from '../src/model';

const grant: GrantView = { id: 'g', sessionId: 'session', agentId: 'merchant-one', agentName: 'Sample · Shop',
  fields: ['lang', 'pref.style'], purpose: 'handshake', createdAt: '2026-10-17T10:00:00Z',
  expiresAt: '2026-10-17T11:00:00Z', remainingMs: 100, status: 'live' };
const event = (id: string, at: string, actor = grant.agentId): ActivityEvent => ({ id, at, actor,
  event: 'merchant.needs', kind: 'needs_declared', object: '5 requested / 4 grantable / 1 denied', result: 'ok', reason: '' });
const render = (g: GrantView, events: ActivityEvent[]) => renderToStaticMarkup(createElement(GrantNeeds, { grant: g, events }));

it('shows the latest declared object for the exact merchant, with unavailable field names', () => {
  const events = [event('older', '2026-10-17T09:00:00Z'),
    { ...event('new', '2026-10-17T10:00:00Z'), object: '3 requested / 2 grantable / 1 denied' },
    { ...event('other', '2026-10-17T12:00:00Z', 'other-merchant'), object: 'PRIVATE OTHER REQUEST' }];
  const html = render({ ...grant, handshake: { unavailable: ['pref.material', 'payment_method'] } }, events);
  expect(html).toContain('3 requested / 2 grantable / 1 denied');
  expect(html).toContain('最近一次申请');
  expect(html).toContain('pref.material');
  expect(html).toContain('unavailable-field');
  expect(html).not.toContain('5 requested');
  expect(html).not.toContain('PRIVATE OTHER REQUEST');
});

it('does not invent a needs declaration from grants, missing kinds or unrelated actors', () => {
  expect(render(grant, [])).toBe('');
  expect(render(grant, [{ ...event('one', '2026-10-17T10:00:00Z'), kind: undefined }])).toBe('');
  expect(render(grant, [event('other', '2026-10-17T10:00:00Z', 'other')])).toBe('');
});

it('tolerates absent or malformed optional handshake metadata and escapes the object', () => {
  const events = [{ ...event('one', '2026-10-17T10:00:00Z'), object: '<script>counts</script>' }];
  expect(render(grant, events)).toContain('&lt;script&gt;');
  expect(render({ ...grant, handshake: { unavailable: 'not-a-list' } } as never, events)).not.toContain('not-a-list');
  expect(render({ ...grant, handshake: { unavailable: ['pref.fit', 12, { field: 'private' }] } } as never, events))
    .not.toContain('private');
});
