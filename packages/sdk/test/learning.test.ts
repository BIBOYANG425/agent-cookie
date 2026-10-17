import {it,expect,vi} from 'vitest';
import {WorkspaceClient,PROPOSED_LEARNING_BINDING,WorkspaceError} from '../src/index.js';
const input={source:'photon' as const,messageId:'hash1',conversationId:'hash2',occurredAt:'2026-10-17T22:00:00Z',text:'I prefer black.'};
const config={baseUrl:'http://127.0.0.1:4310',key:'sample-test',learning:PROPOSED_LEARNING_BINDING};
it('requires explicit binding and never probes unknown routes',async()=>{
 const f=vi.fn();const c=new WorkspaceClient({...config,learning:undefined,fetch:f});
 await expect(c.observe(input,'idem')).rejects.toThrow('not configured');expect(f).not.toHaveBeenCalled();
});
it('sends exact proposed observation without claimed identity, authority or transcript',async()=>{
 const f=vi.fn(async()=>Response.json({accepted:true,observationId:'observation-1'}));const c=new WorkspaceClient({...config,fetch:f});
 await expect(c.observe({...input,userId:'forged'} as any,'dedup')).resolves.toEqual({accepted:true,observationId:'observation-1'});
 const args=f.mock.calls[0] as unknown as [URL,RequestInit];expect(args[0].pathname).toBe('/personal/observations');expect(JSON.parse(String(args[1].body))).toEqual(input);expect(args[1].headers).toMatchObject({'Idempotency-Key':'dedup'});
});
it('reads only validated conclusions and requires confirmation for forget',async()=>{
 const f=vi.fn().mockResolvedValueOnce(Response.json({enabled:true,generation:1,learned:[]})).mockResolvedValueOnce(Response.json({enabled:false,generation:2,forgottenKeys:['pref.color']}));
 const c=new WorkspaceClient({...config,fetch:f});expect((await c.getLearning()).generation).toBe(1);
 expect(await c.setLearning({enabled:false,forgetKeys:['pref.color']})).toEqual({enabled:false,generation:2,forgottenKeys:['pref.color']});
});
it('rejects unsafe endpoints and malformed responses without echoing content',async()=>{
 expect(()=>new WorkspaceClient({...config,learning:{...PROPOSED_LEARNING_BINDING,status:'https://example.com'}})).toThrow();
 const c=new WorkspaceClient({...config,fetch:async()=>Response.json({enabled:true,generation:1,learned:[{text:'SECRET'}]})});
 await expect(c.getLearning()).rejects.toThrow('Invalid learning payload.');
});
it('honors cancellation and backend denial',async()=>{
 const f=vi.fn(async()=>Response.json({error:{code:'SCOPE_DENIED',message:input.text}},{status:403}));const c=new WorkspaceClient({...config,fetch:f});
 await expect(c.observe(input,'dedup')).rejects.toBeInstanceOf(WorkspaceError);
 const signal=AbortSignal.abort();await expect(c.setLearning({enabled:false},{signal})).rejects.toMatchObject({name:'AbortError'});expect(f).toHaveBeenCalledTimes(1);
});
