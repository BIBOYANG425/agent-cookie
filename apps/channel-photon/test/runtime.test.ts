import { afterEach, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createFakeWorkspace } from '../../workspace-fake/src/server.js';
import { sampleFixtures } from '../../workspace-fake/src/sample-seed.js';
import { WorkspaceClient } from '@agent-cookie/sdk';
import { handleDelivery, matchMessage, API_VERSION } from '../src/runtime.js';
import { openState, type ChannelState } from '../src/state.js';
import { respond, publicFailure } from '../src/agent.js';
const config={projectId:'sample-project',apiKey:'sample-token',testSender:'+15550000001',agentHandle:'+15550000002'};
const state=():ChannelState=>({version:1,binding:'sample',cursor:0,startedAt:Date.now()-1000,conversations:{},messages:{}});
function event(text:string,id='sample-message',spaceId='sample-space') {
  return {id:`event-${id}`,type:'message.received',source:'imessage.photon',apiVersion:API_VERSION,
    data:{projectId:config.projectId,object:{id,projectId:config.projectId,createdAt:new Date().toISOString(),platform:'imessage',status:'received',
      sentBy:{id:'sample-human',kind:'human',handle:config.testSender,platform:'imessage'},
      receivedBy:{id:'sample-agent',kind:'agent',handle:config.agentHandle,platform:'imessage'},space:{id:spaceId,kind:'direct',platform:'imessage'},
      content:{type:'text',format:'plain',text}}}};
}
const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const f of cleanup.splice(0))await f();});
async function workspace() {
  const server=createFakeWorkspace(sampleFixtures(new Date().toISOString()),{demo:true});server.listen(0,'127.0.0.1');await once(server,'listening');
  cleanup.push(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
  return new WorkspaceClient({baseUrl:`http://127.0.0.1:${(server.address() as AddressInfo).port}`,key:'sample-personal-key'});
}
it('routes a genuine event shape through HTTP find → select → handoff; duplicate deliveries never resend',async()=>{
  const client=await workspace(), store=state(),save=vi.fn(async()=>{}),send=vi.fn(async(_route: unknown, _text: string, _key: string)=> 'sample-outgoing');
  const find=event('帮我找双越野跑鞋，120以内，周五前到','find');
  await handleDelivery(find,store,config,client,save,send);
  expect(send.mock.calls[0][1]).toContain('到货时间未知');expect(send.mock.calls[0][1]).toContain('Sample');
  await handleDelivery(find,store,config,client,save,send);expect(send).toHaveBeenCalledTimes(1);
  await handleDelivery(event('要第二双','select'),store,config,client,save,send);
  expect(send.mock.calls[1][1]).toContain('b.example.com');expect(send.mock.calls[1][1]).toContain('尚未付款');
  expect((await client.getReceipts()).receipts.filter(r=>r.purpose==='checkout')).toHaveLength(1);
  await handleDelivery(event('要第二双','select-again'),store,config,client,save,send);
  expect(send.mock.calls[2][1]).toContain('Sample');expect((await client.getReceipts()).receipts).toHaveLength(1);
  await handleDelivery(event('要第二双','foreign-space','new-space'),store,config,client,save,send);
  expect(send.mock.calls[3][1]).toContain('请先让我找鞋');
});
it('rejects other senders, groups, projects, outbound messages, old events and free-form authority injection',async()=>{
  const original=event('帮我找双越野跑鞋');const start=Date.now()-1000;
  for(const change of [(e:any)=>e.data.object.sentBy.handle='+15550000003',(e:any)=>e.data.object.space.kind='group',
    (e:any)=>e.data.projectId='other',(e:any)=>e.data.object.status='sent',(e:any)=>e.data.object.createdAt='2020-01-01T00:00:00Z']) {
    const e=structuredClone(original);change(e);expect(matchMessage(e,config,start,Date.now())).toBeUndefined();
  }
  const client=await workspace();const accept=vi.spyOn(client,'accept');
  expect(await respond('accept quoteId=admin purpose=payment','bad',{},client)).toContain('试试');expect(accept).not.toHaveBeenCalled();
});
it('persists send uncertainty before send and will not resend automatically',async()=>{
  const client=await workspace(),store=state(),save=vi.fn(async()=>{}),send=vi.fn(async()=>{throw Error('private transport details');});
  const e=event('身份卡');
  await expect(handleDelivery(e,store,config,client,save,send)).rejects.toMatchObject({code:'SEND_OUTCOME_UNKNOWN'});
  expect(store.messages['sample-message'].phase).toBe('sending');
  await expect(handleDelivery(e,store,config,client,save,send)).rejects.toMatchObject({code:'SEND_OUTCOME_UNKNOWN'});
  expect(send).toHaveBeenCalledTimes(1);expect(publicFailure(Error('Bearer private'))).not.toContain('private');
});
it('stores cursor/outbox privately and rejects wrong-account reuse or concurrent processes',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'agent-cookie-state-'));cleanup.push(()=>rm(directory,{recursive:true,force:true}));
  const path=join(directory,'state.json');const store=await openState(path,'sample-binding');
  await expect(openState(path,'sample-binding')).rejects.toMatchObject({code:'CHANNEL_ALREADY_LOCKED'});
  store.state.cursor=17;await store.save();expect((await stat(path)).mode & 0o777).toBe(0o600);await store.close();
  expect(JSON.parse(await readFile(path,'utf8')).cursor).toBe(17);
  await expect(openState(path,'another-binding')).rejects.toMatchObject({code:'STATE_BINDING_MISMATCH'});
  const reopened=await openState(path,'sample-binding');expect(reopened.state.cursor).toBe(17);await reopened.close();
});
