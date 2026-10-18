import {createLearner,createHaikuExtractor,OPENROUTER_HAIKU_MODEL} from '../dist/index.js';

// One synthetic, bounded model request. No workspace writes or real conversations.
const offline=process.argv.includes('--offline');
// Explicit diagnostic only; never weakens retention or switches the model.
const zdrFallback=process.argv.includes('--zdr-fallback');
const apiKey=offline?'synthetic-offline-key':process.env.OPENROUTER_API_KEY;
if(!apiKey||apiKey.trim()!==apiKey||/[^\x21-\x7e]/.test(apiKey)){
  console.log(JSON.stringify({configured:false,status:'missing_or_invalid_key'}));
  process.exit(2);
}
let requests=0;const httpStatuses=[];
const text='I always prefer black clothing.';
const synthetic={sensitive:false,stable:true,preferences:[{key:'pref.color',value:'black',evidence:text,basis:'stated'}]};
const fetcher=async(url,init)=>{
  requests++;
  if(zdrFallback){
    const body=JSON.parse(init.body);
    delete body.provider.only;
    body.provider.allow_fallbacks=true;
    if(body.provider.zdr!==true||body.provider.data_collection!=='deny'||body.provider.require_parameters!==true)throw Error('PRIVACY_GUARD');
    init={...init,body:JSON.stringify(body)};
  }
  const response=offline?Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(synthetic)}}]}):await fetch(url,init);
  httpStatuses.push(response.status);return response;
};
const learner=createLearner({policy:{'pref.color':{description:'Preferred clothing colors'}},mode:'explicit-only',
  extract:createHaikuExtractor({provider:'openrouter',apiKey,fetch:fetcher})});
const base={messageId:'synthetic-check',conversationId:'synthetic-check',occurredAt:new Date().toISOString(),source:'photon',speaker:'owner',isGroup:false};
const started=performance.now();
try{
  const sensitive=await learner.learn({...base,text:'I have asthma, and I prefer black clothing.'});
  const group=await learner.learn({...base,text,speaker:'other',isGroup:true});
  const filtersPassed=sensitive.preferences.length===0&&group.preferences.length===0&&requests===0;
  if(!filtersPassed)throw Error('FILTER_CHECK_FAILED');
  const result=await learner.learn({...base,text});
  const extractionPassed=result.preferences.some(p=>p.key==='pref.color'&&/^black$/i.test(p.value)&&p.basis==='stated');
  console.log(JSON.stringify({mode:offline?'synthetic-protocol-fixture':'live-synthetic-input',model:OPENROUTER_HAIKU_MODEL,
    routing:zdrFallback?'any-zdr-with-fallback':'pinned-zdr',filtersPassed,extractionPassed,reason:result.reason,requests,httpStatuses,elapsedMs:Math.round(performance.now()-started),
    // Deliberately omit model text, credentials, account metadata and raw errors.
    extractedFields:result.preferences.map(p=>p.key)},null,2));
  if(!extractionPassed)process.exitCode=1;
}catch{
  console.log(JSON.stringify({mode:offline?'synthetic-protocol-fixture':'live-synthetic-input',status:'check_failed',requests,httpStatuses}));
  process.exitCode=1;
}
