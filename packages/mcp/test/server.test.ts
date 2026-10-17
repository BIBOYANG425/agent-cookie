import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createPersonalServer, type PersonalWorkspaceBinding } from '../src/server.js';
import { readConfig } from '../src/config.js';

const sampleCard = { sample: true, card: [
  { field: 'lang', value: 'zh' }, { field: 'tone', value: 'concise' }, { field: 'shoe_size', value: '42' },
], candidates: [] };
const closers: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(closers.splice(0).map(close => close())); });

async function connect(read: PersonalWorkspaceBinding['getMyCard'], extra: Partial<PersonalWorkspaceBinding> = {}) {
  const server = await createPersonalServer({ getAuthenticatedRole: async () => 'personal', getMyCard: read, ...extra });
  const client = new Client({ name: 'B-lane-test', version: '0.0.0' });
  const [left, right] = InMemoryTransport.createLinkedPair();
  await server.connect(left);
  await client.connect(right);
  closers.push(() => client.close(), () => server.close());
  return client;
}

describe('personal MCP boundary', () => {
  it('exposes only the implemented tool and completes a real MCP protocol call', async () => {
    const client = await connect(async () => sampleCard);
    const list = await client.listTools();
    expect(list.tools.map(t => t.name)).toEqual(['get_my_card']);
    const result = await client.callTool({ name: 'get_my_card', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(sampleCard) }]);
  });
  it('does not expose personal tools for merchant or unknown roles', async () => {
    for (const role of ['merchant', 'owner', 'unknown', '']) {
      await expect(createPersonalServer({ getAuthenticatedRole: async () => role, getMyCard: async () => sampleCard })).rejects.toThrow('personal workspace credential');
    }
  });
  it('reads again on each call and propagates a revoked read without cached data', async () => {
    let calls = 0;
    const client = await connect(async () => {
      if (++calls > 1) throw { code: 'GRANT_REVOKED', message: 'private address + secret key' };
      return sampleCard;
    });
    await client.callTool({ name: 'get_my_card', arguments: {} });
    const denied = await client.callTool({ name: 'get_my_card', arguments: {} });
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied)).toContain('GRANT_REVOKED');
    expect(JSON.stringify(denied)).not.toContain('private address');
    expect(JSON.stringify(denied)).not.toContain('shoe_size');
  });
  it('redacts unknown upstream failures', async () => {
    const client = await connect(async () => { throw new Error('Bearer private-test-key'); });
    const failed = await client.callTool({ name: 'get_my_card', arguments: {} });
    expect(failed.isError).toBe(true);
    expect(JSON.stringify(failed)).toContain('WORKSPACE_UNAVAILABLE');
    expect(JSON.stringify(failed)).not.toContain('private-test-key');
  });
});

describe('generic shopping MCP protocol',()=>{
  it('advertises original request and optional extraction fields without a category default',async()=>{
    const client=await connect(async()=>sampleCard,{find:vi.fn()});
    const tool=(await client.listTools()).tools.find(t=>t.name==='find_agents')!;
    expect(Object.keys(tool.inputSchema.properties!)).toEqual(['request','query','budget','size','color','deadline']);
    expect(tool.inputSchema.required).toEqual(['request']);
    expect(tool.description).toContain('sizeNote verbatim');
    expect(tool.description).not.toContain('trail-shoe');
  });
  it('maps supplied fields, preserves request and sizeNote, and omits unextracted conditions',async()=>{
    const payload={intentId:'i',sample:true,quotes:[{sizeNote:'没有 M，有 S、L'}]};
    const find=vi.fn<NonNullable<PersonalWorkspaceBinding['find']>>().mockResolvedValue(payload);
    const client=await connect(async()=>sampleCard,{find});
    const request='  找件黑色外套，M码，100到160美元，周五前到。\n';
    const args={request,query:'black jacket',budget:'100-160',size:'M',color:'黑色',deadline:'周五前到'};
    const result=await client.callTool({name:'find_agents',arguments:args});
    expect(result.isError).not.toBe(true);
    expect(find.mock.calls[0][0]).toEqual({text:request,query:args.query,public:{budget:args.budget,size:args.size,color:args.color,deadline:args.deadline}});
    expect(result.content).toEqual([{type:'text',text:JSON.stringify(payload)}]);
    await client.callTool({name:'find_agents',arguments:{request:'给朋友挑个礼物'}});
    expect(find.mock.calls[1][0]).toEqual({text:'给朋友挑个礼物'});
    expect(find.mock.calls[1][1]).not.toBe(find.mock.calls[0][1]);
    const old=await client.callTool({name:'find_agents',arguments:{kind:'trail_shoes'}});
    expect(old.isError).toBe(true);expect(find).toHaveBeenCalledTimes(2);
  });
});

describe('workspace configuration', () => {
  it('requires a key and uses the agreed loopback address', () => {
    expect(() => readConfig({})).toThrow('AGENT_COOKIE_KEY');
    expect(readConfig({ AGENT_COOKIE_KEY: 'sample-test-key' }).baseUrl).toBe('http://127.0.0.1:4310');
  });
  it('refuses destinations or embedded credentials outside the local contract', () => {
    for (const url of ['http://remote.example', 'http://user:secret@localhost:4310', 'http://localhost:4310/?key=secret', 'file:///tmp/x', 'not a url']) {
      expect(() => readConfig({ AGENT_COOKIE_KEY: 'sample-test-key', AGENT_COOKIE_URL: url })).toThrow();
    }
  });
});

describe('observation tool',()=>{
  it('exposes only text, not claimed identity or source ids',async()=>{
    const observe=vi.fn(async()=>({accepted:true}));const client=await connect(async()=>sampleCard,{observe});
    const tool=(await client.listTools()).tools.find(t=>t.name==='observe')!;
    expect(Object.keys(tool.inputSchema.properties!)).toEqual(['text']);
    await client.callTool({name:'observe',arguments:{text:'我一直喜欢黑色衣服。',userId:'other'}});
    expect(observe).toHaveBeenCalledWith('我一直喜欢黑色衣服。');
  });
  it('drops sensitive and quoted speech without calling backend',async()=>{
    const observe=vi.fn();const client=await connect(async()=>sampleCard,{observe});
    for(const text of ['我有哮喘，最近药费很贵；我喜欢蓝色。','他说我喜欢红色。']){
      const r=await client.callTool({name:'observe',arguments:{text}});expect(JSON.stringify(r)).toContain('false');
    }expect(observe).not.toHaveBeenCalled();
  });
  it('requires host conversation configuration to enable the proposal',()=>{
    expect(()=>readConfig({AGENT_COOKIE_KEY:'sample',AGENT_COOKIE_LEARNING_BINDING:'workspace-v1'})).toThrow();
    expect(readConfig({AGENT_COOKIE_KEY:'sample',AGENT_COOKIE_LEARNING_BINDING:'workspace-v1',AGENT_COOKIE_LEARNING_CONVERSATION_ID:'host-session'}).learning).toBeDefined();
  });
});
