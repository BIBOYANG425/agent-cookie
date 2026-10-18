import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { FieldName, fieldName } from '../src/fields';
import { FIELDS, PREF_FIELDS } from '../../../packages/contract/src/types';

it('keeps contract keys visible with friendly labels and renders keys without labels', () => {
  for (const [field, label] of [['lang', '语言'], ['length', '回复长度'], ['budget', '预算'], ['deadline', '时间要求']]) {
    const html = renderToStaticMarkup(createElement(FieldName, { field }));
    expect(html).toContain(label);
    expect(html).toContain(`<code class="field-key">${field}</code>`);
    expect(fieldName(field)).toBe(`${label}（${field}）`);
  }
  // Forward-compatible rendering probe, not a new workspace contract field.
  expect(renderToStaticMarkup(createElement(FieldName, { field: 'unlabeled_field' })))
    .toBe('<code class="field-key">unlabeled_field</code>');
  expect(fieldName('unlabeled_field')).toBe('unlabeled_field');
});

it('labels every contract field without hiding its exact key, including preferences', () => {
  for (const field of FIELDS) {
    const html = renderToStaticMarkup(createElement(FieldName, { field }));
    expect(html).toContain('class="field-label"');
    expect(html).toContain(`<code class="field-key">${field}</code>`);
  }
  for (const field of PREF_FIELDS) expect(fieldName(field)).not.toBe(field);
  expect(fieldName('shoe_size')).toBe('常用尺码（shoe_size）');
});

it('escapes unexpected field names while keeping forward-compatible rendering', () => {
  const html = renderToStaticMarkup(createElement(FieldName, { field: 'pref.<img src=x>' }));
  expect(html).toContain('pref.&lt;img src=x&gt;');
  expect(html).not.toContain('<img');
});
