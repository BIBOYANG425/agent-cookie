import {it,expect,vi} from 'vitest';
import {WorkspaceClient,WorkspaceError} from '../src/index.js';
const input={channel:'imessage',conversationId:'hash2',turns:[{role:'user' as const,text:'I prefer black.',at:'2026-10-17T22:00:00Z'}]};
const config={baseUrl:'http://127.0.0.1:4310',key:'sample-test',learning:true};
it('requires explicit enablement only for raw observation submission',async()=>{
 const f=vi.fn();const c=new WorkspaceClient({...config,learning:false,fetch:f});
 await expect(c.observe(input)).rejects.toThrow('not enabled');expect(f).not.toHaveBeenCalled();
});
it('sends A Observation shape, without identity or invented idempotency',async()=>{
 const f=vi.fn(async()=>Response.json({queued:true}));const c=new WorkspaceClient({...config,fetch:f});
 await expect(c.observe({...input,userId:'forged'} as any)).resolves.toEqual({queued:true});
 const args=f.mock.calls[0] as unknown as [URL,RequestInit];expect(args[0].pathname).toBe('/personal/observations');expect(JSON.parse(String(args[1].body))).toEqual(input);expect(args[1].headers).not.toHaveProperty('Idempotency-Key');
});
it('uses separate state/learned endpoints and PUT paused semantics',async()=>{
 const f=vi.fn().mockResolvedValueOnce(Response.json({paused:false})).mockResolvedValueOnce(Response.json({paused:false,learned:[]})).mockResolvedValueOnce(Response.json({paused:true}));
 const c=new WorkspaceClient({...config,fetch:f});expect(await c.getLearning()).toEqual({paused:false});expect(await c.getLearned()).toEqual({paused:false,learned:[]});
 expect(await c.setLearning({enabled:false})).toEqual({paused:true});
 expect(f.mock.calls[1][0].pathname).toBe('/personal/learned');expect(f.mock.calls[2][1]).toMatchObject({method:'PUT',body:'{"paused":true}'});
});
it('rejects malformed learned rows and unpublished delete control',async()=>{
 const c=new WorkspaceClient({...config,fetch:async()=>Response.json({paused:false,learned:[{text:'SECRET'}]})});
 await expect(c.getLearned()).rejects.toThrow('Invalid learning payload.');await expect(c.setLearning({forgetKeys:['pref.color']} as any)).rejects.toThrow();
});
it('honors cancellation and backend denial',async()=>{
 const f=vi.fn(async()=>Response.json({error:{code:'SCOPE_DENIED',message:'secret'}},{status:403}));const c=new WorkspaceClient({...config,fetch:f});
 await expect(c.observe(input)).rejects.toBeInstanceOf(WorkspaceError);
 const signal=AbortSignal.abort();await expect(c.setLearning({enabled:false},{signal})).rejects.toMatchObject({name:'AbortError'});expect(f).toHaveBeenCalledTimes(1);
});

it('forgets via one authenticated endpoint and preserves pending/history semantics',async()=>{
 const result={field:'pref.color',paused:true,removed:2,projection:'pending',historyErased:false};
 const f=vi.fn(async()=>Response.json(result,{status:202}));const c=new WorkspaceClient({...config,fetch:f});
 expect(await c.forgetLearning({field:'pref.color'})).toEqual(result);
 const args=f.mock.calls[0] as unknown as [URL,RequestInit];
 expect(args[0].pathname).toBe('/personal/learning/forget');expect(JSON.parse(String(args[1].body))).toEqual({field:'pref.color'});
 await expect(c.forgetLearning({field:'shipping_address'} as any)).rejects.toThrow();expect(f).toHaveBeenCalledTimes(1);
});

it('forwards opaque message IDs and preserves duplicate acknowledgements',async()=>{
 const f=vi.fn(async()=>Response.json({queued:false,duplicate:true}));const c=new WorkspaceClient({...config,fetch:f});
 const observed={...input,turns:input.turns.map(t=>({...t,messageId:'opaque-message-1'}))};
 expect(await c.observe(observed)).toEqual({queued:false,duplicate:true});
 const args=f.mock.calls[0] as unknown as [URL,RequestInit];expect(JSON.parse(String(args[1].body))).toEqual(observed);
 await expect(c.observe({...input,turns:input.turns.map(t=>({...t,messageId:'x'.repeat(129)}))})).rejects.toThrow();
 expect(f).toHaveBeenCalledTimes(1);
});

const learnedWithModels=(models:unknown)=>({paused:false,learned:[{field:'pref.color',value:'black',status:'candidate',sources:['personal'],
 evidence:[{contributionId:'c1',agentId:'personal',basis:'observed',createdAt:'2026-10-17T22:00:00Z',conversationId:'conv1',snippet:'prefer black',models,rawTranscript:'DO NOT RETURN'}]}]});
it('preserves B60 model provenance while stripping unrecognized raw evidence',async()=>{
 const models={gate:'typesafe/jev-1.14',extractor:'openai/gpt-oss-120b'};
 const c=new WorkspaceClient({...config,fetch:async()=>Response.json(learnedWithModels(models))});
 const result=await c.getLearned();expect(result.learned[0].evidence[0].models).toEqual(models);
 expect(result.learned[0].evidence[0]).not.toHaveProperty('rawTranscript');
});
it.each([null,[],{gate:'x'.repeat(101)},{extractor:'model secret'},{gate:'valid',rawTranscript:'secret'}])('rejects malformed B60 model metadata %#',async models=>{
 const c=new WorkspaceClient({...config,fetch:async()=>Response.json(learnedWithModels(models))});
 await expect(c.getLearned()).rejects.toThrow('Invalid learning payload.');
});
