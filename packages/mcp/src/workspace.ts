import type { WorkspaceConfig } from './config.js';
import type { PersonalWorkspaceBinding } from './server.js';

export function bindWorkspace(config: WorkspaceConfig): PersonalWorkspaceBinding {
  const client = new WorkspaceClient(config);
  return {
    getAuthenticatedRole: async () => (await client.getMe()).role,
    getMyCard: () => client.getMyCard(),
  };
}
import { WorkspaceClient } from '@agent-cookie/sdk';
