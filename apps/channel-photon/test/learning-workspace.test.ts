import {it,expect,vi} from 'vitest';
import {harness,KEYS} from '../../workspace/test/harness.js';
import {WorkspaceClient} from '@agent-cookie/sdk';
import {createWorkspaceLearner} from '@agent-cookie/learn';
import {createLearningAdapter,createObservationSink,observeSpectrumMessages,type SpectrumMessage} from '../src/learning-capture.js';

it('carries only owner non-sensitive DM speech through capture, SDK, A queue and B extraction',async()=>{
  // Real SDK + A HTTP/SQLite queue + B parser; synthetic no-preference model,
  // stub memory/UCP. This deliberately does not certify C promotion or A storage privacy.
  const extract=vi.fn(async()=>({sensitive:false,stable:false,preferences:[]}));
  const h=await harness({learn:createWorkspaceLearner({extract})});
  const wire:any[]=[];
  const client=new WorkspaceClient({baseUrl:'http://127.0.0.1:4310',key:KEYS.personal,learning:true,
    fetch:async(url,init)=>{if(String(url).endsWith('/personal/observations'))wire.push(JSON.parse(String(init?.body)));return h.app.request(String(url),init);}});
  const sink=createObservationSink({observe:(input,options)=>client.observe(input,options)});
  try{
    const adapter=createLearningAdapter({ownerHandle:'sample-owner',identifierSalt:'sample-offline-identifier-salt-12345678'});
    const own:SpectrumMessage={id:'one',platform:'imessage',direction:'inbound',timestamp:new Date(),sender:{id:'sample-owner'},
      space:{id:'sample-dm',type:'dm'},content:{type:'text',text:'我一直喜欢黑色衣服。'}};
    async function* messages():AsyncGenerator<[{},SpectrumMessage]>{
      yield [{},own];
      yield [{},{...own,id:'health',content:{type:'text',text:'我有哮喘，偏爱蓝色。'}}];
      yield [{},{...own,id:'other',sender:{id:'someone-else'}}];
      yield [{},{...own,id:'group',space:{id:'group',type:'group'},sender:{id:'someone-else'}}];
    }
    const reply=vi.fn(async()=>{});
    await observeSpectrumMessages(messages(),adapter,sink,reply);
    expect(reply).toHaveBeenCalledTimes(4);
    await vi.waitFor(()=>expect(sink.pending).toBe(0));
    expect(wire).toHaveLength(1);
    expect(wire[0].turns).toEqual([{role:'user',text:own.content.text,at:own.timestamp.toISOString()}]);
    expect(wire[0].conversationId).toMatch(/^[a-f0-9]{64}$/);
    await h.post('/test/clock',undefined,{offsetMs:301000});await h.deps.learning.flushDue();await h.deps.learning.settle();
    expect(extract).toHaveBeenCalledOnce();
    expect((extract.mock.calls as any)[0][0].text).toBe(own.content.text);
  }finally{sink.pause();await h.deps.close();}
});
