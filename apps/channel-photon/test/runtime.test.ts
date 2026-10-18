import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleDelivery, matchMessage, API_VERSION } from '../src/runtime.js';
import { openState, type ChannelState } from '../src/state.js';
import { respond, publicFailure } from '../src/agent.js';
import { startRealWorkspace, PINNED, SEED, type RealWorkspace } from './real-workspace.js';

// These tests drive the REAL workspace (apps/workspace) in demo mode over HTTP: lane C's Sample seed card,
// lane D's recorded UCP offers (AGENT_COOKIE_UCP=fixture) and POST /demo/reset between tests. One server per file.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });
let server: RealWorkspace;
beforeAll(async()=>{server=await startRealWorkspace();});
afterAll(async()=>{await server?.stop();});
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
  await server.reset();
  return server.client('photon');
}
it('routes a genuine event shape through HTTP find → select → handoff; duplicate deliveries never resend',async()=>{
  const client=await workspace(), store=state(),save=vi.fn(async()=>{}),send=vi.fn(async(_route: unknown, _text: string, _key: string)=> 'sample-outgoing');
  const find=event('帮我找双越野跑鞋，120以内，周五前到','find');
  await handleDelivery(find,store,config,client,save,send);
  // Fixture mode replays the recorded UCP catalog: the two pinned sellers, labelled as a recording, no arrival date.
  expect(send.mock.calls[0][1]).toContain('[Sample 录制报价，非实时搜索');expect(send.mock.calls[0][1]).toContain('到货时间未知');
  expect(send.mock.calls[0][1]).toContain('目前不能保证你要求的到货时间');
  const shown=store.conversations['sample-space'].offers!.quotes;
  expect(shown.map(q=>q.seller).sort()).toEqual(PINNED.offers.map(o=>o.seller).sort());
  expect(shown.every(q=>q.source==='fixture'&&q.etaDate===null&&q.agentId===`ucp:${q.seller}`)).toBe(true);
  await handleDelivery(find,store,config,client,save,send);expect(send).toHaveBeenCalledTimes(1);
  await handleDelivery(event('要第二双','select'),store,config,client,save,send);
  // Accept on a recorded UCP quote is a handoff to that seller's recorded checkout, never an order or a payment.
  const second=shown[1];
  expect(send.mock.calls[1][1]).toContain('[Sample 演示]');expect(send.mock.calls[1][1]).toContain(`https://${second.seller}/`);
  expect(send.mock.calls[1][1]).toContain('尚未付款，也未确认订单。');expect(send.mock.calls[1][1]).not.toContain('后台确认订单');
  const receipts=(await client.getReceipts()).receipts;
  expect(receipts.filter(r=>r.purpose==='checkout')).toEqual([expect.objectContaining({agentId:second.agentId,fields:['shipping_address']})]);
  expect((await client.getGrants()).grants).toContainEqual(expect.objectContaining({agentId:second.agentId,purpose:'checkout',
    fields:['shipping_address'],stage:'checkout',policyId:expect.any(String),status:'live'}));
  // A repeated selection replays the same idempotent accept: same handoff text, no new read.
  await handleDelivery(event('要第二双','select-again'),store,config,client,save,send);
  expect(send.mock.calls[2][1]).toBe(send.mock.calls[1][1]);expect((await client.getReceipts()).receipts).toEqual(receipts);
  await handleDelivery(event('要第二双','foreign-space','new-space'),store,config,client,save,send);
  expect(send.mock.calls[3][1]).toContain('请先搜索商品');
});
it('rejects other senders, groups, projects, outbound messages, old events and free-form authority injection',async()=>{
  const original=event('帮我找双越野跑鞋');const start=Date.now()-1000;
  for(const change of [(e:any)=>e.data.object.sentBy.handle='+15550000003',(e:any)=>e.data.object.space.kind='group',
    (e:any)=>e.data.projectId='other',(e:any)=>e.data.object.status='sent',(e:any)=>e.data.object.createdAt='2020-01-01T00:00:00Z']) {
    const e=structuredClone(original);change(e);expect(matchMessage(e,config,start,Date.now())).toBeUndefined();
  }
  const client=await workspace();const accept=vi.spyOn(client,'accept');
  expect(await respond('accept quoteId=admin purpose=payment','bad',{},client)).toContain('试试');expect(accept).not.toHaveBeenCalled();
  expect((await client.getReceipts()).receipts).toEqual([]);
});
it('persists send uncertainty before send and will not resend automatically',async()=>{
  const client=await workspace(),store=state(),save=vi.fn(async()=>{}),send=vi.fn(async()=>{throw Error('private transport details');});
  const e=event('身份卡');
  await expect(handleDelivery(e,store,config,client,save,send)).rejects.toMatchObject({code:'SEND_OUTCOME_UNKNOWN'});
  expect(store.messages['sample-message'].phase).toBe('sending');
  // The reply waiting in the outbox was read from the Sample seed card.
  expect(store.messages['sample-message'].text).toContain(`鞋码：${SEED.find(c=>c.field==='shoe_size')!.value}`);
  expect(store.messages['sample-message'].text).toContain('[Sample 演示] 身份卡');
  await expect(handleDelivery(e,store,config,client,save,send)).rejects.toMatchObject({code:'SEND_OUTCOME_UNKNOWN'});
  expect(send).toHaveBeenCalledTimes(1);expect(publicFailure(Error('Bearer private'))).not.toContain('private');
});
it('stores cursor/outbox privately and rejects wrong-account reuse or concurrent processes',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'agent-cookie-state-'));cleanup.push(()=>rm(directory,{recursive:true,force:true}));
  const path=join(directory,'state.json');const store=await openState(path,'sample-binding',11);
  expect(store.state.cursor).toBe(11);
  await expect(openState(path,'sample-binding')).rejects.toMatchObject({code:'CHANNEL_ALREADY_LOCKED'});
  store.state.cursor=17;await store.save();expect((await stat(path)).mode & 0o777).toBe(0o600);await store.close();
  expect(JSON.parse(await readFile(path,'utf8')).cursor).toBe(17);
  await expect(openState(path,'another-binding')).rejects.toMatchObject({code:'STATE_BINDING_MISMATCH'});
  const reopened=await openState(path,'sample-binding',999);expect(reopened.state.cursor).toBe(17);await reopened.close();
  await expect(openState(path,'sample-binding',-1)).rejects.toMatchObject({code:'INVALID_INITIAL_CURSOR'});
});

it.each(['ordered','handoff','blocked','failed'] as const)('renders actual %s outcomes without inventing a link or losing a failure handoff',async status=>{
  const client=await workspace();
  const offers=await client.find({text:'trail shoes',public:{}},'render');
  // Real recorded quotes; the AcceptResult is stubbed because fixture replay only ever hands off (no order, no failure recording here).
  vi.spyOn(client,'accept').mockResolvedValue({status,quoteId:offers.quotes[0].id,sample:true,message:'Sample buyer review',
    ...(status==='ordered'?{orderId:'sample-order'}:{}),...(status==='failed'?{continueUrl:'https://example.com/review'}:{})});
  const text=await respond('要第一双','selection',{offers},client);
  expect(text).toContain('Sample');expect(text).not.toContain('undefined');
  if(status==='ordered')expect(text).toContain('sample-order');
  else expect(text).not.toContain('后台确认订单');
  if(status==='handoff')expect(text).toContain('未提供交接链接');
  if(status==='failed')expect(text).toContain('https://example.com/review');
});

it('offers only the first selection when the backend finds one eligible merchant',async()=>{
  const client=await workspace();
  const found=await client.find({text:'trail shoes',public:{}},'single');
  vi.spyOn(client,'find').mockResolvedValue({...found,quotes:found.quotes.slice(0,1)});
  const text=await respond('帮我找双越野跑鞋，120以内','single-search',{},client);
  expect(text).toContain('选1');expect(text).not.toContain('选2');
  expect(text).toContain('Sample');expect(text).toContain('到货时间未知');
});

it('retains recorded quote provenance when AcceptResult has no source metadata',async()=>{
  const client=await workspace();
  const offers=await client.find({text:'trail shoes',public:{}},'provenance');
  // The workspace labels every recorded quote; drop the list-level flag so only the quote's own source remains.
  expect(offers.quotes[0].source).toBe('fixture');offers.sample=false;
  const accept=vi.spyOn(client,'accept');
  const text=await respond('要第一双','provenance-selection',{offers},client);
  const accepted=await accept.mock.results[0].value;
  expect(accepted).toMatchObject({status:'handoff',quoteId:offers.quotes[0].id,sample:false});
  expect(accepted).not.toHaveProperty('source');
  expect(text).toContain('[Sample 演示]');expect(text).toContain('此结果仅供演示');
  expect(accepted.continueUrl).toMatch(new RegExp(`^https://${offers.quotes[0].seller!.replace(/\./g,'\\.')}/`));
  expect(text).toContain(accepted.continueUrl!);expect(text).toContain('尚未付款');
});
