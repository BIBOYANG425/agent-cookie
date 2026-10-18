import {it,expect,vi} from 'vitest';
import {createWorkspaceLearner,DEFAULT_LEARNING_POLICY} from '../src/workspace.js';
const text='我一直喜欢黑色衣服。';
const output={sensitive:false,stable:true,preferences:[{key:'pref.color',value:'黑色',evidence:text,basis:'stated'}]};
it('implements A LearnApi while preserving stated evidence for A/C to apply human policy',async()=>{
 const learn=createWorkspaceLearner({extract:async()=>output});
 const rows=await learn.extractFromConversation([{role:'user',text,at:new Date().toISOString()}],{conversationId:'conv1',channel:'imessage'});
 expect(rows).toEqual([{field:'pref.color',value:'黑色',basis:'stated',evidence:{snippet:text,conversationId:'conv1'}}]);
});
it('drops other speakers, whole sensitive batches, and no-context calls',async()=>{
 const extract=vi.fn();const learn=createWorkspaceLearner({extract});const at=new Date().toISOString();
 expect(await learn.extractFromConversation([{role:'other',text,at}],{conversationId:'c',channel:'imessage'})).toEqual([]);
 expect(await learn.extractFromConversation([{role:'user',text,at},{role:'user',text:'我有哮喘',at}],{conversationId:'c',channel:'imessage'})).toEqual([]);
 expect(await learn.extractFromConversation([{role:'user',text,at}])).toEqual([]);expect(extract).not.toHaveBeenCalled();
});
it('does not learn merchant quote descriptions or financial fields',async()=>{
 const extract=vi.fn();const learn=createWorkspaceLearner({extract});
 expect(await learn.extract({intentId:'i',public:{},query:'black',chosenQuote:{text} as any})).toEqual([]);
 expect(extract).not.toHaveBeenCalled();expect(DEFAULT_LEARNING_POLICY).not.toHaveProperty('pref.price_band');expect(DEFAULT_LEARNING_POLICY).not.toHaveProperty('pref.recipient');
});
it('discards earlier batch results if a later classifier answer lacks a valid safety decision',async()=>{
 const classify=vi.fn().mockResolvedValueOnce({stable:true,sensitive:false,keys:['pref.color']}).mockResolvedValueOnce({stable:true,keys:['pref.color']});
 const learn=createWorkspaceLearner({extract:async()=>output,classify});const at=new Date().toISOString();
 expect(await learn.extractFromConversation([{role:'user',text,at},{role:'user',text,at}],{conversationId:'c',channel:'imessage'})).toEqual([]);
});
