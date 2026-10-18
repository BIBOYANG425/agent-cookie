import {afterEach,expect,it,vi} from 'vitest';
import {createBetaLearning} from '../src/beta-learning.js';
import {handleDelivery,API_VERSION} from '../src/runtime.js';
import type {ChannelState} from '../src/state.js';

const config={projectId:'sample-project',apiKey:'sample-key',testSender:'+15550000001',agentHandle:'+15550000002'};
const close:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const f of close.splice(0))await f();});
function event(text:string,id='fresh'){
  return {type:'message.received',source:'imessage.photon',apiVersion:API_VERSION,data:{projectId:config.projectId,object:{
    id,projectId:config.projectId,platform:'imessage',status:'received',createdAt:new Date().toISOString(),
    sentBy:{id:'owner',kind:'human',handle:config.testSender,platform:'imessage'},
    receivedBy:{id:'agent',kind:'agent',handle:config.agentHandle,platform:'imessage'},
    space:{id:'private-space',kind:'direct',platform:'imessage'},content:{type:'text',format:'plain',text}}}};
}
async function setup(paused=false){
  const state:ChannelState={version:1,binding:'test',cursor:6775,startedAt:Date.now()-1000,conversations:{},messages:{}};
  const workspace={getLearning:vi.fn().mockResolvedValue({paused}),getLearned:vi.fn().mockResolvedValue({paused,learned:[]}),
    setLearning:vi.fn().mockResolvedValue({paused:true}),forgetLearning:vi.fn(),observe:vi.fn().mockResolvedValue({queued:true}),
    find:vi.fn(),accept:vi.fn(),getMyCard:vi.fn(),getReceipts:vi.fn()};
  const save=vi.fn(async()=>{}),send=vi.fn(async()=> 'outgoing');
  const learning=await createBetaLearning({workspace,state,save,ownerHandle:config.testSender,identifierSalt:'s'.repeat(64)});
  close.push(learning.close);
  const deliver=(e:unknown)=>handleDelivery(e,state,config,workspace,save,send,learning);
  return {state,workspace,send,save,deliver,learning};
}
it('learns a fresh owner turn without blocking replies, keeps dedup/outbox and never stores raw text',async()=>{
  const s=await setup();let resolve!: (v:{queued:boolean})=>void;
  s.workspace.observe.mockImplementation(()=>new Promise(r=>{resolve=r;}));
  const text='我一直喜欢黑色衣服。';const e=event(text);
  await s.deliver(e); // The model/observation endpoint is still unresolved here.
  expect(s.send).toHaveBeenCalledOnce();expect(s.send.mock.calls[0]).toBeDefined();
  expect(s.workspace.find).not.toHaveBeenCalled();expect(s.workspace.observe).toHaveBeenCalledOnce();
  const observation=s.workspace.observe.mock.calls[0][0];
  expect(observation).toMatchObject({channel:'imessage',turns:[{role:'user',text}]});
  expect(observation.conversationId).toMatch(/^[a-f0-9]{64}$/);
  expect(observation.turns[0].messageId).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(s.state)).not.toContain(text);expect(s.state.messages.fresh.phase).toBe('sent');
  await s.deliver(e);expect(s.workspace.observe).toHaveBeenCalledOnce();expect(s.send).toHaveBeenCalledOnce();
  expect(s.state.cursor).toBe(6775);resolve({queued:true});
});
it('rejects other senders, groups, wrong recipient/project and outbound messages before capture',async()=>{
  const s=await setup();
  for(const change of [(e:ReturnType<typeof event>)=>{e.data.object.sentBy.handle='+15550000003';},
    (e:ReturnType<typeof event>)=>{e.data.object.space.kind='group';},
    (e:ReturnType<typeof event>)=>{e.data.object.receivedBy.handle='+15550000004';},
    (e:ReturnType<typeof event>)=>{e.data.projectId='other';},
    (e:ReturnType<typeof event>)=>{e.data.object.status='sent';}]){
    const e=event('我一直喜欢黑色衣服。');change(e);await s.deliver(e);
  }
  expect(s.workspace.observe).not.toHaveBeenCalled();expect(s.send).not.toHaveBeenCalled();
});
it('does not learn sensitive turns or historical replay, but can reply to the owner',async()=>{
  const s=await setup();await s.deliver(event('I have asthma and prefer black clothing.'));
  const old=event('我一直喜欢黑色衣服。','old');old.data.object.createdAt=new Date(Date.now()-600000).toISOString();
  s.state.startedAt=Date.now()-700000;await s.deliver(old);
  expect(s.workspace.observe).not.toHaveBeenCalled();expect(s.send).toHaveBeenCalledTimes(2);
});
it('honors persisted/server pause and keeps control commands out of observations',async()=>{
  const s=await setup(true);await s.deliver(event('我一直喜欢黑色衣服。'));
  expect(s.workspace.observe).not.toHaveBeenCalled();expect(s.state.learning?.paused).toBe(true);
  const active=await setup();await active.deliver(event('暂停学习','pause'));
  expect(active.workspace.setLearning).toHaveBeenCalledWith({enabled:false},expect.anything());
  expect(active.workspace.observe).not.toHaveBeenCalled();expect(active.state.learning?.paused).toBe(true);
});
it('capture failure cannot prevent an authorized reply',async()=>{
  const s=await setup();s.learning.capture=()=>{throw Error('private details');};
  await s.deliver(event('我一直喜欢黑色衣服。'));
  expect(s.send).toHaveBeenCalledOnce();expect(s.state.messages.fresh.phase).toBe('sent');
});
