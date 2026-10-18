import {readFileSync} from 'node:fs';
import {it,expect,vi} from 'vitest';
import {createLearner,type LearningTurn} from '../src/index.js';
import {createHaikuExtractor,createJevClassifier,HAIKU_MODEL,OPENROUTER_HAIKU_MODEL} from '../src/models.js';
const fixtures=JSON.parse(readFileSync(new URL('./fixtures/model-responses.json',import.meta.url),'utf8'));
const policy={'pref.color':{description:'Clothing color preference'}};
const turn:LearningTurn={text:'我一直更喜欢黑色衣服。',messageId:'msg1',conversationId:'conv1',occurredAt:'2026-10-17T22:00:00Z',source:'photon',speaker:'owner',isGroup:false};
it('replays actual Jev/Haiku wire envelopes and pins the extraction model',async()=>{
  const calls:Array<{url:string;body:any}>=[];
  const mock=vi.fn(async(url:any,init:any)=>{calls.push({url:String(url),body:JSON.parse(init.body)});return Response.json(String(url).includes('typesafe')?fixtures.jev:fixtures.haiku)}) as unknown as typeof fetch;
  const result=await createLearner({policy,classify:createJevClassifier({apiKey:'test',fetch:mock}),extract:createHaikuExtractor({apiKey:'test',fetch:mock})}).learn(turn);
  expect(result.reason).toBe('learned');expect(calls).toHaveLength(2);expect(calls[1].body.model).toBe(HAIKU_MODEL);
  expect(calls[0].body.state).toBe(turn.text);expect(calls[1].body.messages[0].content).toBe(turn.text);
  expect(calls[1].body.output_config.format.schema.properties.preferences.items.properties.key.enum).toEqual(['pref.color']);
});
it('falls back when Jev unavailable, but not after a negative verdict',async()=>{
  const extract=vi.fn().mockResolvedValue(JSON.parse(fixtures.haiku.content[0].text));
  expect((await createLearner({policy,classify:async()=>{throw Error('secret')},extract}).learn(turn)).reason).toBe('learned');
  extract.mockClear();
  expect((await createLearner({policy,classify:async()=>({sensitive:true,stable:true,keys:['pref.color']}),extract}).learn(turn)).reason).toBe('sensitive');
  expect(extract).not.toHaveBeenCalled();
});
it('Jev uncertainty fails closed',async()=>{
  const raw=structuredClone(fixtures.jev);raw.answers.sensitive.noul=0.2;
  const classify=createJevClassifier({apiKey:'test',fetch:async()=>Response.json(raw)});
  const extract=vi.fn();await createLearner({policy,classify,extract}).learn(turn);expect(extract).not.toHaveBeenCalled();
});
it.each([Response.json({error:'SECRET'},{status:429}),Response.json({...fixtures.haiku,stop_reason:'max_tokens'}),Response.json({...fixtures.haiku,content:[{type:'text',text:'bad JSON SECRET'}]})])('does not leak provider failures',async r=>{
  const extract=createHaikuExtractor({apiKey:'test',fetch:async()=>r});
  expect(await createLearner({policy,extract}).learn(turn)).toEqual({preferences:[],reason:'unavailable'});
});
it('sensitive and group recordings produce no provider requests',async()=>{
  const mock=vi.fn() as unknown as typeof fetch;
  const learner=createLearner({policy,extract:createHaikuExtractor({apiKey:'test',fetch:mock}),classify:createJevClassifier({apiKey:'test',fetch:mock})});
  await learner.learn({...turn,text:'我有哮喘，最近药费很贵；我喜欢蓝色。'});
  await learner.learn({...turn,isGroup:true,speaker:'other',text:'我喜欢红色'});
  expect(mock).not.toHaveBeenCalled();
});
it('uses OpenRouter structured Haiku with restricted routing and identical local validation',async()=>{
  const mock=vi.fn(async()=>Response.json({choices:[{finish_reason:'stop',message:{role:'assistant',content:fixtures.haiku.content[0].text}}]}));
  const result=await createLearner({policy,extract:createHaikuExtractor({apiKey:'synthetic-key',provider:'openrouter',fetch:mock})}).learn(turn);
  expect(result.preferences[0]).toMatchObject({key:'pref.color',value:'黑色',basis:'stated'});
  const [url,init]=(mock.mock.calls as any)[0];const body=JSON.parse(init.body);
  expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
  expect(body.model).toBe(OPENROUTER_HAIKU_MODEL);
  expect(body.provider).toEqual({only:['amazon-bedrock/us'],allow_fallbacks:false,require_parameters:true,data_collection:'deny',zdr:true});
  expect(body.response_format.json_schema.strict).toBe(true);
  expect(body.messages[1].content).toBe(turn.text);expect(body).not.toHaveProperty('user');
});
it.each([
  {choices:[{finish_reason:'length',message:{role:'assistant',content:fixtures.haiku.content[0].text}}]},
  {choices:[{finish_reason:'stop',message:{role:'assistant',content:fixtures.haiku.content[0].text,refusal:'private refusal'}}]},
  {error:{message:'private provider failure'}},
])('fails closed on incomplete, refused or unavailable OpenRouter responses',async raw=>{
  const extract=createHaikuExtractor({apiKey:'synthetic-key',provider:'openrouter',fetch:async()=>Response.json(raw)});
  expect(await createLearner({policy,extract}).learn(turn)).toEqual({preferences:[],reason:'unavailable'});
});
