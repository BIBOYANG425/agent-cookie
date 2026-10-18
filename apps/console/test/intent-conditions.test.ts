import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { IntentHistoryEntry } from '../../../packages/contract/src/types';
import { IntentConditionsPanel } from '../src/IntentConditionsPanel';

const intent: IntentHistoryEntry = { id: 'intent-one', agentId: 'personal-agent', query: 'Sample · 找一件轻便外套', public: { budget: '$75', size: 'M', 'pref.material': 'cotton' }, createdAt: '2026-10-17T10:00:00Z', expiresAt: '2026-10-17T11:00:00Z' };
const render = (intents?: readonly IntentHistoryEntry[] | null) => renderToStaticMarkup(createElement(IntentConditionsPanel, { intents }));

it('marks each explicit intent condition as this request without inventing card provenance', () => {
  const html = render([intent]);
  expect(html).toContain('What I need now');
  expect(html.match(/class="intent-scope">This request<\/span>/g)).toHaveLength(3);
  expect(html).toContain('$75');
  expect(html).toContain('>M<');
  expect(html).toContain('pref.material');
  expect(html).toContain('size</code>');
  expect(html).not.toContain('shoe_size');
  expect(html).not.toContain('Access granted');
  expect(html).toContain('do not overwrite your context');
});

it('renders arbitrary public conditions safely and keeps each request separate', () => {
  const html = render([intent, { ...intent, id: 'intent-two', query: '<script>query</script>', public: { color: '<img src=x>' }, createdAt: '2026-10-17T10:01:00Z' }]);
  expect(html.indexOf('intent-two')).toBeLessThan(html.indexOf('intent-one'));
  expect(html).toContain('&lt;script&gt;query&lt;/script&gt;');
  expect(html).toContain('color</code>');
  expect(html).toContain('&lt;img src=x&gt;');
  expect(html).not.toContain('<img');
});

it('does not invent default conditions and distinguishes read failures from empty history', () => {
  const html = render([{ ...intent, public: {} }]);
  expect(html).toContain('No additional conditions were specified');
  expect(html).not.toContain('intent-scope');
  expect(html).not.toContain('shoe_size');
  expect(render()).toContain('Connect to view requests');
  expect(render(null)).toContain('Temporarily unavailable');
  expect(render([])).toContain('No requests yet');
});
