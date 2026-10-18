import type { FindInput } from '@agent-cookie/sdk';
import { catalogQuery } from './keywords.js';

/** Extract explicit conditions only. The full sentence remains the query fallback in the workspace. */
export function shoppingInput(text: string): FindInput {
  const conditions: Record<string, string> = {};
  const amount = String.raw`\d+(?:,\d{3})*(?:\.\d{1,2})?`;
  const range = `${amount}(?:\\s*(?:-|–|~|到|至|to)\\s*\\$?${amount})?`;
  // USD is the contract currency. Do not reinterpret another stated currency as dollars.
  if (!/(?:人民币|欧元|英镑|日元|加元|澳元|港币|元|¥|￥|€|£|\b(?:CNY|RMB|EUR|GBP|JPY|CAD|AUD|HKD)\b)/i.test(text.replace(/美元/g, ''))) {
    const budget = new RegExp(`(?:预算\\s*[：:]?\\s*|\\$|under\\s+|budget\\s*(?:of|:)?\\s*)(?<amount>${range})`, 'i').exec(text)?.groups?.amount
      ?? new RegExp(`(?<amount>${range})\\s*(?:美元|美金|刀|USD|dollars?)?\\s*(?:以内|以下|最多|or less)`, 'i').exec(text)?.groups?.amount;
    if (budget) conditions.budget = budget.replace(/,/g, '');
  }
  const size = /(?:尺码|鞋码|\bsize)\s*[：:]?\s*((?:(?:US|EU|UK)\s*)?\d+(?:\.\d+)?|XXXL|XXL|XXS|XL|XS|[SML])(?=$|[\s，,。.;；!！码])/i.exec(text)?.[1]
    ?? /(?:^|[\s，,。;；])((?:(?:US|EU|UK)\s*)?\d+(?:\.\d+)?|XXXL|XXL|XXS|XL|XS|[SML])\s*码/i.exec(text)?.[1]
    ?? /\b(XXXL|XXL|XXS|XL|XS|[SML])\b/.exec(text)?.[1];
  if (size) conditions.size = size;
  const deadline = /(?:下下|下|这|本)?(?:周|星期)[一二三四五六日天](?:之)?前(?:送到|收到|到)?|(?:明天|后天|今天|\d{4}-\d{2}-\d{2})(?:之)?前(?:送到|收到|到)?/u.exec(text)?.[0]
    ?? /\b(?:before|by)\s+(?:(?:next|this)\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|\d{4}-\d{2}-\d{2})\b/i.exec(text)?.[0];
  if (deadline) conditions.deadline = deadline;
  const color = /(?:颜色\s*[：:]?\s*)?((?:黑|白|红|蓝|绿|黄|紫|粉|灰|棕|橙|米|卡其)色)/u.exec(text)?.[1]
    ?? /\b(black|white|red|blue|green|yellow|purple|pink|gray|grey|brown|orange|beige|khaki)\b/i.exec(text)?.[1];
  if (color) conditions.color = color;
  const count = /(?:^|[^\d])([1-5一二两三四五])\s*(?:家|个选项)/u.exec(text)?.[1]
    ?? /\b([1-5])\s+(?:options?|sellers?|merchants?)\b/i.exec(text)?.[1];
  if (count) conditions.count = String(({一:1,二:2,两:2,三:3,四:4,五:5} as Record<string, number>)[count] ?? Number(count));
  const query = catalogQuery(text);
  return { text, ...(query ? {query} : {}), ...(Object.keys(conditions).length ? {public: conditions} : {}) };
}
