// B proposal seam until A freezes Observation and learning control contracts.
// Not enabled by default. The backend owns identity, generations and promotion.
export interface LearningBinding { observations: string; status: string; control: string }
export const PROPOSED_LEARNING_BINDING: LearningBinding = Object.freeze({
  observations:'/personal/observations',status:'/personal/learning',control:'/personal/learning',
});
export interface ObservationInput {
  source:'photon'|'mcp'|'claude-code'; messageId:string; conversationId:string; occurredAt:string; text:string;
}
export interface ObserveResult {accepted:boolean;observationId?:string;reason?:string}
export interface LearnedPreference {
  id:string;key:string;value:string;evidence:string;basis:'stated'|'observed'|'inferred';
  status:'candidate'|'confirmed';updatedAt:string;
}
export interface LearningState {enabled:boolean;generation:number;learned:LearnedPreference[]}
export interface LearningControl {enabled?:boolean;forgetKeys?:string[]}
export interface LearningControlResult {enabled:boolean;generation:number;forgottenKeys:string[]}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const str=(v:unknown,max:number):v is string=>typeof v==='string'&&!!v.trim()&&Array.from(v).length<=max;
const date=(v:unknown)=>str(v,40)&&Number.isFinite(Date.parse(v));
const key=(v:unknown):v is string=>str(v,100)&&/^pref\.[a-z_]+$/.test(v);
const generation=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0;
const invalid=()=>new Error('Invalid learning payload.');
export function validateBinding(binding:LearningBinding):LearningBinding {
  if(!binding || ![binding.observations,binding.status,binding.control].every(p=>typeof p==='string'&&/^\/personal\/[a-z][a-z/-]*$/.test(p)&&!p.includes('//'))) throw invalid();
  return {...binding};
}
export function observationBody(v:ObservationInput):ObservationInput {
  if(!v||!['photon','mcp','claude-code'].includes(v.source)||!str(v.text,4000)||!date(v.occurredAt)
    ||![v.messageId,v.conversationId].every(x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(x))) throw invalid();
  return {source:v.source,messageId:v.messageId,conversationId:v.conversationId,occurredAt:v.occurredAt,text:v.text};
}
export function observeResult(v:unknown):ObserveResult {
  if(!obj(v)||typeof v.accepted!=='boolean'||(v.observationId!==undefined&&!str(v.observationId,128))
    ||(v.reason!==undefined&&(!str(v.reason,64)||!/^[A-Za-z0-9_-]+$/.test(v.reason)))) throw invalid();
  return {accepted:v.accepted,...(v.observationId?{observationId:v.observationId as string}:{}),...(v.reason?{reason:v.reason as string}:{})};
}
export function learningState(v:unknown):LearningState {
  if(!obj(v)||typeof v.enabled!=='boolean'||!generation(v.generation)||!Array.isArray(v.learned)||v.learned.length>200
    ||!v.learned.every(p=>obj(p)&&str(p.id,128)&&key(p.key)&&str(p.value,200)&&str(p.evidence,200)
      &&['stated','observed','inferred'].includes(String(p.basis))&&['candidate','confirmed'].includes(String(p.status))&&date(p.updatedAt))) throw invalid();
  return {enabled:v.enabled,generation:v.generation as number,learned:v.learned.map(p=>({id:p.id,key:p.key,value:p.value,evidence:p.evidence,basis:p.basis,status:p.status,updatedAt:p.updatedAt}))};
}
export function controlBody(v:LearningControl):LearningControl {
  if(!v||(v.enabled===undefined&&v.forgetKeys===undefined)||(v.enabled!==undefined&&typeof v.enabled!=='boolean')
    ||(v.forgetKeys!==undefined&&(!Array.isArray(v.forgetKeys)||!v.forgetKeys.length||v.forgetKeys.length>100||!v.forgetKeys.every(key)))) throw invalid();
  return {...(v.enabled===undefined?{}:{enabled:v.enabled}),...(v.forgetKeys===undefined?{}:{forgetKeys:[...new Set(v.forgetKeys)]})};
}
export function controlResult(v:unknown):LearningControlResult {
  if(!obj(v)||typeof v.enabled!=='boolean'||!generation(v.generation)||!Array.isArray(v.forgottenKeys)||!v.forgottenKeys.every(key)) throw invalid();
  return {enabled:v.enabled,generation:v.generation as number,forgottenKeys:v.forgottenKeys};
}
