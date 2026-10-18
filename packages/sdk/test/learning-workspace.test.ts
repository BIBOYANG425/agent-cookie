import {it,expect,vi} from 'vitest';
import {harness,KEYS} from '../../../apps/workspace/test/harness.js';
import {WorkspaceClient} from '../src/index.js';
import {createWorkspaceLearner} from '../../learn/src/workspace.js';

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
