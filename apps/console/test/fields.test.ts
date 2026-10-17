import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { FieldName, fieldName } from '../src/fields';

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
