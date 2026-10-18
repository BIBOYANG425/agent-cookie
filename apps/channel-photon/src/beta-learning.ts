import {createLearningTelemetry} from '@agent-cookie/learn';
import type {WorkspaceClient} from '@agent-cookie/sdk';
import {createLearningAdapter,createObservationSink,type CaptureMetric} from './learning-capture.js';
import {createLearningControls,isShoppingRequest,respondWithLearning,type LearningWorkspace} from './learning-controls.js';
import type {AgentWorkspace} from './agent.js';
import type {ChannelState} from './state.js';
import type {DeliveryLearning} from './runtime.js';

/** Photon 2.0 Beta has a different credential/event contract from Spectrum Cloud.
 * Called only inside the existing authenticated, owner-filtered delivery loop.
 * This adapter never opens another listener or reads the Mac's Messages database.
 */
export async function createBetaLearning(options:{
  workspace:AgentWorkspace&LearningWorkspace&Pick<WorkspaceClient,'observe'>;
  state:ChannelState;save:()=>Promise<void>;ownerHandle:string;identifierSalt:string;
  endpoint?:string;metric?:CaptureMetric;
}):Promise<DeliveryLearning&{pause():void;close():Promise<void>}>{
  const remote=await options.workspace.getLearning();
  const local=options.state.learning??={paused:remote.paused};
  local.paused=local.paused||remote.paused;
  await options.save();
  const telemetry=createLearningTelemetry({endpoint:options.endpoint});
  const sink=createObservationSink({observe:(input,request)=>options.workspace.observe(input,request),
    metric:(status,depth)=>{
      telemetry.metric({stage:'capture',status,count:depth,durationMs:0});
      options.metric?.(status,depth);
    }});
  if(local.paused)sink.pause();
  const adapter=createLearningAdapter({ownerHandle:options.ownerHandle,identifierSalt:options.identifierSalt});
  const controls=createLearningControls({workspace:options.workspace,sink,state:local,save:options.save});
  return {
    capture(incoming){
      // Commands must affect learning, not become evidence for learning.
      if(/^(?:暂停学习|恢复学习|pause learning|resume learning|忘掉|忘记|forget)/i.test(incoming.text.trim()))return;
      // The workspace already learns a submitted shopping intent. Do not count the
      // same message again as an independent conversation source five minutes later.
      if(isShoppingRequest(incoming.text))return;
      const event=adapter.toEvent({id:incoming.messageId,platform:'imessage',direction:'inbound',
        timestamp:new Date(incoming.occurredAt),sender:{id:options.ownerHandle,kind:'human'},
        space:{id:incoming.spaceId,type:'dm'},content:{type:'text',text:incoming.text}});
      if(event)sink.enqueue(event); // memory-only and non-blocking; model calls are in the workspace
    },
    respond:(incoming,conversation)=>respondWithLearning(incoming.text,incoming.messageId,conversation,options.workspace,controls),
    pause:()=>sink.pause(),
    async close(){sink.pause();await telemetry.shutdown();},
  };
}
