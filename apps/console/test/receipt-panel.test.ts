import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { FIELDS, type Receipt } from '../../../packages/contract/src/types';
import { ReceiptPanel } from '../src/ReceiptPanel';

const receipt: Receipt = { id: 'r-1', sessionId: 'session-1', agentId: 'Sample Storefront A', fields: [...FIELDS], purpose: 'handshake', createdAt: '2026-10-17T10:00:00Z' };
const render = (receipts?: readonly Receipt[] | null) => renderToStaticMarkup(createElement(ReceiptPanel, { receipts }));

it('renders all contract fields as names, with reader, purpose and time', () => {
  const html = render([{ ...receipt, values: { budget: 'unexpected-field-value' } } as Receipt]);
  for (const field of FIELDS) expect(html).toContain(`<code class="field-key">${field}</code>`);
  expect(html).toContain('Sample Storefront A');
  expect(html).toContain('handshake');
  expect(html).toContain('dateTime="2026-10-17T10:00:00Z"');
  expect(html).toContain('r-1');
  expect(html).not.toContain('unexpected-field-value');
});

it('orders receipts newest first, escapes display text and tolerates no fields', () => {
  const html = render([receipt, { ...receipt, id: 'newer', agentId: '<script>reader</script>', purpose: '<img src=x>', fields: [], createdAt: '2026-10-17T11:00:00Z' }]);
  expect(html.indexOf('newer')).toBeLessThan(html.indexOf('r-1'));
  expect(html).toContain('&lt;script&gt;reader&lt;/script&gt;');
  expect(html).toContain('&lt;img src=x&gt;');
  expect(html).not.toContain('<script>');
  expect(html).toContain('无字段');
});

it('distinguishes pending, unavailable and successful empty reads', () => {
  expect(render()).toContain('读取后显示回执');
  expect(render(null)).toContain('暂时无法读取');
  expect(render(null)).not.toContain('还没有读取回执');
  expect(render([])).toContain('还没有读取回执');
});
