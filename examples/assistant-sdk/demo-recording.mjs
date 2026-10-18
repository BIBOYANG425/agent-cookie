// English-only recording helper for a separate, local Sample workspace. No external model calls or real payments.
import { readFile, writeFile } from 'node:fs/promises';
import { AssistantClient, WorkspaceClient, registerAgent, isWorkspaceError } from '../../packages/sdk/dist/index.js';
const baseUrl = 'http://127.0.0.1:4315';
const statePath = process.env.AGENT_COOKIE_RECORDING_STATE ?? '/private/tmp/agent-cookie-recording-state.json';
const keys = JSON.parse(await readFile(new URL('../../fixtures/dev-keys.json', import.meta.url), 'utf8'));
const keyFor = role => Object.entries(keys).find(([,v]) => v.role === role)?.[0];
const owner = new WorkspaceClient({baseUrl, key:keyFor('owner'), sample:true});
const log = value => console.log(JSON.stringify(value,null,2));
const step = process.argv[2];
if (step === 'prepare') {
  const personal = new WorkspaceClient({baseUrl,key:keyFor('personal'),sample:true});
  await personal.remember({field:'lang',value:'en',basis:'stated'});
  await personal.remember({field:'tone',value:'concise',basis:'stated'});
  const dotsRegistration = await registerAgent(baseUrl,{name:'Sample · Dots',category:'assistant'});
  const dots = new AssistantClient({baseUrl,key:dotsRegistration.key,sample:true});
  const dotsLink = await dots.requestLink(); await owner.approveLink(dotsLink.id);
  await dots.remember({field:'pref.brand',value:'Brooks',basis:'stated',evidence:{conversationId:'sample-dots-previous-chat',snippet:'Sample: I only run in Brooks.'}});
  const earlier = await dots.find({text:'Sample trail running shoes under $120',public:{budget:'120'}},`dots-recording-${Date.now()}`);
  const museRegistration = await registerAgent(baseUrl,{name:'Sample · Muse',category:'assistant'});
  const muse = new AssistantClient({baseUrl,key:museRegistration.key,sample:true});
  const link = await muse.requestLink();
  await writeFile(statePath,JSON.stringify({museRegistration,link,earlierIntent:earlier.intentId}),{mode:0o600,flag:'wx'});
  log({label:'Sample · Fixture replay',step:'Ready for owner consent',assistant:'Muse',linkId:link.id,earlierAssistant:'Dots',earlierIntent:earlier.intentId,action:'Open the English console on port 5174. Approve Sample · Muse under Connections.'});
} else {
  const state=JSON.parse(await readFile(statePath,'utf8'));
  const muse=new AssistantClient({baseUrl,key:state.museRegistration.key,sample:true});
  if(step==='request-link') {
    const link=await muse.requestLink();
    await writeFile(statePath,JSON.stringify({...state,link}),{mode:0o600});
    log({label:'Sample',assistant:'Muse',linkId:link.id,status:link.status,action:'Approve in Connections, then run context.'});
  } else if(step==='context') {
    const context=await muse.context();
    log({label:'Sample · actual SDK context',assistant:'Muse',fields:context.fields,unknown:context.unknown,shippingAddressIncluded:'shipping_address' in context.fields,paymentMethodIncluded:'payment_method' in context.fields});
    const found=await muse.find({text:'Sample trail running shoes under $120',public:{budget:'120'}},`muse-recording-${Date.now()}`);
    log({label:'Sample · Fixture replay',intentId:found.intentId,offers:found.quotes.map(q=>({quoteId:q.id,merchant:q.agentId,sessionId:q.sessionId,title:q.title,price:q.price}))});
    if(found.quotes[0]) {
      const accepted=await muse.accept(found.quotes[0].id,`sample-accept-${found.quotes[0].id}`);
      log({label:'Sample · Fixture checkout · no real payment',status:accepted.status});
    }
    const receipts=await owner.getReceipts();
    log({label:'Actual workspace receipts · field names only',receipts:receipts.receipts.map(({agentId,sessionId,purpose,fields,intentId})=>({agentId,sessionId,purpose,fields,intentId}))});
  } else if(step==='revoke'||step==='verify-revoked') {
    const grants=await owner.getGrants();
    const grant=grants.grants.find(g=>g.agentId===state.museRegistration.agentId&&g.status==='live');
    if(step==='revoke'){
      if(!grant)throw new Error('No active Muse grant to revoke.');
      await owner.revokeGrant(grant.id);
    }
    try {await muse.context();throw new Error('Unexpected access after revocation.');}
    catch(error){if(!isWorkspaceError(error)||error.code!=='GRANT_REVOKED')throw error;log({label:'Sample · verified revocation',assistant:'Muse',nextRead:error.code,status:error.status});}
  } else throw new Error('Use prepare, request-link, context, revoke, or verify-revoked.');
}
