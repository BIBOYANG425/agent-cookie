import {workspaceConfigFromEnv,PROPOSED_LEARNING_BINDING,type WorkspaceConfig as BaseConfig} from '@agent-cookie/sdk';
export type WorkspaceConfig=BaseConfig&{learningConversationId?:string};
export function readConfig(env:Record<string,string|undefined>):WorkspaceConfig {
  const base=workspaceConfigFromEnv(env);
  if(env.AGENT_COOKIE_LEARNING_BINDING===undefined)return base;
  if(env.AGENT_COOKIE_LEARNING_BINDING!=='proposal-v1'||!env.AGENT_COOKIE_LEARNING_CONVERSATION_ID
    ||!/^[-\w]{1,128}$/.test(env.AGENT_COOKIE_LEARNING_CONVERSATION_ID))throw Error('Learning requires a compatible backend and host-bound conversation id.');
  return {...base,learning:PROPOSED_LEARNING_BINDING,learningConversationId:env.AGENT_COOKIE_LEARNING_CONVERSATION_ID};
}
