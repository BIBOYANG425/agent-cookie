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
