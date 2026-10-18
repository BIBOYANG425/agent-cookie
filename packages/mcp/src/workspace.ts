import type { WorkspaceConfig } from './config.js';
import type { AssistantWorkspaceBinding, PersonalWorkspaceBinding } from './server.js';
import {createHmac} from 'node:crypto';
import {bounded} from '@agent-cookie/learn';

export function bindWorkspace(config: WorkspaceConfig): PersonalWorkspaceBinding {
  const client = new WorkspaceClient(config);
  const observed=new Set<string>();
  return {
    getAuthenticatedRole: async () => (await client.getMe()).role,
    getMyCard: () => client.getMyCard(),
    find: (input, key) => client.find(input, key),
    accept: (quoteId, key) => client.accept(quoteId, key),
    getReceipts: () => client.getReceipts(),
    ...(client.learningAvailable&&config.learningConversationId?{observe:async(text:string)=>{
      const hash=(value:string)=>createHmac('sha256',config.key).update(value).digest('hex');
      const conversationId=hash('mcp:'+config.learningConversationId);
      const fingerprint=hash(conversationId+'\0'+text);
      if(observed.has(fingerprint))return {queued:false};
      observed.add(fingerprint);if(observed.size>2048)observed.delete(observed.values().next().value!);
      // No server idempotency contract yet; local best-effort dedup only.

      return bounded(signal=>client.observe({channel:'desktop',conversationId,turns:[{role:'user',text,at:new Date().toISOString()}]},{signal}),1500);
    }}:{}),
  };
}
import { AssistantClient, WorkspaceClient } from '@agent-cookie/sdk';

/** One wrapper per AssistantClient method; the client is bound to (url, key) and holds no data between calls. */
export function bindAssistant(config: WorkspaceConfig): AssistantWorkspaceBinding {
  const client = new AssistantClient({ baseUrl: config.baseUrl, key: config.key, ...(config.sample ? { sample: true } : {}) });
  return {
    getAuthenticatedRole: async () => (await client.getMe()).role,
    requestLink: () => client.requestLink(),
    link: id => client.link(id),
    context: () => client.context(),
    remember: input => client.remember(input),
    find: (input, key) => client.find(input, key),
    accept: (quoteId, key) => client.accept(quoteId, key),
    stats: () => client.stats(),
  };
}
