import {PREF_FIELDS,type LearnApi,type ContributionCandidate,type ObservationTurn} from '@agent-cookie/contract';
import {createLearner,filterTurn,characters,type PreferencePolicy} from './index.js';

const descriptions:Record<string,string>={
  'pref.brand':'Preferred product brand names', 'pref.color':'Preferred clothing colors, such as black or blue',
  'pref.material':'Preferred product fabrics or materials, such as cotton or wool',
  'pref.style':'Preferred clothing style, design or garment length: minimalist or casual styles, shorts rather than long trousers, sleeveless rather than long sleeves. Preserve that comparison; do not invent an occasion or a loose/tight fit.',
  'pref.fit':'Preferred looseness or tightness of clothing: loose, relaxed, slim or fitted. Garment length or design belongs to style.',
  'pref.avoid':'Explicit hard exclusions of product brands or materials. A comparative liking for one design over another is style, not a hard exclusion.',
  'pref.occasion':'General intended product use, such as sports or formal wear; only when stated, not guessed from a garment',
  'pref.size_system':'Preferred size notation such as EU or US',
};
// A's list is an upper bound. Financial price_band and recipient relationships
// are intentionally excluded under the human's stricter sensitive-topic rule.
export const DEFAULT_LEARNING_POLICY:PreferencePolicy=Object.freeze(Object.fromEntries(PREF_FIELDS
  .filter(key=>Object.hasOwn(descriptions,key)).map(key=>[key,{description:descriptions[key],maxLength:80}])));

/** The A workspace imports this adapter. It never opens a database or grants authority. */
export function createWorkspaceLearner(options:Omit<Parameters<typeof createLearner>[0],'policy'>&{policy?:PreferencePolicy}):LearnApi {
  const allowed=Object.fromEntries(Object.entries(options.policy??DEFAULT_LEARNING_POLICY)
    .filter(([key])=>(PREF_FIELDS as readonly string[]).includes(key)&&!['pref.price_band','pref.recipient'].includes(key)));
  const learner=createLearner({...options,policy:allowed});
  const extract=async(turns:ObservationTurn[],conversationId:string,channel:string,intentId?:string):Promise<ContributionCandidate[]>=>{
    const own=turns.filter(t=>t.role==='user');
    if(!own.length)return [];
    // Fail closed on a mixed sensitive conversation and overlarge batches; never truncate past sensitive content.
    const base={source:'mcp' as const,speaker:'owner' as const,isGroup:false,messageId:conversationId,conversationId};
    if(own.some(t=>filterTurn({...base,text:t.text,occurredAt:t.at})))return [];
    if(characters(own.map(t=>t.text).join('\n'))>4000)return [];
    const rows:ContributionCandidate[]=[];
    // One typed Jev request per eligible owner turn, never one per question or a
    // concatenated batch. Each evidence snippet remains bound to that turn.
    for(const turn of own){
      const result=await learner.learn({...base,text:turn.text,occurredAt:turn.at});
      if(result.reason==='sensitive'||result.reason==='invalid_gate_response')return []; // unknown safety cannot retain earlier results
      rows.push(...result.preferences.filter(p=>turn.text.includes(p.evidence)).map(p=>({field:p.key,value:p.value,basis:p.basis,
        evidence:{snippet:p.evidence,...(intentId?{intentId}:{conversationId}),...(result.models?{models:{...result.models}}:{})}})));
    }
    return rows;
  };
  return {
    extract:input=>input.text?extract([{role:'user',text:input.text,at:new Date().toISOString()}],input.intentId,'intent',input.intentId):Promise.resolve([]),
    extractFromConversation:(turns,context)=>context?.conversationId?extract(turns,context.conversationId,context.channel):Promise.resolve([]),
  };
}
