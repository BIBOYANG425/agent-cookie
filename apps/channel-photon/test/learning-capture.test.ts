import {it,expect,vi} from 'vitest';
import {createLearningAdapter,createObservationSink,observeSpectrumMessages,type SpectrumMessage} from '../src/learning-capture.js';
const msg:SpectrumMessage={id:'msg1',platform:'imessage',direction:'inbound',timestamp:new Date(),sender:{id:'owner'},space:{id:'dm1',type:'dm'},content:{type:'text',text:'我一直喜欢黑色衣服。'}};
const adapter=createLearningAdapter({ownerHandle:'owner',identifierSalt:'sample-salt-'.repeat(4)});
it('normalizes only the configured owner DM, hashes identifiers',()=>{
 const event=adapter.toEvent(msg)!;expect(event.text).toBe(msg.content.text);expect(event.messageId).toMatch(/^[a-f0-9]{64}$/);expect(event.conversationId).not.toContain('dm1');
 for(const bad of [{...msg,sender:{id:'other'}},{...msg,space:{id:'group',type:'group'}},{...msg,direction:'outbound'},{...msg,sender:{id:'owner',kind:'agent'}},{...msg,space:{id:'unknown'}}])expect(adapter.toEvent(bad)).toBeNull();
});
it('never waits for a stuck observation on the reply path',async()=>{
 const observe=vi.fn(()=>new Promise<never>(()=>{}));const sink=createObservationSink({observe,timeoutMs:20});const reply=vi.fn(async()=>{});
 async function* messages():AsyncGenerator<[{},SpectrumMessage]>{yield [{},msg];}
 await observeSpectrumMessages(messages(),adapter,sink,reply);expect(reply).toHaveBeenCalledOnce();expect(sink.pending).toBe(1);sink.pause();
});
it('drops sensitive speech and other group speakers before enqueue',()=>{
 const observe=vi.fn();const sink=createObservationSink({observe});
 expect(sink.enqueue({...adapter.toEvent(msg)!,text:'我有哮喘，最近药费很贵；我喜欢蓝色。'})).toBe(false);
 expect(sink.enqueue({...adapter.toEvent(msg)!,isGroup:true,speaker:'other'})).toBe(false);expect(observe).not.toHaveBeenCalled();
});
it('bounds queue, deduplicates, aborts and clears on pause',async()=>{
 const observe=vi.fn(()=>new Promise<never>(()=>{}));const sink=createObservationSink({observe,capacity:1,timeoutMs:20});const event=adapter.toEvent(msg)!;
 expect(sink.enqueue(event)).toBe(true);expect(sink.enqueue(event)).toBe(false);
 expect(sink.enqueue({...event,messageId:'m2'})).toBe(true);expect(sink.enqueue({...event,messageId:'m3'})).toBe(false);
 sink.pause();expect(sink.enqueue({...event,messageId:'m4'})).toBe(false);
 await new Promise(r=>setTimeout(r,25));expect(sink.pending).toBe(0);
});
it('does not retry rejected observations or propagate adapter/observer errors',async()=>{
 const observe=vi.fn(async()=>{throw Error('PRIVATE')});const sink=createObservationSink({observe});const reply=vi.fn(async()=>{});
 async function* messages():AsyncGenerator<[{},SpectrumMessage]>{yield [{},msg];yield [{},msg];}
 await observeSpectrumMessages(messages(),adapter,sink,reply);expect(reply).toHaveBeenCalledTimes(2);expect(observe).toHaveBeenCalledOnce();
});
