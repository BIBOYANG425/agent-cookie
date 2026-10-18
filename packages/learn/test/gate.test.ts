import {it,expect,vi} from 'vitest';
import {evaluateGate} from '../src/gate.js';
import {createLearner,createJevClassifier,createExtractor,DEFAULT_LEARNING_POLICY,type LearningTurn} from '../src/index.js';
const text='我一直更喜欢穿短裤，不太喜欢长裤。';
const turn:LearningTurn={text,messageId:'gate-test',conversationId:'synthetic',occurredAt:'2026-10-17T22:00:00Z',source:'photon',speaker:'owner',isGroup:false};
const response=(stable=0.98,sensitive=0.01,choice='pref.style',confidence=0.99,keyProbability=0.99)=>({answers:{
  stable:{type:'noul',noul:stable},sensitive:{type:'noul',noul:sensitive},
  key:{type:'choice',choice,confidence,probabilities:{[choice]:keyProbability}},
}});
const keys=Object.keys(DEFAULT_LEARNING_POLICY);
it.each([
  [0.1,0.01,'pref.style',1,1,'not_stable'],
  [0.89,0.01,'pref.style',1,1,'uncertain_stability'],
  [0.98,0.11,'pref.style',1,1,'uncertain_safety'],
  [0.98,0.9,'pref.style',1,1,'sensitive'],
  [0.98,0.01,'none',1,1,'unsupported_preference'],
  [0.98,0.01,'none',0.6,0.6,'uncertain_key'],
  [0.98,0.01,'pref.unknown',1,1,'invalid_gate_response'],
  [0.98,0.01,'pref.style',0.89,1,'uncertain_key'],
  [0.98,0.01,'pref.style',1,0.89,'uncertain_key'],
  [0.9,0.1,'pref.style',0.9,0.9,'allow'],
 ] as const)('keeps independent rejection reasons and unchanged thresholds %#',async(stable,sensitive,key,confidence,prob,outcome)=>{
  const raw=response(stable,sensitive,key,confidence,prob);
  const result=evaluateGate(raw,keys);expect(result.gate?.outcome).toBe(outcome);
  const extract=vi.fn(async()=>({sensitive:false,stable:true,preferences:[]}));
  const learn=createLearner({policy:DEFAULT_LEARNING_POLICY,extract,classify:async()=>result});
  await learn.learn(turn);expect(extract).toHaveBeenCalledTimes(outcome==='allow'?1:0);
});
it('safety wins over a broken key response; missing safety never means unavailability',()=>{
  expect(evaluateGate({answers:{sensitive:{type:'noul',noul:0.4},key:'bad'}},keys).gate).toEqual({outcome:'uncertain_safety',sensitiveScore:0.4});
  expect(evaluateGate({answers:{stable:{type:'noul',noul:1}}},keys).gate?.outcome).toBe('invalid_safety');
});
it('keeps a mixed shopping/habit turn intact and refuses the recorded uncertain field decision',async()=>{
  const text='Find me trail running shoes. When I choose tops, I usually look at the loose-fit one first.';
  const fetcher=vi.fn(async()=>Response.json(response(0.98,0.04,'pref.fit',0.72,0.75)));
  const extract=vi.fn();
  const classify=createJevClassifier({apiKey:'test',fetch:fetcher});
  const result=await createLearner({policy:DEFAULT_LEARNING_POLICY,classify,extract}).learn({...turn,text});
  expect(result.reason).toBe('uncertain_gate');expect(result.preferences).toEqual([]);expect(extract).not.toHaveBeenCalled();
  const call=fetcher.mock.calls[0] as unknown as [string,RequestInit];
  const body=JSON.parse(String(call[1].body));
  expect(body.state.utterance).toBe(text); // No clause stripping before the safety decision.
  expect(body.questions.key.instructions).toContain('one-time request is not another preference dimension');
  expect(body.questions.key.instructions).toContain('sensitive question must still inspect the entire utterance');
  expect(body.questions.sensitive.instructions).toContain('even mixed with an ordinary preference');
});
it.each([
  ()=>new Response('invalid JSON',{status:200}),
  ()=>new Response('x'.repeat(65537),{status:200}),
  ()=>new Response(null,{status:200}),
  ()=>Response.json({answers:{sensitive:{type:'noul',noul:0.01},stable:'bad',key:'bad'}}),
])('malformed successful HTTP responses never trigger service fallback %#',async makeResponse=>{
  const extract=vi.fn();
  const classify=createJevClassifier({apiKey:'test',fetch:async()=>makeResponse()});
  const result=await createLearner({policy:DEFAULT_LEARNING_POLICY,extract,classify}).learn(turn);
  expect(result.preferences).toEqual([]);expect(extract).not.toHaveBeenCalled();
  expect(['invalid_safety','invalid_gate_response']).toContain(result.gate?.outcome);
});
it('malformed custom classification cannot turn into extraction fallback',async()=>{
  const extract=vi.fn();
  const classify=async()=>({stable:true,keys:['pref.style']} as any);
  const result=await createLearner({policy:DEFAULT_LEARNING_POLICY,extract,classify}).learn(turn);
  expect(result.reason).toBe('invalid_gate_response');expect(extract).not.toHaveBeenCalled();
});
it('uses the existing style field for garment design, never invents fit, occasion or a new field',async()=>{
  const fetcher=vi.fn(async(url:unknown)=>Response.json(String(url).includes('/decisions')?response():{
    choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify({sensitive:false,stable:true,
      preferences:[{key:'pref.style',value:'短裤优先于长裤',evidence:text,basis:'stated'}]})}}],
  }));
  const result=await createLearner({policy:DEFAULT_LEARNING_POLICY,extract:createExtractor({apiKey:'test',fetch:fetcher})}).learn(turn);
  expect(result.preferences).toEqual([{key:'pref.style',value:'短裤优先于长裤',evidence:text,basis:'stated'}]);
  expect(result.gate?.outcome).toBe('allow');expect(fetcher).toHaveBeenCalledTimes(2);
  const calls=fetcher.mock.calls as unknown as [string,RequestInit][];
  const gate=JSON.parse(String(calls[0][1].body));const extraction=JSON.parse(String(calls[1][1].body));
  expect(gate.questions.key.criteria['pref.style']).toContain('garment length');
  expect(gate.questions.key.criteria['pref.fit']).toContain('looseness or tightness');
  expect(extraction.response_format.json_schema.schema.properties.preferences.items.properties.key.enum).toEqual(['pref.style']);
  expect(JSON.stringify(result.gate)).not.toContain(text);
});
it.each([
  '我有哮喘，所以更喜欢短裤。','我因为宗教信仰选择长裤。','我工资不够，但更喜欢短裤。',
  '我妻子喜欢短裤。','我住在洛杉矶，更喜欢短裤。','商家说我喜欢短裤。',
])('style clarification never bypasses mixed sensitive or quoted input %#',async text=>{
  const fetcher=vi.fn();const learner=createLearner({policy:DEFAULT_LEARNING_POLICY,extract:createExtractor({apiKey:'test',fetch:fetcher})});
  expect((await learner.learn({...turn,text})).preferences).toEqual([]);expect(fetcher).not.toHaveBeenCalled();
});
