import { describe, expect, it } from 'vitest';
import {
  assertAtMostTwoMerchants, assertQuotesWithinBudget, assertSizeMismatchExplained,
  effectiveAutoFields,
} from './properties.js';

// Controlled inputs exercise the evidence checks; they are not a product budget or size.
describe('可复用结果性质检查 · 无工作台或真实 UCP 成功声明', () => {
  it('从当前 card 取默认值，本次 intent 的非空 auto 字段优先', () => {
    const card = { card: [{ field: 'shoe_size', value: 'US 8' }, { field: 'budget', value: '73.25' }] };
    expect(effectiveAutoFields(card, { budget: '61.50', shoe_size: '', shipping_address: 'must not leak' }))
      .toEqual({ shoe_size: 'US 8', budget: '61.50' });
    expect(effectiveAutoFields(card, {})).toEqual({ shoe_size: 'US 8', budget: '73.25' });
  });

  it('按商家去重且最多两家；不要求必须找到两家', () => {
    expect(() => assertAtMostTwoMerchants([])).not.toThrow();
    expect(() => assertAtMostTwoMerchants(['sample-a', 'sample-a', 'sample-b'])).not.toThrow();
    expect(() => assertAtMostTwoMerchants(['sample-a', 'sample-b', 'sample-c'])).toThrow(/two/);
  });

  it('比较整数 cents 与本次预算，拒绝超预算、未知价格和不同货币', () => {
    expect(() => assertQuotesWithinBudget([{ price: 6150, currency: 'USD' }], '61.50', 'USD')).not.toThrow();
    expect(() => assertQuotesWithinBudget([{ price: 6151, currency: 'USD' }], '61.50', 'USD')).toThrow(/budget/);
    expect(() => assertQuotesWithinBudget([{ price: null, currency: 'USD' }], '61.50', 'USD')).toThrow(/price/);
    expect(() => assertQuotesWithinBudget([{ price: 6100, currency: 'EUR' }], '61.50', 'USD')).toThrow(/currency/);
    expect(() => assertQuotesWithinBudget([{ price: 1, currency: 'USD' }], '1.005', 'USD')).toThrow(/decimal/);
  });

  it('目录没有当前尺码时需用户可见说明，不推断不同制式尺码等价', () => {
    expect(() => assertSizeMismatchExplained('US 8', ['US 8'], '')).not.toThrow();
    expect(() => assertSizeMismatchExplained('US 8', ['US 9'], 'Requested US 8 is unavailable; catalog has US 9.')).not.toThrow();
    expect(() => assertSizeMismatchExplained('US 8', ['US 9'], '')).toThrow(/explanation/);
    expect(() => assertSizeMismatchExplained('EU 39', ['US 8'], 'Available now.')).toThrow(/requested size/);
    expect(() => assertSizeMismatchExplained('EU 39', ['US 8'], 'EU 39 is not verified; the catalog labels this variant US 8.')).not.toThrow();
  });
});
