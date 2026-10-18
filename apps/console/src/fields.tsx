import type { Field } from '../../../packages/contract/src/types';

// Labels improve readability; they are not an allow-list. Render every returned key.
const contractLabels = {
  lang: 'Language', tone: 'Tone', length: 'Response length', shoe_size: 'Usual size',
  budget: 'Budget', deadline: 'Deadline', shipping_address: 'Shipping address', payment_method: 'Payment reference',
  'pref.brand': 'Preferred brands', 'pref.color': 'Preferred colors', 'pref.material': 'Preferred materials',
  'pref.style': 'Style', 'pref.fit': 'Fit preference', 'pref.avoid': 'Avoid',
  'pref.occasion': 'Occasion', 'pref.recipient': 'Recipient', 'pref.price_band': 'Price range',
  'pref.size_system': 'Size system',
} satisfies Record<Field, string>;
const labels = new Map<string, string>(Object.entries(contractLabels));

export function fieldName(field: string): string {
  const label = labels.get(field);
  return label ? `${label} (${field})` : field;
}

export function FieldName({ field }: { field: string }) {
  const label = labels.get(field);
  return <>{label && <span className="field-label">{label} </span>}<code className="field-key">{field}</code></>;
}
