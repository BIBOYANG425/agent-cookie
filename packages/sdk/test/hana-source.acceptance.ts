// Opt-in A-contract acceptance. A failure records the missing shared source;
// never convert it into a skip or loosen its one-source assertion.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {DevKeys} from '@agent-cookie/contract';
import {createApp} from '../../../apps/workspace/src/app.js';
import {loadConfig} from '../../../apps/workspace/src/config.js';
import {createDeps} from '../../../apps/workspace/src/deps.js';
import {createWorkspaceLearner} from '../../learn/src/workspace.js';
import {WorkspaceClient} from '../src/index.js';
import {conversationIdForChat,operationIdForMessage} from '../src/hana-identifiers.js';
const fixtures=fileURLToPath(new URL('../../../fixtures/',import.meta.url));
const keys=JSON.parse(await readFile(join(fixtures,'dev-keys.json'),'utf8')) as DevKeys;
const dir=await mkdtemp(join(tmpdir(),'hana-shared-source-'));
const phrase='Black, white and gray are the colors I pick for clothes. Find trail shoes.';
const snippet='Black, white and gray are the colors I pick for clothes.';
const learner=createWorkspaceLearner({extract:async()=>({stable:true,sensitive:false,preferences:[{
  key:'pref.color',value:'black, white, gray',evidence:snippet,basis:'observed',
}]})});
const deps=await createDeps(loadConfig({SQLITE_PATH:join(dir,'workspace.sqlite'),MEMORY_REPO_PATH:join(dir,'memory'),FIXTURES_DIR:fixtures,
  AGENT_COOKIE_DEMO:'1',AGENT_COOKIE_TEST:'1',LEARN_TICK_MS:'3600000',DREAMING_INTERVAL_MS:'0'}),{learn:learner});
const app=createApp(deps);
const client=new WorkspaceClient({baseUrl:'http://127.0.0.1:4310',key:Object.keys(keys).find(k=>keys[k].agentId==='sample-personal-photon')!,
  learning:true,fetch:async(url,init)=>app.request(String(url),init)});
const result:Record<string,unknown>={scope:'Isolated A SQLite/C Git, synthetic extractor, no phone/model, existing fixture identity only'};
try{
  const conversationId=conversationIdForChat('synthetic-hana-chat');const guid='synthetic-hana-source-one';
  const found=await client.find({text:phrase,conversationId},operationIdForMessage(guid,'find'));
  assert.equal(deps.store.intent(found.intentId)?.conversationId,conversationId);
  await deps.learning.settle();
  const ack=await client.observe({conversationId,channel:'imessage',turns:[{role:'user',text:phrase,messageId:guid,at:new Date().toISOString()}]});
  assert.equal(ack.queued,true);
  const clock=await app.request('/test/clock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({offsetMs:301000})});
  assert.equal(clock.status,200);await deps.learning.flushDue();await deps.learning.settle();
  const row=(await client.getLearned()).learned.find(r=>r.field==='pref.color'&&r.value==='black, white, gray');
  const sources=[...new Set(row?.evidence.map(e=>e.conversationId?`conversation:${e.conversationId}`:`intent:${e.intentId}`)??[])];
  Object.assign(result,{status:row?.status??'absent',evidenceCount:row?.evidence.length??0,evidenceSources:sources});
  assert.equal(sources.length,1,'One message reaching find and observe must have one evidence source');
  assert.equal(row?.status,'candidate','One incidental source must not reach card');
  const replay=await client.find({text:phrase,conversationId},operationIdForMessage(guid,'find'));
  assert.equal(replay.intentId,found.intentId,'Same GUID keeps one intent');
  assert.equal(deps.store.intentsForUser(deps.store.intent(found.intentId)!.userId).length,1);
  await client.accept(found.quotes[1].id,operationIdForMessage('synthetic-selection','accept'));
  await deps.learning.settle();
  assert.equal((await client.getLearned()).learned.find(r=>r.field==='pref.color')?.evidence.length,1,'Accept cannot add a source');
  const allEvents=deps.store.db.prepare("SELECT event,result FROM activity WHERE event='memory.write' AND result='failed'").all();
  assert.equal(allEvents.length,0,'Intent history and learning writes must both succeed');
  await client.observe({conversationId:conversationIdForChat('synthetic-other-chat'),channel:'imessage',turns:[{role:'user',text:phrase,messageId:'synthetic-other-message',at:new Date().toISOString()}]});
  await app.request('/test/clock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({offsetMs:602000})});
  await deps.learning.flushDue();await deps.learning.settle();
  const promoted=(await client.getLearned()).learned.find(r=>r.field==='pref.color');
  assert.equal(promoted?.status,'card');assert.equal(promoted?.evidence.length,2);
  result.secondConversation={status:promoted?.status,evidenceCount:promoted?.evidence.length};
  result.passed=true;
}catch(error){result.passed=false;result.error=(error as Error).message;process.exitCode=1;}
finally{await deps.close();await rm(dir,{recursive:true,force:true});}
console.log(JSON.stringify(result,null,2));
