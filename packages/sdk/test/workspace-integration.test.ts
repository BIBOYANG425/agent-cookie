import { afterEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DevKeys } from '@agent-cookie/contract';
import { createApp } from '../../../apps/workspace/src/app.js';
import { loadConfig } from '../../../apps/workspace/src/config.js';
import { createDeps, type Deps } from '../../../apps/workspace/src/deps.js';
import { WorkspaceClient } from '../src/index.js';

const cleanups: Deps[]=[];
afterEach(async()=>{for(const deps of cleanups.splice(0)){await deps.delivery.settle();deps.close();}});

async function setup(fixturesDir: string, outcome='requires_escalation') {
  const deps=await createDeps(loadConfig({SQLITE_PATH:':memory:',FIXTURES_DIR:fixturesDir,
    AGENT_COOKIE_DEMO:'1',AGENT_COOKIE_UCP:'fixture',UCP_STUB_COMPLETE:outcome,
    CALLBACK_TIMEOUT_MS:'50',CALLBACK_RETRIES:'1'}));
  cleanups.push(deps);
  const app=createApp(deps);
  const keys=JSON.parse(readFileSync(`${fixturesDir}/dev-keys.json`,'utf8')) as DevKeys;
  const client=(key: string)=>new WorkspaceClient({baseUrl:'http://127.0.0.1:4310',key,sample:true,
    fetch:async(input,init)=>app.request(String(input),init)});
  const personals=Object.entries(keys).filter(([,v])=>v.role==='personal').map(([key])=>client(key));
  const owner=client(Object.entries(keys).find(([,v])=>v.role==='owner')![0]);
  return {personals,owner};
}

it('connects both personal agents to A SQLite with C seed, preserving pairwise identity and truthful missing-address handoff',async()=>{
  const root=fileURLToPath(new URL('../../../fixtures/',import.meta.url));
  const {personals:[photon,desktop],owner}=await setup(root);
  const card=await photon.getMyCard();
  expect(card).toMatchObject({sample:true,card:expect.arrayContaining([
    expect.objectContaining({field:'lang',value:'zh'}),expect.objectContaining({field:'shoe_size',value:'42'}),
  ])});
  expect(await desktop.getMyCard()).toEqual(card);
  const input={kind:'trail_shoes' as const,public:{budget:'120',deadline:'周五前到'}};
  const first=await photon.find(input,'integration:photon');
  expect(first.sample).toBe(true);expect(first.quotes).toHaveLength(2);
  expect(first.quotes.every(q=>Number.isSafeInteger(q.price)&&q.currency==='USD'&&q.etaDate===null)).toBe(true);
  const before=(await owner.getActivity()).activity.filter(e=>e.event==='introduce');
  expect(before.length).toBeGreaterThanOrEqual(2);
  expect(new Set(before.map(e=>e.object)).size).toBe(before.length);
  const second=await desktop.find(input,'integration:desktop');
  const after=(await owner.getActivity()).activity.filter(e=>e.event==='introduce');
  for(const old of before)expect(after.some(e=>e.id!==old.id&&e.reason===old.reason&&e.object===old.object)).toBe(true);
  const accepted=await desktop.accept(second.quotes[1].id,'integration:accept');
  expect(accepted).toMatchObject({status:'handoff',sample:true});
  expect(accepted.message).toContain('shipping address');
  // C's standalone address.json is not a card contribution: do not invent a disclosure receipt.
  expect((await desktop.getReceipts()).receipts.filter(r=>r.purpose==='checkout')).toHaveLength(0);
  expect(await desktop.accept(second.quotes[1].id,'integration:accept')).toEqual(accepted);
  await expect(desktop.getActivity()).rejects.toMatchObject({status:403,code:'SCOPE_DENIED'});
});

it('preserves a selected-merchant checkout receipt from A own Sample seed',async()=>{
  const root=fileURLToPath(new URL('../../../apps/workspace/sample-fixtures/',import.meta.url));
  const {personals:[client]}=await setup(root);
  const found=await client.find({kind:'trail_shoes',public:{budget:'120'}},'receipt:find');
  const selected=found.quotes[1];
  expect(await client.accept(selected.id,'receipt:accept')).toMatchObject({status:'handoff',sample:true});
  const receipts=(await client.getReceipts()).receipts.filter(r=>r.purpose==='checkout');
  expect(receipts).toHaveLength(1);
  expect(receipts[0]).toMatchObject({agentId:selected.agentId,fields:['shipping_address']});
});
