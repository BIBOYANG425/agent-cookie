import { t } from './i18n';
import type { Field } from '../../../packages/contract/src/types';

// Labels improve readability; they are not an allow-list. Render every returned key.
const contractLabels = {
  get lang() { return t("language"); }, get tone() { return t("tone"); }, get length() { return t("responseLength"); }, get shoe_size() { return t("usualSize"); },
  get budget() { return t("budget"); }, get deadline() { return t("deadline"); }, get shipping_address() { return t("shippingAddress"); }, get payment_method() { return t("paymentMethodReference"); },
  get 'pref.brand'() { return t("brandPreference"); }, get 'pref.color'() { return t("colorPreference"); }, get 'pref.material'() { return t("materialPreference"); },
  get 'pref.style'() { return t("stylePreference"); }, get 'pref.fit'() { return t("fitPreference"); }, get 'pref.avoid'() { return t("avoid"); },
  get 'pref.occasion'() { return t("occasion"); }, get 'pref.recipient'() { return t("recipient"); }, get 'pref.price_band'() { return t("pricePreference"); },
  get 'pref.size_system'() { return t("sizeSystem"); },
} satisfies Record<Field, string>;
const labelFor = (field: string) => Object.hasOwn(contractLabels, field) ? contractLabels[field as Field] : undefined;

export function fieldName(field: string): string {
  const label = labelFor(field);
  return label ? `${label}（${field}）` : field;
}

export function FieldName({ field }: { field: string }) {
  const label = labelFor(field);
  return <>{label && <span className="field-label">{label} </span>}<code className="field-key">{field}</code></>;
}
