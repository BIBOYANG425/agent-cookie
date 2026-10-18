import type { Field } from '../../../packages/contract/src/types';

// Labels improve readability; they are not an allow-list. Render every returned key.
const contractLabels = {
  lang: '语言', tone: '说话方式', length: '回复长度', shoe_size: '常用尺码',
  budget: '预算', deadline: '时间要求', shipping_address: '收货地址', payment_method: '支付方式引用',
  'pref.brand': '品牌偏好', 'pref.color': '颜色偏好', 'pref.material': '材质偏好',
  'pref.style': '风格偏好', 'pref.fit': '合身偏好', 'pref.avoid': '避开这些',
  'pref.occasion': '使用场合', 'pref.recipient': '购买对象', 'pref.price_band': '价位偏好',
  'pref.size_system': '尺码体系',
} satisfies Record<Field, string>;
const labels = new Map<string, string>(Object.entries(contractLabels));

export function fieldName(field: string): string {
  const label = labels.get(field);
  return label ? `${label}（${field}）` : field;
}

export function FieldName({ field }: { field: string }) {
  const label = labels.get(field);
  return <>{label && <span className="field-label">{label} </span>}<code className="field-key">{field}</code></>;
}
