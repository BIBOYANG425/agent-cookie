// Synthetic inputs only. No workspace, message replay, card writes or transcript output.
import {createLearner,createExtractor,DEFAULT_LEARNING_POLICY} from '../dist/index.js';
const offline=process.argv.includes('--offline');
const apiKey=offline?'synthetic':process.env.OPENROUTER_API_KEY;
if(!apiKey){console.log(JSON.stringify({status:'missing_key'}));process.exit(2);}
const cases=[
  {id:'garment-stated',text:'我一直更喜欢穿短裤，不太喜欢长裤。',key:'pref.style',basis:'stated'},
  {id:'garment-incidental',text:'挑衣服时我总是先拿短裤，长裤一般放回去。',key:'pref.style',basis:'observed'},
  {id:'sleeve-design',text:'I always prefer sleeveless tops over long-sleeved tops.',key:'pref.style',basis:'stated'},
  {id:'loose-fit',text:'我一直喜欢宽松版型的衣服。',key:'pref.fit',basis:'stated'},
  {id:'unsupported-hobby',text:'我一直更喜欢解数独，而不是下棋。',outcome:'unsupported_preference'},
  {id:'temporary-shopping',text:'今天给我找一条短裤。',outcome:'not_stable'},
  ...['我有哮喘，所以更喜欢短裤。','我因为宗教信仰选择长裤。','我工资不够，但更喜欢短裤。','我妻子喜欢短裤。','我住在洛杉矶，更喜欢短裤。']
    .map((text,i)=>({id:'sensitive-'+i,text,reason:'sensitive',zeroCalls:true})),
  {id:'other-group-speaker',text:'我一直喜欢宽松版型的衣服。',speaker:'other',isGroup:true,reason:'ineligible',zeroCalls:true},
];
const records=[];let accessBlocked=false;
for(const scenario of cases){
  if(accessBlocked)break;
  const calls=[];const started=performance.now();
  const fetcher=async(url,init)=>{
    const body=JSON.parse(init.body);const stage=String(url).includes('/decisions')?'gate':'extractor';
    if(!body.provider.zdr||body.provider.data_collection!=='deny'||!body.provider.allow_fallbacks||body.provider.only)throw Error('PRIVACY_GUARD');
    if(accessBlocked)throw Error('ACCESS_BLOCKED');
    const t=performance.now();
    const r=offline?Response.json(stage==='gate'?{answers:{
      stable:{type:'noul',noul:scenario.outcome==='not_stable'?0.01:0.99},
      sensitive:{type:'noul',noul:0.01},
      key:{type:'choice',choice:scenario.key??'none',confidence:0.99,probabilities:{[scenario.key??'none']:0.99}},
    }}:{choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({sensitive:false,stable:true,
      preferences:[{key:scenario.key,value:scenario.key==='pref.fit'?'宽松':'短款',evidence:scenario.text,basis:scenario.basis}]})}}]}):await fetch(url,init);
    const raw=await r.clone().json().catch(()=>({}));
    calls.push({stage,status:r.status,model:body.model,elapsedMs:Math.round(performance.now()-t),
      ...(typeof raw.usage?.cost==='number'?{cost:raw.usage.cost}:{})});
    if([401,402,403].includes(r.status))accessBlocked=true;
    return r;
  };
  const learner=createLearner({policy:DEFAULT_LEARNING_POLICY,extract:createExtractor({apiKey,fetch:fetcher})});
  const result=await learner.learn({text:scenario.text,source:'photon',speaker:scenario.speaker??'owner',isGroup:scenario.isGroup??false,
    messageId:scenario.id,conversationId:'synthetic-gate-regression',occurredAt:new Date().toISOString()});
  const pass=scenario.key
    ?result.preferences.length===1&&result.preferences[0].key===scenario.key&&result.preferences[0].basis===scenario.basis
      &&result.gate?.outcome==='allow'&&calls.length===2
    :result.preferences.length===0&&(scenario.outcome?result.gate?.outcome===scenario.outcome:result.reason===scenario.reason)
      &&calls.length===(scenario.zeroCalls?0:1);
  records.push({id:scenario.id,pass,reason:result.reason,gate:result.gate,
    fields:result.preferences.map(p=>({key:p.key,basis:p.basis})),calls,elapsedMs:Math.round(performance.now()-started)});
}
console.log(JSON.stringify({at:new Date().toISOString(),mode:offline?'synthetic-protocol-fixtures':'live-models-synthetic-inputs',
  accessBlocked,passed:records.filter(x=>x.pass).length,total:cases.length,executed:records.length,
  cost:records.flatMap(x=>x.calls).reduce((s,c)=>s+(c.cost??0),0),scenarios:records},null,2));
if(accessBlocked||records.some(x=>!x.pass)||records.length!==cases.length)process.exitCode=1;
