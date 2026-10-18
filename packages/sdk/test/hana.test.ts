import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {WorkspaceClient,resolveForgetPreference,type LearnedResponse} from '../src/index.js';
import {conversationIdForChat,operationIdForMessage} from '../src/hana-identifiers.js';
describe('HANA transport identity',()=>{
  it('registers a dedicated personal agent using the configured owner transport',async()=>{
    const seen:any[]=[];
    const client=new WorkspaceClient({baseUrl:'http://127.0.0.1:4314',key:'test-owner',fetch:async(url,init)=>{
      seen.push({url:String(url),auth:new Headers(init?.headers).get('authorization'),body:JSON.parse(String(init?.body))});
      return Response.json({agentId:'ag_hana_test',key:'test-minted-key',category:'personal',role:'personal'}, {status:201});
    }});
    expect(await client.registerPersonalAgent('HANA / Marin')).toMatchObject({agentId:'ag_hana_test',role:'personal'});
    expect(seen).toEqual([{url:'http://127.0.0.1:4314/agents/register',auth:'Bearer test-owner',body:{name:'HANA / Marin',category:'personal',capabilities:[]}}]);
    await expect(client.registerPersonalAgent('')).rejects.toThrow();
    expect(seen).toHaveLength(1);
  });
  it('hashes exact trusted identifiers consistently',()=>{
    expect(conversationIdForChat('chat')).toBe(createHash('sha256').update('chat').digest('hex').slice(0,16));
    expect(operationIdForMessage('guid','find')).toBe(createHash('sha256').update('guidfind').digest('hex'));
    expect(operationIdForMessage('guid','find')).not.toBe(operationIdForMessage('guid','accept'));
    expect(()=>operationIdForMessage('','find')).toThrow();
  });
  it('forwards conversationId without accepting identity/authority extras',async()=>{
    let body:any;
    const client=new WorkspaceClient({baseUrl:'http://127.0.0.1:4310',key:'sample-key',fetch:async(_url,init)=>{
      body=JSON.parse(String(init?.body));return Response.json({intentId:'i',sample:true});
    }});
    await client.createIntent({text:'hello',conversationId:'0123456789abcdef',userId:'untrusted'} as any,'find-key');
    expect(body).toEqual({text:'hello',conversationId:'0123456789abcdef'});
    await expect(client.createIntent({text:'hello',conversationId:'bad /'},'find-key')).rejects.toThrow();
  });
  it('resolves category labels without widening a value-only deletion',()=>{
    const rows=[{field:'pref.color',value:'black'},{field:'pref.color',value:'white'},{field:'pref.fit',value:'loose'}] as LearnedResponse['learned'];
    expect(resolveForgetPreference('颜色',rows)).toEqual({kind:'resolved',field:'pref.color'});
    expect(resolveForgetPreference('black',rows).kind).toBe('partial');
    expect(resolveForgetPreference('loose',rows)).toEqual({kind:'resolved',field:'pref.fit'});
    expect(resolveForgetPreference('unknown',rows).kind).toBe('missing');
  });
});
