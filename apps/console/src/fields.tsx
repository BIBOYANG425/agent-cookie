// Labels improve readability; they are not an allow-list. Render every returned key.
const labels = new Map<string, string>([
  ['lang', '语言'], ['tone', '说话方式'], ['length', '回复长度'], ['shoe_size', '鞋码'],
  ['budget', '预算'], ['deadline', '时间要求'], ['shipping_address', '收货地址'],
  ['payment_method', '支付方式引用'],
]);

export function fieldName(field: string): string {
  const label = labels.get(field);
  return label ? `${label}（${field}）` : field;
}

export function FieldName({ field }: { field: string }) {
  const label = labels.get(field);
  return <>{label && <span className="field-label">{label} </span>}<code className="field-key">{field}</code></>;
}
