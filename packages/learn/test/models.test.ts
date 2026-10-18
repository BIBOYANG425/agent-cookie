import {it,expect,vi,afterEach} from 'vitest';
import {createLearner,createWorkspaceLearner,type LearningTurn} from '../src/index.js';
import {createExtractor,createHaikuExtractor,createJevClassifier,DEFAULT_EXTRACTION_MODEL,JEV_MODEL,getExtractorDefaults} from '../src/models.js';
const policy={'pref.color':{description:'Clothing color preference'}};
const turn:LearningTurn={text:'我一直更喜欢黑色衣服。',messageId:'msg1',conversationId:'conv1',occurredAt:'2026-10-17T22:00:00Z',source:'photon',speaker:'owner',isGroup:false};
const preference={key:'pref.color',value:'黑色',evidence:turn.text,basis:'stated'};
const extracted={sensitive:false,stable:true,preferences:[preference]};
const jev={model:'typesafe/jev-1.14-20261014',answers:{stable:{type:'noul',noul:0.98},sensitive:{type:'noul',noul:0.07},key:{type:'choice',choice:'pref.color',confidence:1,probabilities:{'pref.color':1,none:0}}}};
const completion=(value:unknown=extracted)=>({choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(value)}}]});
const mockFetch=()=>vi.fn(async(url:unknown)=>Response.json(String(url).includes('/decisions')?jev:completion()));
afterEach(()=>vi.unstubAllEnvs());
it('automatically gates OpenRouter extraction with one three-question Decisions request',async()=>{
 const mock=mockFetch();const extract=createExtractor({apiKey:'test',fetch:mock});
 const result=await createLearner({policy,extract}).learn(turn);
 expect(result.preferences).toEqual([preference]);expect(mock).toHaveBeenCalledTimes(2);
 const calls=mock.mock.calls as unknown as [string,RequestInit][];
 const decision=JSON.parse(String(calls[0][1].body));const extraction=JSON.parse(String(calls[1][1].body));
 expect(calls[0][0]).toBe('https://openrouter.ai/api/alpha/decisions');expect(decision.model).toBe(JEV_MODEL);
 expect(Object.keys(decision.questions)).toEqual(['stable','sensitive','key']);
 expect(decision.questions.stable.type).toBe('noul');expect(decision.questions.sensitive.type).toBe('noul');
 expect(decision.questions.key).toMatchObject({type:'choice',criteria:{'pref.color':policy['pref.color'].description,none:expect.any(String)}});
 expect(decision.state).toEqual({utterance:turn.text});expect(extraction.model).toBe(DEFAULT_EXTRACTION_MODEL);
 for(const body of [decision,extraction]){expect(body.provider).toMatchObject({allow_fallbacks:true,require_parameters:true,data_collection:'deny',zdr:true});expect(body.provider).not.toHaveProperty('only');expect(body).not.toHaveProperty('user');}
 expect(extraction.response_format.json_schema.strict).toBe(true);
 expect(extraction.response_format.json_schema.schema.properties.preferences.items.properties.key.enum).toEqual(['pref.color']);
 expect(extraction.messages[1].content).toBe(turn.text);expect(getExtractorDefaults(extract)?.model).toBe(DEFAULT_EXTRACTION_MODEL);
});
it('uses configured alternatives and keeps the old A factory name compatible without a direct provider',()=>{
 vi.stubEnv('AGENT_COOKIE_LEARN_MODEL','qwen/qwen3-235b-a22b-2507');
 expect(getExtractorDefaults(createHaikuExtractor({apiKey:'test',provider:'openrouter'}))?.model).toBe('qwen/qwen3-235b-a22b-2507');
 expect(()=>createHaikuExtractor({apiKey:'test',provider:'anthropic'})).toThrow('Only OpenRouter');
 expect(()=>createExtractor({apiKey:'test',model:'unknown'})).toThrow('Unsupported');
});
it('falls back on service unavailability only after local filters',async()=>{
 const extract=vi.fn().mockResolvedValue(extracted);
 const classify=createJevClassifier({apiKey:'test',fetch:async()=>Response.json({error:'PRIVATE'},{status:503})});
 expect((await createLearner({policy,classify,extract}).learn(turn)).reason).toBe('learned');expect(extract).toHaveBeenCalledTimes(1);
 extract.mockClear();await createLearner({policy,classify,extract}).learn({...turn,text:'I have asthma and prefer black.'});expect(extract).not.toHaveBeenCalled();
});
it.each([0.11,0.5,0.98])('sensitive or uncertain Jev probability %s cannot fall back even with malformed other answers',async probability=>{
 const classify=createJevClassifier({apiKey:'test',fetch:async()=>Response.json({answers:{sensitive:{type:'noul',noul:probability},key:'bad'}})});
 const extract=vi.fn();expect((await createLearner({policy,classify,extract}).learn(turn)).reason).toBe('sensitive');expect(extract).not.toHaveBeenCalled();
});
it('missing safety decision fails closed, not service fallback',async()=>{
 const classify=createJevClassifier({apiKey:'test',fetch:async()=>Response.json({answers:{stable:{type:'noul',noul:1}}})});
 const extract=vi.fn();await createLearner({policy,classify,extract}).learn(turn);expect(extract).not.toHaveBeenCalled();
});
it.each(['none','pref.unknown'])('does not extract for an unselected/unknown key %s',async choice=>{
 const raw=structuredClone(jev);raw.answers.key.choice=choice;
 const classify=createJevClassifier({apiKey:'test',fetch:async()=>Response.json(raw)});const extract=vi.fn();
 expect((await createLearner({policy,classify,extract}).learn(turn)).reason).toBe('not_stable');expect(extract).not.toHaveBeenCalled();
});
it('explicit-only still honors the Jev safety gate',async()=>{
 const classify=vi.fn(async()=>({sensitive:true,stable:true,keys:['pref.color']}));const extract=vi.fn();
 await createLearner({policy,mode:'explicit-only',classify,extract}).learn(turn);expect(classify).toHaveBeenCalledTimes(1);expect(extract).not.toHaveBeenCalled();
});
it('one request per eligible user turn, not per batch or question; other speakers are excluded',async()=>{
 const mock=mockFetch();const api=createWorkspaceLearner({extract:createExtractor({apiKey:'test',fetch:mock})});const at=turn.occurredAt;
 const rows=await api.extractFromConversation([{role:'user',text:turn.text,at},{role:'other',text:'I like red.',at},{role:'user',text:turn.text,at}],{conversationId:'conv',channel:'imessage'});
 expect(rows).toHaveLength(2);expect(mock.mock.calls.filter(([url])=>String(url).includes('/decisions'))).toHaveLength(2);
});
it('sensitive and group recordings produce no provider requests',async()=>{
 const mock=mockFetch();const learner=createLearner({policy,extract:createExtractor({apiKey:'test',fetch:mock})});
 await learner.learn({...turn,text:'我有哮喘，最近药费很贵；我喜欢蓝色。'});await learner.learn({...turn,isGroup:true,speaker:'other'});expect(mock).not.toHaveBeenCalled();
});
it.each([
 {choices:[{finish_reason:'length',message:{role:'assistant',content:JSON.stringify(extracted)}}]},
 {choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(extracted),refusal:'PRIVATE'}}]},
 completion({...extracted,authorize:true}),completion({...extracted,preferences:[{...preference,evidence:'x'.repeat(201)}]}),
 {error:{message:'PRIVATE'}},
])('rejects incomplete, refused and invalid JSON-schema responses',async raw=>{
 const extract=createExtractor({apiKey:'test',fetch:async()=>Response.json(raw)});
 await expect(extract({text:turn.text,policy,signal:new AbortController().signal})).rejects.toThrow('LEARNING_MODEL_UNAVAILABLE');
});

it('forbids stated in the wire schema when the local explicit-statement check fails',async()=>{
 const mock=mockFetch();const extract=createExtractor({apiKey:'test',fetch:mock});
 await extract({text:'Black is the color I choose for my clothes.',policy,signal:new AbortController().signal});
 const body=JSON.parse(String((mock.mock.calls as unknown as [string,RequestInit][])[0][1].body));
 expect(body.response_format.json_schema.schema.properties.preferences.items.properties.basis.enum).toEqual(['observed','inferred']);
});
