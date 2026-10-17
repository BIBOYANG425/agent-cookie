import {createHmac} from 'node:crypto';
import {bounded,filterTurn,type LearningTurn} from '@agent-cookie/learn';
import type {ObservationInput,ObserveResult,RequestOptions} from '@agent-cookie/sdk';

/** Structural subset verified against spectrum-ts 12.11.0's cloud iMessage provider. */
export interface SpectrumMessage {
  id:string;platform:string;direction:string;timestamp:Date;
  sender?:{id:string;kind?:string};space:{id:string;type?:string};
  content:{type:string;text?:string};extra?:{isFromMe?:boolean};
}
export function createLearningAdapter(options:{ownerHandle:string;identifierSalt:string;now?:()=>number}) {
  if(!options.ownerHandle||options.identifierSalt.length<32) throw new Error('Learning capture requires a configured owner and identifier salt.');
  const hash=(kind:string,value:string)=>createHmac('sha256',options.identifierSalt).update(kind+'\0'+value).digest('hex');
  return {toEvent(message:SpectrumMessage):LearningTurn|null {
    // Sender and DM classification come from the authenticated provider, never message text.
    if(message.platform!=='imessage'||message.direction!=='inbound'||message.sender?.id!==options.ownerHandle
      ||message.sender.kind==='agent'||message.space.type!=='dm'||message.extra?.isFromMe
      ||message.content.type!=='text'||typeof message.content.text!=='string'||!message.id||!message.space.id) return null;
    const at=message.timestamp?.getTime();const now=(options.now??Date.now)();
    if(!Number.isFinite(at)||at>now+5000||at<now-300000) return null;
    return {text:message.content.text,messageId:hash('message',message.id),conversationId:hash('conversation',message.space.id),
      occurredAt:message.timestamp.toISOString(),source:'photon',speaker:'owner',isGroup:false};
  }};
}
export type CaptureMetric=(status:'queued'|'dropped'|'accepted'|'unavailable',depth:number)=>void;

/** Best-effort, memory-only observations. No raw-text persistence or retry outbox. */
export function createObservationSink(options:{
  observe:(input:ObservationInput,key:string,options?:RequestOptions)=>Promise<ObserveResult>;
  capacity?:number;ttlMs?:number;timeoutMs?:number;now?:()=>number;metric?:CaptureMetric;
}) {
  const capacity=options.capacity??32,ttl=options.ttlMs??30000,timeout=options.timeoutMs??10000;
  if(!Number.isInteger(capacity)||capacity<1||capacity>32||ttl<1||ttl>30000||timeout<1||timeout>10000) throw Error('Invalid learning queue limits.');
  const now=options.now??Date.now;
  const queue:Array<{turn:LearningTurn;at:number;generation:number}>=[];
  const seen=new Set<string>();let active=false,enabled=true,generation=0,controller:AbortController|undefined;
  const metric=(s:Parameters<CaptureMetric>[0])=>{try{options.metric?.(s,queue.length)}catch{/* no reply coupling */}};
  const pump=async()=>{
    if(active) return; active=true;
    try {while(enabled&&queue.length){
      const item=queue.shift()!;
      if(item.generation!==generation||now()-item.at>ttl){metric('dropped');continue;}
      controller=new AbortController();
      try{
        const t=item.turn;
        const body:ObservationInput={text:t.text,messageId:t.messageId,conversationId:t.conversationId,occurredAt:t.occurredAt,source:t.source};
        const result=await bounded(s=>options.observe(body,`observe:${t.messageId}`,{signal:s}),timeout,controller.signal);
        metric(item.generation===generation&&result.accepted?'accepted':'dropped');
      }catch{metric('unavailable');}
      finally{controller=undefined;}
    }}finally{active=false;}
  };
  return {
    enqueue(turn:LearningTurn):boolean {
      try{
        if(!enabled||filterTurn(turn)||seen.has(turn.messageId)||queue.length>=capacity){metric('dropped');return false;}
        seen.add(turn.messageId);if(seen.size>2048)seen.delete(seen.values().next().value!);
        queue.push({turn:{...turn},at:now(),generation});metric('queued');void pump();return true;
      }catch{metric('dropped');return false;}
    },
    pause(){enabled=false;generation++;queue.length=0;controller?.abort();},
    resume(){enabled=true;},
    get enabled(){return enabled;},
    get pending(){return queue.length+(active?1:0);},
  };
}
export type ObservationSink=ReturnType<typeof createObservationSink>;

/** Call on the application's existing app.messages loop, never a second listener. */
export async function observeSpectrumMessages<S,M extends SpectrumMessage>(
  messages:AsyncIterable<[S,M]>,adapter:{toEvent(message:M):LearningTurn|null},sink:ObservationSink,
  reply:(space:S,message:M)=>Promise<void>,
) {
  for await(const [space,message] of messages){
    try{const event=adapter.toEvent(message);if(event)sink.enqueue(event);}catch{/* collection never breaks replies */}
    await reply(space,message);
  }
}
