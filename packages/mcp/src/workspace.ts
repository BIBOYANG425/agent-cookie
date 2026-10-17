import type { WorkspaceConfig } from './config.js';
import type { PersonalWorkspaceBinding } from './server.js';

export function bindWorkspace(config: WorkspaceConfig): PersonalWorkspaceBinding {
  const client = new WorkspaceClient(config);
  return {
    getAuthenticatedRole: async () => (await client.getMe()).role,
    getMyCard: () => client.getMyCard(),
    find: (input, key) => client.find(input, key),
    accept: (quoteId, key) => client.accept(quoteId, key),
    getReceipts: () => client.getReceipts(),
  };
}
import { WorkspaceClient } from '@agent-cookie/sdk';
