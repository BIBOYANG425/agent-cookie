import type { WorkspaceConfig } from './config.js';
import type { PersonalWorkspaceBinding } from './server.js';
import {createHmac} from 'node:crypto';
import {bounded} from '@agent-cookie/learn';

export function bindWorkspace(config: WorkspaceConfig): PersonalWorkspaceBinding {
  const client = new WorkspaceClient(config);
  return {
    getAuthenticatedRole: async () => (await client.getMe()).role,
    getMyCard: () => client.getMyCard(),
    find: (input, key) => client.find(input, key),
    accept: (quoteId, key) => client.accept(quoteId, key),
    getReceipts: () => client.getReceipts(),
    ...(client.learningAvailable&&config.learningConversationId?{observe:async(text:string)=>{
      const hash=(value:string)=>createHmac('sha256',config.key).update(value).digest('hex');
      const conversationId=hash('mcp:'+config.learningConversationId);
      // Stable per host-bound conversation+utterance: model retries cannot create extra sources.
      const messageId=hash(conversationId+'\0'+text);
      return bounded(signal=>client.observe({source:'mcp',messageId,conversationId,occurredAt:new Date().toISOString(),text},`observe:${messageId}`,{signal}),1500);
    }}:{}),
  };
}
import { WorkspaceClient } from '@agent-cookie/sdk';
