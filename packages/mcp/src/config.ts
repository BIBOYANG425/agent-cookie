import {workspaceConfigFromEnv,type WorkspaceConfig as BaseConfig} from '@agent-cookie/sdk';
export type WorkspaceConfig=BaseConfig&{learningConversationId?:string};
/** Contract MCP_HTTP_PORT (packages/contract/src/endpoints.ts); test/http.test.ts asserts the two agree. */
export const MCP_HTTP_PORT=4311;
export type Transport='stdio'|'http';
/** The http door's settings: everything a WorkspaceConfig holds except the key, which each request's bearer supplies. */
export type HttpDoorConfig=Omit<WorkspaceConfig,'key'>&{port:number};

function learning(env:Record<string,string|undefined>):{learning?:true;learningConversationId?:string} {
  if(env.AGENT_COOKIE_LEARNING_BINDING===undefined)return {};
  if(env.AGENT_COOKIE_LEARNING_BINDING!=='workspace-v1'||!env.AGENT_COOKIE_LEARNING_CONVERSATION_ID
    ||!/^[-\w]{1,128}$/.test(env.AGENT_COOKIE_LEARNING_CONVERSATION_ID))throw Error('Learning requires a compatible backend and host-bound conversation id.');
  return {learning:true,learningConversationId:env.AGENT_COOKIE_LEARNING_CONVERSATION_ID};
}
export function readConfig(env:Record<string,string|undefined>):WorkspaceConfig {
  return {...workspaceConfigFromEnv(env),...learning(env)};
}
export function readTransport(env:Record<string,string|undefined>):Transport {
  const value=env.AGENT_COOKIE_MCP_TRANSPORT??'stdio';
  if(value!=='stdio'&&value!=='http')throw Error('AGENT_COOKIE_MCP_TRANSPORT must be stdio or http.');
  return value;
}
/** http mode: AGENT_COOKIE_URL and AGENT_COOKIE_SAMPLE by the SDK's rules; AGENT_COOKIE_KEY is not used. */
export function readHttpConfig(env:Record<string,string|undefined>):HttpDoorConfig {
  // The SDK's rules require a key; a placeholder validates the rest and is dropped right away.
  const {key:_placeholder,...base}=workspaceConfigFromEnv({...env,AGENT_COOKIE_KEY:'unused'});
  const raw=env.MCP_HTTP_PORT;
  const port=raw===undefined?MCP_HTTP_PORT:/^\d{1,5}$/.test(raw)?Number(raw):NaN;
  if(!Number.isSafeInteger(port)||port<0||port>65535)throw Error('MCP_HTTP_PORT must be a port number (0-65535).');
  return {...base,...learning(env),port};
}
