import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { io } from 'socket.io-client';
import { Photon } from '@photon-ai/api';
import { WorkspaceClient, workspaceConfigFromEnv } from '@agent-cookie/sdk';
import { respond, publicFailure, operationKey, type AgentWorkspace, type Conversation } from './agent.js';
import { readConfig, type PhotonConfig } from './config.js';
import { ChannelFailure, openState, type ChannelState } from './state.js';
import type { ReplyRoute } from './probe.js';

const object = (v: unknown): v is Record<string,unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === 'string' && /^[\w:-]{1,200}$/.test(v);
export const API_VERSION = '2026-07-01';
export type IncomingMessage=ReplyRoute&{text:string;occurredAt:string};
export interface DeliveryLearning {
  capture(incoming:IncomingMessage):void;
  respond(incoming:IncomingMessage,conversation:Conversation):Promise<string>;
}

export function matchMessage(event: unknown, config: PhotonConfig, startedAt: number, now: number): IncomingMessage | undefined {
  if (!object(event) || event.type !== 'message.received' || event.source !== 'imessage.photon' || event.apiVersion !== API_VERSION) return;
  const data = event.data;
  if (!object(data) || data.projectId !== config.projectId || !object(data.object)) return;
  const m = data.object;
  if (m.projectId !== config.projectId || m.platform !== 'imessage' || m.status !== 'received' || !id(m.id)) return;
  const at = typeof m.createdAt === 'string' ? Date.parse(m.createdAt) : NaN;
  if (!Number.isFinite(at) || at < startedAt || at > now + 5000) return;
  const sender = m.sentBy, recipient = m.receivedBy, space = m.space, content = m.content;
  if (![sender,recipient,space,content].every(object)) return;
  if (!object(sender) || !object(recipient) || !object(space) || !object(content)) return;
  if ([sender,recipient,space].some(v => v.platform !== 'imessage')) return;
  if (sender.kind !== 'human' || sender.handle !== config.testSender || !id(sender.id)) return;
  if (recipient.kind !== 'agent' || recipient.handle !== config.agentHandle || !id(recipient.id) || recipient.id === sender.id) return;
  if (space.kind !== 'direct' || !id(space.id) || content.type !== 'text' || content.format !== 'plain'
    || typeof content.text !== 'string' || !content.text.trim() || content.text.length > 1000) return;
  return {messageId:m.id,spaceId:space.id,agentId:recipient.id,text:content.text,occurredAt:new Date(at).toISOString()};
}

export async function handleDelivery(event: unknown, state: ChannelState, config: PhotonConfig, workspace: AgentWorkspace,
  save: () => Promise<void>, send: (route: ReplyRoute, text: string, key: string) => Promise<string>,learning?:DeliveryLearning,mode:'personal'|'listen-only'='personal') {
  const incoming = matchMessage(event,config,state.startedAt,Date.now()); if (!incoming) return;
  const key = incoming.messageId;
  let pending = state.messages[key];
  if (pending?.phase === 'sent'||pending?.phase==='observed') return;
  if (pending?.phase === 'sending') throw new ChannelFailure('SEND_OUTCOME_UNKNOWN');
  if (!pending) {
    // Bound on-disk data. Fail closed; never discard deduplication records silently.
    if (Object.keys(state.messages).length >= 2000) throw new ChannelFailure('STATE_CAPACITY');
    const {text:_,occurredAt:__, ...route} = incoming;
    pending = state.messages[key] = {phase:'processing',route}; await save();
  }
  if(mode==='listen-only'){
    if(!learning)throw new ChannelFailure('LEARNING_REQUIRED');
    try{learning.capture(incoming);}catch{/* best effort; never reply */}
    pending.phase='observed';await save();return;
  }
  if (pending.phase === 'processing') {
    try{learning?.capture(incoming);}catch{/* Learning failure must never break the reply path. */}
    const conversation = state.conversations[incoming.spaceId] ??= {};
    try { pending.text = learning?await learning.respond(incoming,conversation):await respond(incoming.text,key,conversation,workspace); }
    catch(error) { pending.text = publicFailure(error); }
    pending.phase = 'ready'; await save();
  }
  if (pending.phase !== 'ready' || !pending.text) throw new ChannelFailure('INVALID_OUTBOX');
  pending.phase = 'sending'; await save();
  try { pending.outgoingId = await send(pending.route,pending.text,operationKey('reply',key)); }
  catch { throw new ChannelFailure('SEND_OUTCOME_UNKNOWN'); }
  pending.phase = 'sent'; delete pending.text; await save();
}

export async function serve(env: NodeJS.ProcessEnv) {
  const mode=env.AGENT_COOKIE_CHANNEL_MODE??'personal';
  if(!['personal','listen-only'].includes(mode))throw new ChannelFailure('INVALID_CHANNEL_MODE');
  if(mode==='listen-only'&&!env.AGENT_COOKIE_CHANNEL_STATE)throw new ChannelFailure('SEPARATE_OBSERVER_STATE_REQUIRED');
  const config = readConfig(env), workspaceConfig = workspaceConfigFromEnv(env);
  const learningEnabled=env.AGENT_COOKIE_LEARNING_BINDING==='workspace-v1';
  if(env.AGENT_COOKIE_LEARNING_BINDING&&!learningEnabled)throw new ChannelFailure('INVALID_LEARNING_BINDING');
  if(mode==='listen-only'&&!learningEnabled)throw new ChannelFailure('LEARNING_REQUIRED');
  const workspace = new WorkspaceClient({...workspaceConfig,...(learningEnabled?{learning:true}:{})});
  if ((await workspace.getMe()).role !== 'personal') throw new ChannelFailure('PERSONAL_KEY_REQUIRED');
  const binding = createHash('sha256').update(JSON.stringify([config.projectId,config.testSender,config.agentHandle,workspaceConfig,...(mode==='listen-only'?[mode]:[])])).digest('hex');
  const store = await openState(resolve(env.AGENT_COOKIE_CHANNEL_STATE ?? '.runtime/channel-state.json'),binding,
    Number(env.AGENT_COOKIE_CHANNEL_START_SEQ??'0'));
  let learning:(DeliveryLearning&{pause():void;close():Promise<void>})|undefined;
  try{
    if(learningEnabled){
      const {createBetaLearning}=await import('./beta-learning.js');
      learning=await createBetaLearning({workspace,state:store.state,save:store.save,ownerHandle:config.testSender,
        listenOnly:mode==='listen-only',identifierSalt:createHash('sha256').update(workspaceConfig.key).digest('hex'),
        endpoint:env.AGENT_COOKIE_LEARNING_OTLP_ENDPOINT,
        metric:(status,depth)=>console.log(JSON.stringify({event:'learning_capture',status,depth}))});
    }
  }catch(error){await store.close();throw error;}
  const photon = new Photon({baseUrl:'https://api.photon.codes',headers:{Authorization:`Bearer ${config.apiKey}`},timeoutMs:10000,retry:false});
  const socket = io('https://api.photon.codes',{path:`/v1/projects/${config.projectId}/events/ws`,addTrailingSlash:false,
    transports:['websocket'],extraHeaders:{Authorization:`Bearer ${config.apiKey}`},autoConnect:false,reconnectionAttempts:5});
  let queue = Promise.resolve(), pending = 0, epoch = 0, closed = false;
  const send = async (route: ReplyRoute, text: string, key: string) => {
    const result = await photon.projects.sendMessage({path:{id:config.projectId},headers:{'idempotency-key':key},
      body:{spaceId:route.spaceId,senderId:route.agentId,content:{type:'text',format:'plain',text}}});
    if (!id(result.id)) throw new ChannelFailure('SEND_OUTCOME_UNKNOWN');
    return result.id;
  };
  const stop = (code?: string) => {
    if (closed) return; closed=true; epoch++;socket.disconnect();learning?.pause();
    if (code) {console.error(JSON.stringify({code}));process.exitCode=1;}
    void queue.finally(async()=>{try{await learning?.close();}finally{await store.close();}}).catch(()=>{process.exitCode=1;});
  };
  process.once('SIGINT',()=>stop());process.once('SIGTERM',()=>stop());
  socket.on('connect',()=>{
    socket.timeout(10000).emit('subscribe',{startSeq:store.state.cursor,apiVersion:API_VERSION},(error: unknown,result: unknown)=>{
      if(error || !object(result) || result.ok !== true) return stop('SUBSCRIBE_FAILED');
      console.log(JSON.stringify({event:'channel_ready',version:'photon-beta',learning:learningEnabled,mode}));
    });
  });
  socket.on('disconnect',()=>{epoch++;});
  socket.on('delivery',(event: unknown,meta: unknown)=>{
    if (closed) return;
    if (!object(meta) || !Number.isSafeInteger(meta.seq) || Number(meta.seq) < 0) return stop('INVALID_CURSOR');
    const seq=Number(meta.seq), generation=epoch;
    if (++pending > 128) {pending--;stop('QUEUE_CAPACITY');return;}
    queue=queue.then(async()=>{
      if (closed || generation !== epoch || seq <= store.state.cursor) return;
      await handleDelivery(event,store.state,config,workspace,store.save,send,learning,mode as 'personal'|'listen-only');
      store.state.cursor=seq; await store.save();
      // Log metadata only. Never phone numbers, text, card values, keys or raw Photon errors.
      console.log(JSON.stringify({event:'checkpoint',seq}));
    }).catch(error=>{stop(error instanceof ChannelFailure ? error.code : 'EVENT_FAILED');}).finally(()=>{pending--;});
  });
  socket.on('delivery_error',()=>stop('STREAM_FAILED'));
  socket.on('connect_error',()=>console.error('Photon connection unavailable; bounded reconnect is active.'));
  socket.io.on('reconnect_failed',()=>stop('RECONNECT_FAILED'));
  socket.connect();
}
