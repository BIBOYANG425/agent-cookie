import type { LearnedResponse, ForgetLearningInput } from './learning.js';

export const preferenceLabels:Readonly<Record<string,string>>={
  'pref.color':'颜色','pref.material':'材质','pref.fit':'版型','pref.brand':'品牌',
  'pref.style':'风格','pref.avoid':'避开','pref.occasion':'场合','pref.size_system':'尺码体系',
};
const englishPreferenceFields:Readonly<Record<string,string>>={color:'pref.color',colour:'pref.color',material:'pref.material',fit:'pref.fit',brand:'pref.brand',style:'pref.style',avoid:'pref.avoid',occasion:'pref.occasion','size system':'pref.size_system'};
/** Shared by phone controls and HANA: a value match must never widen deletion. */
export function resolveForgetPreference(target:string,rows:LearnedResponse['learned']):
  {kind:'resolved';field:ForgetLearningInput['field']}|{kind:'missing'|'ambiguous'|'partial';label?:string} {
  target=target.trim();
  target=englishPreferenceFields[target.toLowerCase()]??target;
  const fields=[...new Set(rows.filter(p=>p.field===target||preferenceLabels[p.field]===target||p.value===target).map(p=>p.field))];
  if(!fields.length)return {kind:'missing'};
  if(fields.length!==1)return {kind:'ambiguous'};
  const field=fields[0]!;
  if(target!==field&&target!==preferenceLabels[field]&&rows.some(p=>p.field===field&&p.value!==target))
    return {kind:'partial',label:preferenceLabels[field]??field};
  return {kind:'resolved',field};
}
