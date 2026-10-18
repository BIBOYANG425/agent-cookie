import {createLearner,createExtractor,getExtractorDefaults,JEV_MODEL,explicitStatement} from '../dist/index.js';
const offline=process.argv.includes('--offline');
const key=offline?'synthetic':process.env.OPENROUTER_API_KEY;
if(!key||/[^\x21-\x7e]/.test(key)){console.log(JSON.stringify({status:'missing_or_invalid_key'}));process.exit(2);}
const calls=[];
const incidental=process.argv.includes('--incidental');
const text=incidental?'Black is the color I choose for my clothes.':'I always prefer black clothing.';
const output={sensitive:false,stable:true,preferences:[{key:'pref.color',value:'black',evidence:text,basis:incidental?'observed':'stated'}]};
const fetcher=async(url,init)=>{
 const started=performance.now();const body=JSON.parse(init.body);
 if(body.provider.zdr!==true||body.provider.data_collection!=='deny'||body.provider.allow_fallbacks!==true||body.provider.only)throw Error('PRIVACY_GUARD');
 const r=offline?Response.json(String(url).includes('/decisions')?{model:JEV_MODEL,answers:{stable:{type:'noul',noul:0.98},sensitive:{type:'noul',noul:0.01},key:{type:'choice',choice:'pref.color',confidence:1,probabilities:{'pref.color':1,none:0}}}}:{choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(output)}}]}):await fetch(url,init);
 const raw=await r.clone().json().catch(()=>({}));
 let validation;try{const parsed=JSON.parse(raw.choices?.[0]?.message?.content);validation={sensitive:parsed.sensitive,stable:parsed.stable,preferences:parsed.preferences?.map(p=>({key:p.key,basis:p.basis,evidenceMatches:text.includes(p.evidence),locallyExplicit:explicitStatement(p.evidence),valueCharacters:p.value?.length,evidenceCharacters:p.evidence?.length}))};}catch{}
 calls.push({validation,model:body.model,status:r.status,elapsedMs:Math.round(performance.now()-started),reportedModel:raw.model,provider:raw.provider,finishReason:raw.choices?.[0]?.finish_reason,contentLength:raw.choices?.[0]?.message?.content?.length,usage:raw.usage,
  ...(raw.answers?{decisions:{stable:raw.answers.stable?.noul,sensitive:raw.answers.sensitive?.noul,key:raw.answers.key?.choice}}:{})});
 return r;
};
const extract=createExtractor({apiKey:key,fetch:fetcher});
const learner=createLearner({policy:{'pref.color':{description:'Preferred clothing colors'}},extract});
const base={messageId:'synthetic',conversationId:'synthetic',occurredAt:new Date().toISOString(),source:'photon',speaker:'owner',isGroup:false};
const start=performance.now();
const sensitive=await learner.learn({...base,text:'I have asthma and prefer black clothing.'});
const group=await learner.learn({...base,text,speaker:'other',isGroup:true});
const filtersPassed=sensitive.preferences.length===0&&group.preferences.length===0&&calls.length===0;
const result=await learner.learn({...base,text});
const extractionPassed=result.preferences.some(p=>p.key==='pref.color'&&/^black$/i.test(p.value)&&p.basis===(incidental?'observed':'stated'));
console.log(JSON.stringify({at:new Date().toISOString(),mode:offline?'synthetic-protocol-fixture':'live-synthetic-input',model:getExtractorDefaults(extract)?.model,classifierModel:JEV_MODEL,filtersPassed,extractionPassed,reason:result.reason,calls,elapsedMs:Math.round(performance.now()-start),extractedFields:result.preferences.map(p=>p.key)},null,2));
if(!filtersPassed||!extractionPassed)process.exitCode=1;
