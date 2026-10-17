export const requiredVariables = ['PHOTON_API_KEY', 'PHOTON_PROJECT_ID', 'PHOTON_TEST_SENDER', 'PHOTON_AGENT_HANDLE'] as const;

export interface PhotonConfig {
  apiKey: string;
  projectId: string;
  testSender: string;
  agentHandle: string;
}

export function readConfig(env: NodeJS.ProcessEnv): PhotonConfig {
  for (const name of requiredVariables) {
    if (!env[name]?.trim()) throw new Error(`Missing ${name}.`);
  }
  if (env.PHOTON_PLATFORM && env.PHOTON_PLATFORM !== 'imessage') {
    throw new Error('This probe supports PHOTON_PLATFORM=imessage only.');
  }
  const apiKey = env.PHOTON_API_KEY!.trim();
  if (/\s/.test(apiKey)) throw new Error('PHOTON_API_KEY must not contain whitespace.');
  const testSender = env.PHOTON_TEST_SENDER!.trim();
  const agentHandle = env.PHOTON_AGENT_HANDLE!.trim();
  if (testSender === agentHandle) throw new Error('The test sender and agent handle must differ.');
  return { apiKey, projectId: env.PHOTON_PROJECT_ID!.trim(), testSender, agentHandle };
}

export function configurationReport(env: NodeJS.ProcessEnv) {
  const missing = requiredVariables.filter(name => !env[name]?.trim());
  let valid = false;
  try { readConfig(env); valid = true; } catch { /* Do not include values. */ }
  return { valid, missing, platform: 'imessage', networkCalled: false, sendsMessages: false };
}
