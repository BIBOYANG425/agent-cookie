// Opt-in cross-lane acceptance probe. Exit 1 means an unmet HUMAN requirement,
// not a passing unit test. All data is synthetic and all storage is disposable.
// Run: pnpm --filter @agent-cookie/sdk exec tsx test/learning-acceptance.check.ts
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {DevKeys,LearnApi} from '@agent-cookie/contract';
import {createApp} from '../../../apps/workspace/src/app.js';
import {loadConfig} from '../../../apps/workspace/src/config.js';
import {createDeps} from '../../../apps/workspace/src/deps.js';
import {createWorkspaceLearner} from '../../learn/src/workspace.js';
import {WorkspaceClient} from '../src/index.js';

const fixtures=fileURLToPath(new URL('../../../fixtures/',import.meta.url));
const keys=JSON.parse(await readFile(join(fixtures,'dev-keys.json'),'utf8')) as DevKeys;
const keyFor=(agent:string)=>Object.keys(keys).find(k=>keys[k].agentId===agent)!;
const stated='I always prefer black clothing.';
const incidental='Black is the color I choose for my clothes.';
const synthetic=(basis:'stated'|'observed')=>createWorkspaceLearner({
  extract:async input=>({sensitive:false,stable:true,preferences:[{key:'pref.color',value:'black',evidence:input.text,basis}]}),
});
const noLearning:LearnApi={extract:async()=>[],extractFromConversation:async()=>[]};
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};};
type Result={name:string;passed:boolean;observed:Record<string,unknown>};
const results:Result[]=[];

async function isolated<T>(learn:LearnApi,run:(h:{
  client:WorkspaceClient;desktop:WorkspaceClient;owner:WorkspaceClient;database:string;
  advance:(offset:number)=>Promise<void>;flush:()=>Promise<void>;settle:()=>Promise<void>;
})=>Promise<T>):Promise<T>{
  const dir=await mkdtemp(join(tmpdir(),'agent-cookie-learning-acceptance-'));
  const database=join(dir,'workspace.sqlite');
  const deps=await createDeps(loadConfig({SQLITE_PATH:database,MEMORY_REPO_PATH:join(dir,'memory'),FIXTURES_DIR:fixtures,
    AGENT_COOKIE_DEMO:'1',AGENT_COOKIE_TEST:'1',CALLBACK_TIMEOUT_MS:'50',CALLBACK_RETRIES:'1',LEARN_TICK_MS:'3600000'}),{learn});
  const app=createApp(deps);
  const make=(key:string)=>new WorkspaceClient({baseUrl:'http://127.0.0.1:4310',key,learning:true,
    fetch:async(url,init)=>app.request(String(url),init)});
  try{return await run({client:make(keyFor('sample-personal-photon')),desktop:make(keyFor('sample-personal-desktop')),
    owner:make(Object.keys(keys).find(k=>keys[k].role==='owner')!),database,
    advance:async offset=>{const r=await app.request('/test/clock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({offsetMs:offset})});
      if(r.status!==200)throw Error('ISOLATED_CLOCK_FAILED');},
    flush:()=>deps.learning.flushDue(),settle:()=>deps.learning.settle()});
  }finally{await deps.close();await rm(dir,{recursive:true,force:true});}
}
const observe=async(c:WorkspaceClient,id:string,text:string)=>{
  const result=await c.observe({channel:'imessage',conversationId:id,
    turns:[{role:'user',text,at:new Date().toISOString()}]});
  if(!result.queued)throw Error('ISOLATED_OBSERVATION_NOT_QUEUED');
};
async function check(name:string,run:()=>Promise<Omit<Result,'name'>>){
  try{results.push({name,...await run()});}catch{results.push({name,passed:false,observed:{error:'ISOLATED_PROBE_ERROR'}});}
}

await check('explicit_statement_reaches_card',()=>isolated(synthetic('stated'),async h=>{
  await observe(h.client,'explicit-one',stated);await h.advance(301000);await h.flush();
  const row=(await h.client.getLearned()).learned.find(r=>r.field==='pref.color');
  return {passed:row?.status==='card',observed:{status:row?.status??'absent',basis:row?.evidence.map(e=>e.basis)}};
}));

for(const refresh of [false,true])await check(refresh?'same_agent_two_conversations_after_refresh':'same_agent_two_conversations',()=>isolated(synthetic('observed'),async h=>{
  await observe(h.client,'independent-one',incidental);await h.advance(301000);await h.flush();
  await observe(h.client,'independent-two',incidental);await h.advance(refresh?31*86400000:602000);await h.flush();
  const row=(await h.client.getLearned()).learned.find(r=>r.field==='pref.color');
  return {passed:row?.status==='card'&&row.evidence.length===2,observed:{status:row?.status??'absent',evidenceCount:row?.evidence.length??0,writerCount:row?.sources.length??0}};
}));

await check('pause_resume_discards_late_result',async()=>{
  const entered=deferred(),release=deferred();
  const learn=createWorkspaceLearner({extract:async input=>{entered.resolve();await release.promise;
    return {sensitive:false,stable:true,preferences:[{key:'pref.color',value:'black',evidence:input.text,basis:'stated'}]};}});
  return isolated(learn,async h=>{
    await observe(h.client,'in-flight',stated);await h.advance(301000);const flushing=h.flush();
    try{await entered.promise;await h.client.setLearning({enabled:false});await h.client.setLearning({enabled:true});}
    finally{release.resolve();await flushing;}
    const rows=(await h.client.getLearned()).learned;
    return {passed:rows.length===0,observed:{learnedCount:rows.length,paused:(await h.client.getLearning()).paused}};
  });
});

await check('queued_original_never_reaches_disk',()=>isolated(noLearning,async h=>{
  const canary='QueueCanaryTranquil I always prefer black clothing.';
  await observe(h.client,'raw-storage',canary);
  let present=false;
  for(const path of [h.database,`${h.database}-wal`]){
    try{present ||= (await readFile(path)).includes(Buffer.from(canary));}
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  }
  return {passed:!present,observed:{rawCanaryOnDisk:present}};
}));

await check('cross_agent_fixture_accept_preserves_history',()=>isolated(noLearning,async h=>{
  const found=await h.desktop.find({text:'trail shoes',public:{budget:'120'}},'learning-audit:find');
  if(!found.quotes.length)throw Error('NO_FIXTURE_QUOTES');
  const result=await h.client.accept(found.quotes[0].id,'learning-audit:accept');await h.settle();
  const failures=(await h.owner.getActivity()).activity.filter(e=>e.event==='memory.write'&&e.result==='failed');
  return {passed:failures.length===0,observed:{acceptStatus:result.status,memoryWriteFailures:failures.length}};
}));

console.log(JSON.stringify({mode:'isolated-real-A-C-with-synthetic-extractor',liveModels:false,liveChannel:false,results},null,2));
if(results.some(r=>!r.passed))process.exitCode=1;
