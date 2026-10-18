import { afterEach, describe, expect, it } from 'vitest';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createFakeWorkspace } from '../src/server.js';
import { sampleFixtures } from '../src/sample-seed.js';
import { DEFAULT_POLICY, GRANT_TTL_MS, policyId, policyViolations, type PolicyDocument } from '@agent-cookie/contract';
import { WorkspaceClient, WorkspaceError } from '../../../packages/sdk/src/index.js';

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
  const call=async(path:string,key='sample-personal-key',body?:unknown,idempotencyKey?:string,method?:'PUT')=>{
    const response=await fetch(baseUrl+path,{method:method??(body===undefined?'GET':'POST'),headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json',...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:response.status,data:await response.json() as any};
  };
  return {call,client:new WorkspaceClient({baseUrl,key:'sample-personal-key'}),owner:new WorkspaceClient({baseUrl,key:'sample-owner-key'}),
    advance:(ms:number)=>{clock+=ms;}};
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
    const found=await client.find({text:'trail shoes',public:{budget:'120'}},'sample-find');
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
    const input={text:'trail shoes',public:{budget:'120'}};
    const found=await client.find(input,'repeat');
    expect((await client.find(input,'repeat')).intentId).toBe(found.intentId);
    expect((await call('/personal/intents','sample-personal-key',{text:'trail shoes',public:{budget:'99'}},'repeat')).status).toBe(409);
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
    expect((await call('/personal/intents','sample-personal-key',{text:'trail shoes',public:{userId:'other'}},'injection')).status).toBe(422);
    expect((await call('/demo/reset','sample-owner-key',{})).status).toBe(404);
    expect((await call('/personal/intents','sample-personal-key',{text:'trail shoes',public:{budget:'80'}},'empty')).data.sample).toBe(true);
  });
  it('does not fabricate checkout reads or receipts when the saved address is missing',async()=>{
    const {client}=await setup(true,false);
    const found=await client.find({text:'trail shoes',public:{budget:'120'}},'missing-address');
    await expect(client.accept(found.quotes[0].id,'accept')).rejects.toMatchObject({code:'MISSING_FIELD'});
    expect((await client.getReceipts()).receipts).toHaveLength(0);
  });
});

// A shoe merchant no longer reads budget with the handshake; it opens only once the merchant has quoted.
const stricter=():PolicyDocument=>{
  const doc=structuredClone(DEFAULT_POLICY) as PolicyDocument;
  doc.auto.shoe=doc.auto.shoe.filter(f=>f!=='budget');doc.purpose.shoe={...doc.purpose.shoe,budget:['quoted']};return doc;
};

describe('Sample policy document and funnel',()=>{
  it('serves the default document to personal and owner keys only',async()=>{
    const {call,client,owner}=await setup();
    const expected={policy:DEFAULT_POLICY,policyId:policyId(DEFAULT_POLICY),source:'default',sample:true};
    expect(await client.getPolicy()).toEqual(expected);
    expect(await owner.getPolicy()).toEqual(expected);
    expect((await call('/personal/policy','sample-shoe-a-key')).data.error.code).toBe('SCOPE_DENIED');
  });

  it('installs only with the owner key, rejects the floor with every violation and changes nothing on 422',async()=>{
    const {call,client,owner}=await setup();
    expect((await call('/personal/policy','sample-personal-key',stricter(),undefined,'PUT')).status).toBe(403);
    const bad={...stricter(),auto:{...DEFAULT_POLICY.auto,shoe:['tone','length','shipping_address']}};
    const raw=await call('/personal/policy','sample-owner-key',bad,undefined,'PUT');
    expect(raw).toMatchObject({status:422,data:{error:{code:'MISSING_FIELD',message:policyViolations(bad).join('; ')}}});
    const error=await owner.setPolicy(bad as PolicyDocument).catch((e:WorkspaceError)=>e) as WorkspaceError;
    expect(error).toBeInstanceOf(WorkspaceError);
    expect(error).toMatchObject({status:422,code:'MISSING_FIELD'});
    expect(error.violations).toEqual(policyViolations(bad));
    expect((await client.getPolicy()).source).toBe('default');
    const installed=await owner.setPolicy(stricter());
    expect(installed).toEqual({policy:stricter(),policyId:policyId(stricter()),source:'installed',sample:true});
    expect(await client.getPolicy()).toEqual(installed);
    expect((await call('/personal/policy','sample-other-key')).data.source).toBe('default');
  });

  it('decides reads, grants and receipts with the installed document',async()=>{
    const {call,client,owner}=await setup();
    await owner.setPolicy(stricter());
    const found=await client.find({text:'trail shoes',public:{budget:'120'}},'policy-find');
    const grants=(await call('/personal/grants')).data.grants;
    expect(grants.every((g:any)=>g.policyId===policyId(stricter())&&g.stage==='introduced'&&!g.fields.includes('budget'))).toBe(true);
    const a=grants.find((g:any)=>g.agentId==='sample-shoe-a');
    expect((await call(`/agent/handshake?sessionId=${a.sessionId}`,'sample-shoe-a-key')).data.available).not.toContain('budget');
    expect((await call(`/agent/fields?sessionId=${a.sessionId}&fields=budget`,'sample-shoe-a-key')).data.error.code).toBe('PURPOSE_MISMATCH');
    expect((await call(`/agent/fields?sessionId=${a.sessionId}&fields=shoe_size`,'sample-shoe-a-key')).status).toBe(200);
    const receipts=(await client.getReceipts()).receipts;
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({fields:['shoe_size'],intentId:found.intentId,policyId:policyId(stricter())});
  });

  it('shadows a candidate over the Sample history and this process\'s own receipts',async()=>{
    const {call,client,owner}=await setup();
    expect((await call('/personal/policy/shadow','sample-personal-key',{policy:stricter()})).status).toBe(403);
    const same=await owner.shadowPolicy(DEFAULT_POLICY);
    expect(same).toMatchObject({candidateId:policyId(DEFAULT_POLICY),currentId:policyId(DEFAULT_POLICY),changed:[],sample:true});
    const history=same.unchanged;expect(history).toBeGreaterThan(0);
    const report=await owner.shadowPolicy(stricter());
    expect(report.candidateId).toBe(policyId(stricter()));
    expect(report.changed).toEqual([{ref:'sample-read-1',kind:'read',field:'budget',before:'allow',after:'PURPOSE_MISMATCH'}]);
    expect(report.unchanged).toBe(history-1);
    expect((await client.getPolicy()).source).toBe('default');
    // The checkout receipt this process writes joins the history; the candidate still allows it.
    const found=await client.find({text:'trail shoes',public:{budget:'120'}},'shadow-find');
    await client.accept(found.quotes.find(q=>q.agentId==='sample-shoe-b')!.id,'shadow-accept');
    const withReceipt=await owner.shadowPolicy(stricter());
    expect(withReceipt.changed).toEqual(report.changed);
    expect(withReceipt.unchanged).toBe(report.unchanged+1);
    await expect(owner.shadowPolicy({...stricter(),v:2} as unknown as PolicyDocument)).rejects.toMatchObject({status:422,violations:['v must be 1']});
  });

  it('serves Sample funnel rows to the owner with since/limit and validates them through the SDK',async()=>{
    const {call,client,owner}=await setup();
    const report=await owner.getFunnel();
    expect(report.sample).toBe(true);expect(report.rows).toHaveLength(3);
    expect(report.rows.every(r=>r.intentId.startsWith('sample-')&&r.source==='sample')).toBe(true);
    expect(report.rows.map(r=>r.createdAt)).toEqual([...report.rows.map(r=>r.createdAt)].sort().reverse());
    expect((await owner.getFunnel({since:'2026-10-17T19:00:00Z'})).rows.map(r=>r.intentId)).toEqual(['sample-intent-3','sample-intent-2']);
    expect((await owner.getFunnel({limit:1})).rows).toHaveLength(1);
    expect((await call('/owner/funnel?since=yesterday','sample-owner-key')).status).toBe(422);
    await expect(client.getFunnel()).rejects.toMatchObject({status:403,code:'SCOPE_DENIED'});
    expect(JSON.stringify(report)).not.toMatch(/Example|42|简短/);
  });

  it('forgets the installed document on demo reset',async()=>{
    const {call,client,owner}=await setup();
    await owner.setPolicy(stricter());
    expect((await call('/demo/reset','sample-owner-key',{})).status).toBe(200);
    expect((await client.getPolicy()).source).toBe('default');
  });
});

// The fake must answer in the real workspace's wire shapes (apps/workspace/src/app.ts, services/sessions.ts), so these go
// through the real SDK's validators: a drift on either side fails here instead of in lanes B/C against the fake.
describe('Workspace wire shapes through the SDK',()=>{
  const start=Date.parse('2026-10-17T20:00:00Z');
  const at=(ms:number)=>new Date(start+ms).toISOString();

  it('lists grants as GrantView with agent names, createdAt, remainingMs and a live/expired/revoked status',async()=>{
    const {client,advance}=await setup();
    await client.find({text:'trail shoes',public:{budget:'120'}},'shape-grants');
    advance(1000);
    const live=await client.getGrants();
    expect(live.sample).toBe(true);
    expect(live.grants.map(g=>g.agentName).sort()).toEqual(['Sample Shoe A','Sample Shoe B']);
    for (const g of live.grants) {
      expect(g).toMatchObject({status:'live',purpose:'auto',createdAt:at(0),expiresAt:at(GRANT_TTL_MS),remainingMs:GRANT_TTL_MS-1000,
        policyId:policyId(DEFAULT_POLICY),stage:'introduced'});
      expect(g).not.toHaveProperty('revokedAt');
    }
    const [a,b]=live.grants;
    advance(1000);
    const revoked=await client.revokeGrant(a.id);
    expect(revoked).toEqual({ok:true,revokedAt:at(2000),sample:true});
    advance(1000);
    expect(await client.revokeGrant(a.id)).toEqual(revoked);
    const after=(await client.getGrants()).grants;
    expect(after.find(g=>g.id===a.id)).toMatchObject({status:'revoked',remainingMs:0,revokedAt:at(2000)});
    expect(after.find(g=>g.id===b.id)).toMatchObject({status:'live',remainingMs:GRANT_TTL_MS-3000});
    advance(GRANT_TTL_MS);
    const expired=(await client.getGrants()).grants;
    expect(expired.find(g=>g.id===a.id)).toMatchObject({status:'revoked',remainingMs:0});
    expect(expired.find(g=>g.id===b.id)).toMatchObject({status:'expired',remainingMs:0});
    expect(expired.find(g=>g.id===b.id)).not.toHaveProperty('revokedAt');
    await expect(client.revokeGrant('no-such-grant')).rejects.toMatchObject({status:404,code:'NOT_FOUND'});
  });

  it('revokes a contribution with { ok, card } and keeps the merged card without it until reset',async()=>{
    const {call,client,owner}=await setup();
    const shoe='sample-contribution-3';
    expect((await client.getMyCard() as {card:{field:string}[]}).card.some(f=>f.field==='shoe_size')).toBe(true);
    expect((await call(`/personal/contributions/${shoe}/revoke`,'sample-shoe-a-key',{})).data.error.code).toBe('SCOPE_DENIED');
    expect((await call(`/personal/contributions/${shoe}/revoke`,'sample-other-key',{})).data.error.code).toBe('NOT_FOUND');
    const result=await client.revokeContribution(shoe);
    expect(result).toMatchObject({ok:true,sample:true});
    expect([...result.card.card,...result.card.candidates].some(f=>f.field==='shoe_size')).toBe(false);
    expect(result.card.card.find(f=>f.field==='lang')?.value).toBe('zh');
    expect((await client.revokeContribution(shoe)).card).toEqual(result.card);
    expect((await call('/personal/card')).data.card).toEqual(result.card.card);
    // The owner key may revoke too, as in the workspace.
    const byOwner=await owner.revokeContribution('sample-contribution-0');
    expect(byOwner.card.card.some(f=>f.field==='lang')).toBe(false);
    await expect(client.revokeContribution('no-such-contribution')).rejects.toMatchObject({status:404,code:'NOT_FOUND'});
    await owner.demoReset();
    expect((await call('/personal/card')).data.card.find((f:any)=>f.field==='shoe_size').value).toBe('42');
  });

  it('resets with { ok, seededAt } for the owner in demo mode only',async()=>{
    const {client,owner,advance}=await setup();
    await client.find({text:'trail shoes',public:{budget:'120'}},'shape-reset');
    advance(5000);
    await expect(client.demoReset()).rejects.toMatchObject({status:403,code:'SCOPE_DENIED'});
    expect(await owner.demoReset()).toEqual({ok:true,seededAt:at(5000),sample:true});
    expect((await client.getGrants()).grants).toEqual([]);
    const {owner:offline}=await setup(false);
    await expect(offline.demoReset()).rejects.toMatchObject({status:404,code:'NOT_FOUND'});
  });
});
