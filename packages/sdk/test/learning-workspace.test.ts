import {it,expect,vi} from 'vitest';
import {harness,KEYS} from '../../../apps/workspace/test/harness.js';
import {WorkspaceClient} from '../src/index.js';
import {createWorkspaceLearner} from '../../learn/src/workspace.js';
import {createExtractor} from '../../learn/src/models.js';

it('connects official observation/state/learned endpoints to B LearnApi in isolated A SQLite',async()=>{
 const extract=vi.fn(async()=>({sensitive:false,stable:false,preferences:[]}));
 const h=await harness({learn:createWorkspaceLearner({extract})});
 try{
  const client=new WorkspaceClient({baseUrl:'http://127.0.0.1:4310',key:KEYS.personal,learning:true,fetch:async(url,init)=>h.app.request(String(url),init)});
  const obs={channel:'imessage',conversationId:'sample-independent-conversation',turns:[{role:'user' as const,text:'我喜欢黑色衣服。',at:new Date().toISOString()}]};
  expect(await client.getLearning()).toEqual({paused:false});
  expect(await client.observe(obs)).toEqual({queued:true});
  await h.post('/test/clock',undefined,{offsetMs:301000});await h.deps.learning.flushDue();await h.deps.learning.settle();
  expect(extract).toHaveBeenCalledOnce();expect(extract.mock.calls[0]).toBeDefined();
  expect(await client.getLearned()).toEqual({paused:false,learned:[]});
  expect(await client.setLearning({enabled:false})).toEqual({paused:true});
  expect(await client.observe({...obs,conversationId:'paused'})).toEqual({queued:false,paused:true});
  expect(await client.setLearning({enabled:true})).toEqual({paused:false});
  // This is transport/extraction verification. A/C positive promotion and durable privacy are blocked (B44/B45).
 }finally{await h.deps.close();}
});

it('returns native adapter model provenance through the real A queue and SDK without changing promotion',async()=>{
 const text='我一直喜欢黑色衣服。';
 const provider=vi.fn(async(url:unknown)=>Response.json(String(url).includes('/decisions')?{
  answers:{stable:{type:'noul',noul:1},sensitive:{type:'noul',noul:0},key:{type:'choice',choice:'pref.color',confidence:1,probabilities:{'pref.color':1,none:0}}}
 }:{choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({stable:true,sensitive:false,preferences:[{key:'pref.color',value:'black',evidence:text,basis:'stated'}]})}}]}));
 const h=await harness({learn:createWorkspaceLearner({extract:createExtractor({apiKey:'offline-test',fetch:provider})})});
 try{
  const client=new WorkspaceClient({baseUrl:'http://127.0.0.1:4310',key:KEYS.personal,learning:true,fetch:async(url,init)=>h.app.request(String(url),init)});
  expect(await client.observe({channel:'imessage',conversationId:'b60-conversation',turns:[{role:'user',text,at:new Date().toISOString()}]})).toEqual({queued:true});
  await h.post('/test/clock',undefined,{offsetMs:301000});await h.deps.learning.flushDue();await h.deps.learning.settle();
  const learned=await client.getLearned();const row=learned.learned.find(p=>p.field==='pref.color');
  expect(row).toMatchObject({value:'black',status:'card'});
  expect(row!.evidence).toEqual([expect.objectContaining({basis:'stated',conversationId:'b60-conversation',models:{gate:'typesafe/jev-1.14',extractor:'openai/gpt-oss-120b'}})]);
  expect(provider).toHaveBeenCalledTimes(2);
 }finally{await h.deps.close();}
});
