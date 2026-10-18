import { expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { DevKeys, UcpApi, UcpOffer, UcpSearchQuery } from '../../contract/src/index.js';
import { WorkspaceClient } from '@agent-cookie/sdk';
import { createApp } from '../../../apps/workspace/src/app.js';
import { createDeps } from '../../../apps/workspace/src/deps.js';
import { loadConfig } from '../../../apps/workspace/src/config.js';
import { respond } from '../../../apps/channel-photon/src/agent.js';

// Actual built stdio MCP → SDK → TCP/HTTP → A SQLite + real C rules/Git memory.
// Only the catalog is synthetic. This is not a live merchant or real iMessage/Claude Desktop acceptance.
it('carries shoe, coat and gift requests through MCP and Photon into the text workspace',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'agent-cookie-text-'));
  const root=fileURLToPath(new URL('../../../fixtures/',import.meta.url));
  const keys=JSON.parse(await readFile(join(root,'dev-keys.json'),'utf8')) as DevKeys;
  const personal=Object.keys(keys).find(k=>keys[k].agentId==='sample-personal-desktop')!;
  const searchOffers=vi.fn<UcpApi['searchOffers']>(async q=>{
    const product = /外套|coat/i.test(q.query) ? 'Sample coat' : /礼物|gift/i.test(q.query) ? 'Sample gift' : 'Sample shoes';
    return ['a','b'].map((name):UcpOffer=>({sellerDomain:`${name}.example.com`,sellerName:`Sample ${name}`,
      productTitle:product,variantId:`sample-${product}-${name}`,variantTitle:product==='Sample shoes'?'EU 40':'Default Title',
      priceCents:2500,currency:'USD',available:true,shipsTo:['US'],sizeOptions:product==='Sample shoes'?['EU 40']:[],
      nativeCheckout:false,etaDate:null}));
  });
  const noCheckout=vi.fn(async()=>{throw Error('Checkout not authorized by this test');});
  const ucp:UcpApi={searchOffers,createCart:noCheckout,createCheckout:noCheckout,setDestination:noCheckout,complete:noCheckout};
  const deps=await createDeps(loadConfig({SQLITE_PATH:join(temp,'db.sqlite'),MEMORY_REPO_PATH:join(temp,'memory'),
    FIXTURES_DIR:root,AGENT_COOKIE_DEMO:'1',AGENT_COOKIE_TEST:'1',AGENT_COOKIE_UCP:'fixture'}),{ucp});
  const app=createApp(deps);
  const bodies:unknown[]=[];
  const server=createServer(async(req,res)=>{
    try {
      const chunks:Buffer[]=[];for await(const chunk of req) chunks.push(Buffer.from(chunk));
      const body=Buffer.concat(chunks).toString();
      if(req.url==='/personal/intents')bodies.push(JSON.parse(body));
      const headers=new Headers();for(const [k,v] of Object.entries(req.headers))if(typeof v==='string')headers.set(k,v);
      const reply=await app.request(`http://127.0.0.1${req.url}`,{method:req.method,headers,...(body?{body}:{})});
      res.writeHead(reply.status,Object.fromEntries(reply.headers.entries()));res.end(await reply.text());
    }catch{res.writeHead(500).end();}
  });
  let mcp:Client|undefined;
  try {
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../dist/main.js',import.meta.url))],
      cwd:fileURLToPath(new URL('..',import.meta.url)),env:{AGENT_COOKIE_KEY:personal,AGENT_COOKIE_URL:url,AGENT_COOKIE_SAMPLE:'1'},stderr:'pipe'});
    mcp=new Client({name:'text-integration',version:'1'});await mcp.connect(transport);
    const phone=new WorkspaceClient({baseUrl:url,key:Object.keys(keys).find(k=>keys[k].agentId==='sample-personal-photon')!,sample:true});
    const needs=[
      {request:'帮我找双日常通勤鞋，42码，预算90美元。',query:'walking shoes',budget:'90',size:'42'},
      {request:'帮我找件黑色外套，M码，150美元以内，周五前到。',query:'black coat',budget:'150',size:'M',color:'黑色',deadline:'周五前到'},
      {request:'给朋友挑个生日礼物，60美元以内，下周三前送到。',query:'birthday gift',budget:'60',deadline:'下周三前送到'},
    ];
    for(const [index,need] of needs.entries()) {
      const reply=await mcp.callTool({name:'find_agents',arguments:need});expect(reply.isError).not.toBe(true);
      const quoteResult=JSON.parse((reply.content as Array<{text:string}>)[0].text);
      expect(quoteResult.quotes).toHaveLength(2);expect(quoteResult.sample).toBe(true);
      const last=searchOffers.mock.calls.at(-1)![0];
      expect(last).toMatchObject({query:need.query,intentText:need.request,maxPriceCents:Number(need.budget)*100});
      const {request,query,...conditions}=need;
      expect(bodies.at(-1)).toEqual({text:request,query,public:conditions});
      const sms=await respond(need.request,`sample-${index}`,{},phone);
      expect(searchOffers.mock.calls.at(-1)![0]).toMatchObject({query:need.request,intentText:need.request});
      expect(bodies.at(-1)).toEqual({text:request,public:conditions});
      expect(sms).toContain('Sample');expect(sms).toContain('选1');
      if(index===0){expect(quoteResult.quotes[0].sizeNote).toBeTruthy();expect(sms).toContain(quoteResult.quotes[0].sizeNote);}
    }
    await mcp.callTool({name:'find_agents',arguments:{request:'a gift'}});
    const unqualified:UcpSearchQuery=searchOffers.mock.calls.at(-1)![0];
    expect(unqualified).not.toHaveProperty('maxPriceCents');expect(bodies.at(-1)).toEqual({text:'a gift'});
    // No checkout happened, so no purpose release: every receipt is a UCP store's handshake read (auto fields only).
    const receipts=(await phone.getReceipts()).receipts;
    expect(receipts.length).toBeGreaterThan(0);
    expect(receipts.filter(r=>r.purpose!=='handshake')).toEqual([]);
    expect(receipts.filter(r=>r.fields.includes('shipping_address')||r.fields.includes('payment_method'))).toEqual([]);
    expect(noCheckout).not.toHaveBeenCalled();
  } finally {
    await mcp?.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
    await deps.close();await rm(temp,{recursive:true,force:true});
  }
},30_000);
