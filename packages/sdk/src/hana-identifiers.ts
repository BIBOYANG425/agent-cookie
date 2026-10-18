import { createHash } from 'node:crypto';

/** Transport identity only. Never derive either identifier from model arguments. */
export function conversationIdForChat(chatId:string):string {
  if(!chatId)throw new Error('A trusted chat ID is required.');
  return createHash('sha256').update(chatId).digest('hex').slice(0,16);
}
export function operationIdForMessage(guid:string,operation:'find'|'accept'):string {
  if(!guid)throw new Error('A trusted inbound message GUID is required.');
  return createHash('sha256').update(guid+operation).digest('hex');
}
