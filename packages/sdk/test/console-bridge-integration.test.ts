import { afterEach, expect, it } from 'vitest';
import { createServer, request, type Server } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Contribution, DevKeys } from '@agent-cookie/contract';
import { createApp } from '../../../apps/workspace/src/app.js';
import { loadConfig } from '../../../apps/workspace/src/config.js';
import { createDeps, type Deps } from '../../../apps/workspace/src/deps.js';
import { createWorkspaceBridge } from '../../../apps/console/server/workspace.js';
import { WorkspaceClient } from '../src/index.js';

let temp: string | undefined;
let server: Server | undefined;
let deps: Deps | undefined;
afterEach(async () => {
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); }
  if (deps) { await deps.delivery.settle(); await deps.close(); }
  if (temp) await rm(temp,{recursive:true,force:true});
});

it('routes all eleven C console methods through the actual SDK into isolated A SQLite', async () => {
  const fixturesDir=fileURLToPath(new URL('../../../fixtures/',import.meta.url));
  const keys=JSON.parse(await readFile(`${fixturesDir}/dev-keys.json`,'utf8')) as DevKeys;
  const key=Object.keys(keys).find(k=>keys[k].role==='owner')!;
  const personal=Object.keys(keys).find(k=>keys[k].role==='personal')!;
  temp=await mkdtemp(join(tmpdir(),'agent-cookie-bridge-'));
  deps=await createDeps(loadConfig({SQLITE_PATH:':memory:',FIXTURES_DIR:fixturesDir,MEMORY_REPO_PATH:join(temp,'memory'),
    AGENT_COOKIE_DEMO:'1',CALLBACK_TIMEOUT_MS:'50',CALLBACK_RETRIES:'1'}));
  const app=createApp(deps);
  const upstream: typeof fetch=async (input,init)=>app.request(String(input),init);
  await new WorkspaceClient({baseUrl:'http://127.0.0.1:4310',key:personal,fetch:upstream})
    .find({text:'trail shoes',public:{budget:'120'}},'bridge:seed');
  const calls:string[]=[];
  const sdk=async (options: ConstructorParameters<typeof WorkspaceClient>[0]) => new WorkspaceClient(options);
  const bridge=createWorkspaceBridge({key:()=>key,fetcher:upstream,sample:true,sdk:Promise.resolve(options=>{
    const client=sdk(options);
    return {
      getMe:async()=>{calls.push('getMe');return (await client).getMe();},
      getMyCard:async()=>{calls.push('getMyCard');return (await client).getMyCard();},
      getGrants:async()=>{calls.push('getGrants');return (await client).getGrants();},
      getReceipts:async()=>{calls.push('getReceipts');return (await client).getReceipts();},
      getActivity:async()=>{calls.push('getActivity');return (await client).getActivity();},
      getLearning:async()=>{calls.push('getLearning');return (await client).getLearning();},
      getLearned:async()=>{calls.push('getLearned');return (await client).getLearned();},
      setLearning:async input=>{calls.push('setLearning');return (await client).setLearning(input);},
      revokeGrant:async id=>{calls.push('revokeGrant');return (await client).revokeGrant(id);},
      revokeContribution:async id=>{calls.push('revokeContribution');return (await client).revokeContribution(id);},
      demoReset:async()=>{calls.push('demoReset');return (await client).demoReset();},
    };
  })});
  server=createServer((req,res)=>{void bridge(req,res,()=>{res.writeHead(404);res.end();});});
  await new Promise<void>((resolve,reject)=>{server!.once('error',reject);server!.listen(0,'127.0.0.1',()=>resolve());});
  const address=server.address();
  if (!address || typeof address==='string') throw new Error('No test listener');
  const send=(path:string,method='GET',body?:unknown)=>new Promise<Record<string, any>>((resolve,reject)=>{
    const req=request({host:'127.0.0.1',port:address.port,path:`/workspace-api${path}`,method,
      headers:{Host:'127.0.0.1:5173','X-Agent-Cookie-Console':'1',...(body===undefined?{}:{'Content-Type':'application/json'})}},res=>{
      let text='';res.on('data',part=>{text+=part;});res.on('end',()=>{
        try {expect(res.statusCode).toBe(200);expect(text).not.toContain(key);resolve(JSON.parse(text));} catch(error){reject(error);}
      });
    });req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
  });
  expect((await send('/me')).role).toBe('owner');
  const original=await send('/personal/card');
  const grants=await send('/personal/grants');
  expect(grants.grants.length).toBeGreaterThan(0);
  expect((await send('/personal/receipts')).receipts).toBeInstanceOf(Array);
  expect((await send('/owner/activity')).events).toBeInstanceOf(Array);
  expect(await send('/personal/learning')).toMatchObject({paused:false});
  expect(await send('/personal/learned')).toMatchObject({paused:false,learned:[]});
  expect(await send('/personal/learning','PUT',{paused:true})).toMatchObject({paused:true});
  expect(await send('/personal/learning')).toMatchObject({paused:true});
  expect(await send('/personal/learned')).toMatchObject({paused:true,learned:[]});
  expect(await send('/personal/learning','PUT',{paused:false})).toMatchObject({paused:false});
  expect(await send('/personal/learning')).toMatchObject({paused:false});
  const target=grants.grants[0].id;
  expect((await send(`/personal/grants/${encodeURIComponent(target)}/revoke`,'POST')).ok).toBe(true);
  expect((await send('/personal/grants')).grants.find((g:{id:string})=>g.id===target).status).toBe('revoked');
  const contributions=JSON.parse(await readFile(`${fixturesDir}/contributions.json`,'utf8')) as Contribution[];
  const shoe=contributions.find(c=>c.field==='shoe_size')!;
  const revoked=await send(`/personal/contributions/${encodeURIComponent(shoe.id)}/revoke`,'POST');
  expect(revoked.card.card.some((f:{field:string})=>f.field==='shoe_size')).toBe(false);
  expect((await send('/demo/reset','POST')).ok).toBe(true);
  expect((await send('/personal/grants')).grants).toEqual([]);
  expect(await send('/personal/card')).toEqual(original);
  expect(new Set(calls)).toEqual(new Set(['getMe','getMyCard','getGrants','getReceipts','getActivity','getLearning','getLearned','setLearning','revokeGrant','revokeContribution','demoReset']));
});
