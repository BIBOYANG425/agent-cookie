import { OBSERVATION_MAX_TURNS, OBSERVATION_TURN_MAX_CHARS, EVIDENCE_SNIPPET_MAX, EVIDENCE_MODEL_ID_MAX, isPrefField, type ForgetLearningInput, type ForgetLearningResult, type Observation, type LearningState, type LearnedResponse } from '@agent-cookie/contract';
export type {ForgetLearningInput,ForgetLearningResult,Observation,ObservationTurn,LearningState,LearnedResponse,LearnedEntry,EvidenceModels} from '@agent-cookie/contract';
export type ObservationInput=Observation;
export interface ObserveResult {queued:boolean;paused?:true;duplicate?:true}
/** UI convenience; wire is PUT {paused: !enabled}, per A 0129f08. */
export interface LearningControl {enabled:boolean}
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const str=(v:unknown,max:number):v is string=>typeof v==='string'&&!!v.trim()&&Array.from(v).length<=max;
const date=(v:unknown)=>str(v,40)&&Number.isFinite(Date.parse(v));
const invalid=()=>new Error('Invalid learning payload.');
const modelsValid=(v:unknown)=>obj(v)&&Object.entries(v).every(([k,id])=>['gate','extractor'].includes(k)
  &&str(id,EVIDENCE_MODEL_ID_MAX)&&/^[A-Za-z0-9._:/@-]+$/.test(id));
export function observationBody(v:Observation):Observation {
  if(!v||!str(v.channel,64)||!str(v.conversationId,128)||!Array.isArray(v.turns)||!v.turns.length||v.turns.length>OBSERVATION_MAX_TURNS
    ||!v.turns.every(t=>obj(t)&&['user','agent','other'].includes(String(t.role))&&typeof t.text==='string'&&Array.from(t.text).length<=OBSERVATION_TURN_MAX_CHARS&&date(t.at)&&(t.messageId===undefined||str(t.messageId,128))))throw invalid();
  return {channel:v.channel,conversationId:v.conversationId,turns:v.turns.map(t=>({role:t.role,text:t.text,at:t.at,...(t.messageId?{messageId:t.messageId}:{})}))};
}
export function observeResult(v:unknown):ObserveResult {
  if(!obj(v)||typeof v.queued!=='boolean'||(v.paused!==undefined&&v.paused!==true)||(v.duplicate!==undefined&&v.duplicate!==true))throw invalid();
  return {queued:v.queued,...(v.paused===true?{paused:true}:{}),...(v.duplicate===true?{duplicate:true}:{})};
}
export function learningState(v:unknown):LearningState {
  if(!obj(v)||typeof v.paused!=='boolean')throw invalid();return {paused:v.paused};
}
export function learnedResponse(v:unknown):LearnedResponse {
  if(!obj(v)||typeof v.paused!=='boolean'||!Array.isArray(v.learned)||v.learned.length>200
    ||!v.learned.every(p=>obj(p)&&isPrefField(p.field)&&str(p.value,200)&&['card','candidate'].includes(String(p.status))
      &&Array.isArray(p.sources)&&p.sources.every(s=>str(s,200))&&Array.isArray(p.evidence)&&p.evidence.every(e=>obj(e)
        &&str(e.contributionId,200)&&str(e.agentId,200)&&['stated','observed','inferred'].includes(String(e.basis))&&date(e.createdAt)
        &&(e.snippet===undefined||str(e.snippet,EVIDENCE_SNIPPET_MAX))&&(e.conversationId===undefined||str(e.conversationId,128))
        &&(e.intentId===undefined||str(e.intentId,200))&&(e.models===undefined||modelsValid(e.models)))))throw invalid();
  // Return only the contract projection, not unrecognized raw transcript fields.
  return {paused:v.paused,learned:v.learned.map(p=>({field:p.field,value:p.value,status:p.status,sources:[...p.sources],
    evidence:p.evidence.map((e:Record<string,unknown>)=>({...Object.fromEntries(Object.entries(e).filter(([k])=>['contributionId','agentId','basis','createdAt','snippet','intentId','conversationId'].includes(k))),
      ...(e.models?{models:{...e.models as Record<string,string>}}:{})}))}))} as LearnedResponse;
}
export function controlBody(v:LearningControl):LearningState {
  if(!v||typeof v.enabled!=='boolean'||Object.keys(v).some(k=>k!=='enabled'))throw invalid();return {paused:!v.enabled};
}

export function forgetBody(input:ForgetLearningInput):ForgetLearningInput {
  if(!obj(input)||Object.keys(input).length!==1||!isPrefField(input.field))throw invalid();
  return {field:input.field};
}
export function forgetResult(value:unknown):ForgetLearningResult {
  if(!obj(value)||!isPrefField(value.field)||value.paused!==true||value.historyErased!==false
    ||typeof value.removed!=='number'||!Number.isSafeInteger(value.removed)||value.removed<0
    ||!['complete','pending'].includes(String(value.projection)))throw invalid();
  return {field:value.field,paused:true,removed:value.removed,projection:value.projection as 'complete'|'pending',historyErased:false};
}
