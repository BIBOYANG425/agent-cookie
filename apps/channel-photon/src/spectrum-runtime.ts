import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {WorkspaceClient,workspaceConfigFromEnv} from '@agent-cookie/sdk';
import {createLearningAdapter,createObservationSink,observeSpectrumMessages,type SpectrumMessage} from './learning-capture.js';
import {createLearningControls,respondWithLearning,type LearningLocalState} from './learning-controls.js';
import {openState,ChannelFailure} from './state.js';
import {readConfig} from './config.js';
import {publicFailure} from './agent.js';
import {createLearningTelemetry} from '@agent-cookie/learn';

/** Explicit cloud migration entry; never started alongside the existing Socket.IO loop. */
export async function serveSpectrum(env:NodeJS.ProcessEnv){
  if(env.AGENT_COOKIE_LEARNING_BINDING!=='workspace-v1')throw Error('A compatible learning binding is required.');
  const projectId=env.SPECTRUM_PROJECT_ID,projectSecret=env.SPECTRUM_PROJECT_SECRET;
  if(!projectId||!projectSecret)throw Error('Spectrum cloud credentials are required.');
  const config=readConfig(env),base=workspaceConfigFromEnv(env);
  const workspace=new WorkspaceClient({...base,learning:true});
  if((await workspace.getMe()).role!=='personal')throw new ChannelFailure('PERSONAL_KEY_REQUIRED');
  // Exactly the old channel lock/binding: switching cannot discard cursor/outbox or create a second sender.
  const binding=createHash('sha256').update(JSON.stringify([config.projectId,config.testSender,config.agentHandle,base])).digest('hex');
  const store=await openState(resolve(env.AGENT_COOKIE_CHANNEL_STATE??'.runtime/channel-state.json'),binding);
  let app:{stop():Promise<void>}|undefined;
  let telemetry:ReturnType<typeof createLearningTelemetry>={metric:()=>{},shutdown:async()=>{}};
  const sink=createObservationSink({observe:(input,options)=>workspace.observe(input,options),
    metric:(status,depth)=>telemetry.metric({stage:'capture',status,count:depth,durationMs:0})});
  sink.pause();
  try{
    telemetry=createLearningTelemetry({endpoint:env.AGENT_COOKIE_LEARNING_OTLP_ENDPOINT,
      ...(env.AGENT_COOKIE_LEARNING_OTLP_TOKEN?{headers:{Authorization:`Bearer ${env.AGENT_COOKIE_LEARNING_OTLP_TOKEN}`}}:{})});
    if(Object.values(store.state.messages).some(m=>m.phase!=='sent'))throw new ChannelFailure('PENDING_LEGACY_OUTBOX');
    const remote=await workspace.getLearning();
    const local:LearningLocalState=store.state.learning??={paused:remote.paused};
    local.paused=local.paused||remote.paused;if(!local.paused)sink.resume();await store.save();
    const controls=createLearningControls({workspace,sink,state:local,save:store.save});
    const normalizer=createLearningAdapter({ownerHandle:config.testSender,identifierSalt:createHash('sha256').update(base.key).digest('hex')});
    const adapter={toEvent(message:SpectrumMessage){const event=normalizer.toEvent(message);
      return event&&store.state.messages['spectrum:'+event.messageId]?.phase!=='sent'?event:null;}};
    const {Spectrum}=await import('spectrum-ts');const {imessage}=await import('spectrum-ts/providers/imessage');
    const cloud=await Spectrum({projectId,projectSecret,providers:[imessage.config()],telemetry:false,options:{logLevel:'silent'}});app=cloud;
    const stop=()=>{sink.pause();void cloud.stop();};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
    try{
      // Provider-specific space.type is retained by Spectrum's runtime.
      const messages=cloud.messages as AsyncIterable<[Parameters<typeof cloud.send>[0],SpectrumMessage]>;
      await observeSpectrumMessages(messages,adapter,sink,async(space,message)=>{
        const event=adapter.toEvent(message);if(!event)return;
        const key='spectrum:'+event.messageId;
        const prior=store.state.messages[key];if(prior?.phase==='sent')return;
        if(prior?.phase==='sending')throw new ChannelFailure('SEND_OUTCOME_UNKNOWN');
        if(Object.keys(store.state.messages).length>=2000&&!prior)throw new ChannelFailure('STATE_CAPACITY');
        // Route contains hashes only. Actual cloud space stays in this iteration's memory.
        const row=store.state.messages[key]??={phase:'processing',route:{messageId:event.messageId,spaceId:event.conversationId,agentId:'spectrum'}};
        if(row.phase==='processing'){
          const conversation=store.state.conversations[event.conversationId]??={};
          try{row.text=await respondWithLearning(event.text,event.messageId,conversation,workspace,controls);}catch(e){row.text=publicFailure(e);}
          row.phase='ready';await store.save();
        }
        row.phase='sending';await store.save();
        try{
          // Plain send avoids unsupported quoted replies on shared lines; never auto-retry an uncertain send.
          const result=await cloud.send(space,row.text!);if(!result?.id)throw Error();
          row.outgoingId=createHash('sha256').update(result.id).digest('hex');
        }catch{throw new ChannelFailure('SEND_OUTCOME_UNKNOWN');}
        row.phase='sent';delete row.text;await store.save();
      });
    }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
  }finally{sink.pause();try{await app?.stop();}finally{try{await telemetry.shutdown();}finally{await store.close();}}}
}
