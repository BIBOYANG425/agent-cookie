// Evidence assertions over HTTP responses / explicitly supplied catalog observations.
// No workspace implementation, storage, SDK or catalog fixture imports.
import assert from 'node:assert/strict';

const autoFields = ['lang', 'tone', 'length', 'shoe_size', 'budget', 'deadline'];
export function effectiveAutoFields(
  response: { card: Array<{ field: string; value: string }> },
  intentPublic: Record<string, string>,
): Record<string, string> {
  const values = Object.fromEntries(response.card.filter(row => autoFields.includes(row.field)).map(row => [row.field, row.value]));
  for (const field of autoFields) {
    if (intentPublic[field]) values[field] = intentPublic[field];
  }
  return values;
}

export function assertAtMostTwoMerchants(merchantIds: readonly string[]): void {
  assert(merchantIds.every(id => typeof id === 'string' && id.trim()), 'merchant identity must be known');
  assert(new Set(merchantIds).size <= 2, 'result must contain at most two merchants');
}

export function budgetInCents(budget: string): number {
  assert(/^\d+(?:\.\d{1,2})?$/.test(budget), 'budget must be a nonnegative decimal with at most two places');
  const [whole, fraction = ''] = budget.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  assert(Number.isSafeInteger(cents), 'budget cents must be a safe integer');
  return cents;
}

export function assertQuotesWithinBudget(
  quotes: ReadonlyArray<{ price: number | null; currency: string | null }>,
  budget: string,
  currency: string,
): void {
  const ceiling = budgetInCents(budget);
  for (const quote of quotes) {
    assert(quote.price !== null && Number.isSafeInteger(quote.price) && quote.price >= 0, 'quote price is unknown or not integer cents');
    assert(quote.currency === currency, 'quote currency must match the budget; no implicit conversion');
    assert(quote.price <= ceiling, 'quote exceeds this intent budget');
  }
}

// The current Quote wire type has no size/mismatch field. Callers must supply real
// catalog size labels and the actual user-visible explanation, never invented metadata.
// Different sizing systems are not silently converted or declared equivalent.
export function assertSizeMismatchExplained(requestedSize: string, catalogSizes: readonly string[], explanation: string): void {
  assert(requestedSize.trim(), 'requested size must come from this intent or current card');
  assert(catalogSizes.every(size => size.trim()), 'catalog size labels must be explicit');
  if (catalogSizes.includes(requestedSize)) return;
  assert(explanation.trim(), 'size mismatch or unverified sizing requires a user-visible explanation');
  assert(explanation.includes(requestedSize), 'explanation must identify the requested size');
  if (catalogSizes.length) assert(catalogSizes.some(size => explanation.includes(size)), 'explanation must identify an actual catalog size');
}
