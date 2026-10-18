import { mkdir, open, readFile, rename, unlink, writeFile, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Conversation } from './agent.js';
import type { ReplyRoute } from './probe.js';

export interface Outbox { phase: 'processing'|'ready'|'sending'|'sent'|'observed'; route: ReplyRoute; text?: string; outgoingId?: string }
export interface ChannelState {
  version: 1; binding: string; cursor: number; startedAt: number;
  conversations: Record<string, Conversation>; messages: Record<string, Outbox>;
  learning?: {paused:boolean;lastSummaryDay?:string};
}
export class ChannelFailure extends Error { constructor(readonly code: string) { super(code); } }

export async function openState(path: string, binding: string, initialCursor=0) {
  if(!Number.isSafeInteger(initialCursor)||initialCursor<0)throw new ChannelFailure('INVALID_INITIAL_CURSOR');
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const lockPath = `${path}.lock`;
  let lock;
  try { lock = await open(lockPath,'wx',0o600); } catch { throw new ChannelFailure('CHANNEL_ALREADY_LOCKED'); }
  await lock.writeFile(String(process.pid));
  const close = async () => { await lock.close(); await unlink(lockPath); };
  try {
    let state: ChannelState;
    try { state = JSON.parse(await readFile(path,'utf8')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new ChannelFailure('INVALID_CHANNEL_STATE');
      state = {version:1,binding,cursor:initialCursor,startedAt:Date.now(),conversations:{},messages:{}};
    }
    if (state.version !== 1 || state.binding !== binding || !Number.isSafeInteger(state.cursor) || state.cursor < 0
      || !Number.isFinite(state.startedAt) || !state.conversations || !state.messages) throw new ChannelFailure('STATE_BINDING_MISMATCH');
    if (Object.values(state.messages).some(m => m.phase === 'sending')) throw new ChannelFailure('SEND_OUTCOME_UNKNOWN');
    if(state.learning&&(typeof state.learning.paused!=='boolean'||(state.learning.lastSummaryDay!==undefined&&typeof state.learning.lastSummaryDay!=='string')))throw new ChannelFailure('INVALID_CHANNEL_STATE');
    const save = async () => {
      await writeFile(`${path}.tmp`,JSON.stringify(state)+'\n',{mode:0o600});
      await chmod(`${path}.tmp`,0o600); await rename(`${path}.tmp`,path);
    };
    await save(); return {state,save,close};
  } catch(error) { await close(); throw error; }
}
