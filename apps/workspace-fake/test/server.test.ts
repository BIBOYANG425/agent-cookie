import { afterEach, describe, expect, it } from 'vitest';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createFakeWorkspace } from '../src/server.js';
import { sampleFixtures } from '../src/sample-seed.js';
import { WorkspaceClient } from '../../../packages/sdk/src/index.js';

const servers: ReturnType<typeof createFakeWorkspace>[] = [];
afterEach(async()=>{for(const s of servers.splice(0)) {s.closeAllConnections();await new Promise<void>(r=>s.close(()=>r()));}});
async function setup(demo=true, withAddress=true) {
  let clock=Date.parse('2026-10-17T20:00:00Z');
  const seed=sampleFixtures();
  if (!withAddress) seed.contributions=seed.contributions.filter(c=>c.field!=='shipping_address');
  seed.users.push({userId:'sample-other',name:'Sample Other',secret:'sample-other-secret'});
  seed.keys.push({key:'sample-other-key',userId:'sample-other',agentId:'sample-personal',role:'personal',category:'personal'});
  const s=createFakeWorkspace(seed,{demo,now:()=>clock}); servers.push(s);s.listen(0,'127.0.0.1');await once(s,'listening');
  const baseUrl=`http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  const call=async(path:string,key='sample-personal-key',body?:unknown,idempotencyKey?:string)=>{
    const response=await fetch(baseUrl+path,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json',...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,data:await response.json() as any};
  };
  return {call,client:new WorkspaceClient({baseUrl,key:'sample-personal-key'}),advance:(ms:number)=>{clock+=ms;}};
}

describe('Sample HTTP workspace',()=>{
  it('authenticates every request, maps roles from dev keys and merges the seeded card',async()=>{
    const {call}=await setup();
    expect((await call('/me','wrong')).status).toBe(401);
    expect((await call('/me')).data).toMatchObject({role:'personal',sample:true});
    expect((await call('/personal/card','sample-shoe-a-key')).status).toBe(403);
    const {data}=await call('/personal/card');
    expect(data.card.find((f:any)=>f.field==='shoe_size').value).toBe('42');
    expect(data.sample).toBe(true);
  });
  it('runs SDK find, keeps handshakes value-free, grounds checkout address access in the selected quote',async()=>{
    const {call,client}=await setup();
    const found=await client.find({kind:'trail_shoes',public:{budget:'120'}},'sample-find');
    expect(found.sample).toBe(true);expect(found.quotes).toHaveLength(2);
    const grants=(await call('/personal/grants')).data.grants;
    const a=grants.find((g:any)=>g.agentId==='sample-shoe-a'),b=grants.find((g:any)=>g.agentId==='sample-shoe-b');
    expect(a.sessionId).not.toBe(b.sessionId);
    const handshake=await call(`/agent/handshake?sessionId=${a.sessionId}`,'sample-shoe-a-key');
    expect(handshake.data.available).toContain('shoe_size');expect(JSON.stringify(handshake.data)).not.toContain('123 Example');
    expect((await call(`/agent/fields?sessionId=${a.sessionId}&fields=shoe_size`,'sample-shoe-a-key')).data.shoe_size).toBe('42');
    expect((await call(`/agent/fields?sessionId=${a.sessionId}&fields=shipping_address&purpose=checkout`,'sample-shoe-a-key')).status).toBe(403);
    const selected=found.quotes.find(q=>q.agentId==='sample-shoe-b')!;
    const result=await client.accept(selected.id,'sample-accept');
    expect(result).toMatchObject({status:'handoff',sample:true});expect(result.continueUrl).toContain('example.com');
    expect((await call(`/agent/fields?sessionId=${b.sessionId}&fields=shipping_address&purpose=checkout`,'sample-shoe-b-key')).status).toBe(200);
    expect((await call(`/agent/fields?sessionId=${a.sessionId}&fields=shipping_address&purpose=checkout`,'sample-shoe-a-key')).status).toBe(403);
    expect((await call(`/agent/fields?sessionId=${b.sessionId}&fields=payment_method&purpose=payment`,'sample-shoe-b-key')).status).toBe(403);
    expect((await call(`/agent/handshake?sessionId=${a.sessionId}`,'sample-shoe-b-key')).status).toBe(404);
    expect((await client.getReceipts()).receipts.some(r=>r.agentId==='sample-shoe-b'&&r.purpose==='checkout')).toBe(true);
  });
  it('isolates users and enforces idempotency, expiry, revocation and owner-only reset',async()=>{
    const {call,client,advance}=await setup();
    const input={kind:'trail_shoes' as const,public:{budget:'120'}};
    const found=await client.find(input,'repeat');
    expect((await client.find(input,'repeat')).intentId).toBe(found.intentId);
    expect((await call('/personal/intents','sample-personal-key',{kind:'trail_shoes',public:{budget:'99'}},'repeat')).status).toBe(409);
    expect((await call(`/personal/intents/${found.intentId}/quotes`,'sample-other-key')).status).toBe(404);
    expect((await call(`/personal/quotes/${found.quotes[0].id}/accept`,'sample-other-key',{},'foreign')).status).toBe(404);
    const grant=(await call('/personal/grants')).data.grants[0];
    await call(`/personal/grants/${grant.id}/revoke`,'sample-personal-key',{});
    expect((await call(`/agent/fields?sessionId=${grant.sessionId}&fields=shoe_size`,'sample-shoe-a-key')).data.error.code).toBe('GRANT_REVOKED');
    advance(600001);expect((await call(`/personal/intents/${found.intentId}/quotes`)).data.error.code).toBe('GRANT_EXPIRED');
    expect((await call('/demo/reset','sample-personal-key',{})).status).toBe(403);
    expect((await call('/demo/reset','sample-owner-key',{})).status).toBe(200);
    expect((await call(`/personal/intents/${found.intentId}/quotes`)).status).toBe(404);
    expect((await call('/personal/card')).data.card).not.toHaveLength(0);
  });
  it('does not accept identity fields or send HTTP traffic to fixture merchants',async()=>{
    const {call}=await setup(false);
    expect((await call('/personal/intents','sample-personal-key',{kind:'trail_shoes',public:{userId:'other'}},'injection')).status).toBe(422);
    expect((await call('/demo/reset','sample-owner-key',{})).status).toBe(404);
    expect((await call('/personal/intents','sample-personal-key',{kind:'trail_shoes',public:{budget:'80'}},'empty')).data.sample).toBe(true);
  });
  it('does not fabricate checkout reads or receipts when the saved address is missing',async()=>{
    const {client}=await setup(true,false);
    const found=await client.find({kind:'trail_shoes',public:{budget:'120'}},'missing-address');
    await expect(client.accept(found.quotes[0].id,'accept')).rejects.toMatchObject({code:'MISSING_FIELD'});
    expect((await client.getReceipts()).receipts).toHaveLength(0);
  });

});
