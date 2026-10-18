import { expect, it, vi } from 'vitest';
import { shoppingInput } from '../src/intent.js';
import { respond, type AgentWorkspace, type Conversation } from '../src/agent.js';

it.each([
  ['想找一双日常通勤穿的鞋，42码，预算90美元。',{budget:'90',size:'42'}],
  ['帮我找件黑色外套，M码，150美元以内，周五前到。',{budget:'150',size:'M',color:'黑色',deadline:'周五前到'}],
  ['给朋友挑个生日礼物，60美元以内，下周三前送到。',{budget:'60',deadline:'下周三前送到'}],
  ['Find a blue coat size XL under $150 by next Friday',{budget:'150',size:'XL',color:'blue',deadline:'by next Friday'}],
  ['鞋码 US 9，预算100到160美元',{budget:'100到160',size:'US 9'}],
  ['找个礼物，预算1,200美元',{budget:'1200'}],
] as const)('extracts only stated conditions from %s', (text,conditions)=>{
  expect(shoppingInput(text)).toEqual({text,public:conditions});
});
it.each(['  给朋友挑个礼物\n','一件外套','shoe size unknown','找件外套，300人民币以内','budget 80 EUR gift'])('preserves the raw request without guessing missing values: %s',text=>{
  expect(shoppingInput(text)).toEqual({text});
});
const quotes=[{id:'q',intentId:'i',agentId:'retail',text:'Sample jacket',title:'Sample jacket',price:8900,currency:'USD' as const,etaDate:null,source:'fixture' as const}];
function workspace() {
  return {find:vi.fn<AgentWorkspace['find']>().mockResolvedValue({intentId:'i',sample:true,quotes}),
    accept:vi.fn<AgentWorkspace['accept']>(),getMyCard:vi.fn<AgentWorkspace['getMyCard']>(),getReceipts:vi.fn<AgentWorkspace['getReceipts']>()};
}
it.each(['一件外套','给朋友挑个礼物','walking shoes'])('routes any product request without a category keyword: %s',async text=>{
  const client=workspace();
  await respond(text,'message',{},client);
  expect(client.find).toHaveBeenCalledWith({text},expect.any(String));
  expect(client.accept).not.toHaveBeenCalled();
});
it('keeps sizeNote exactly as received and never adds a missing warning',async()=>{
  const client=workspace(); const note='没有 M，有 S、L\nFit is not guaranteed.';
  client.find.mockResolvedValueOnce({intentId:'i',sample:true,quotes:[{...quotes[0],sizeNote:note}]});
  const text=await respond('外套','one',{},client);
  expect(text).toContain(note);expect(text).toContain('Sample');expect(text).toContain('选1');expect(text).not.toContain('选2');
  expect(await respond('外套','two',{},client)).not.toContain(note);
});
it('clears prior offers on a failed new search, and never accepts an unshown index',async()=>{
  const client=workspace(), conversation:Conversation={offers:{intentId:'old',sample:true,quotes}};
  client.find.mockRejectedValueOnce(Error('offline'));
  await expect(respond('另找一件外套','new',conversation,client)).rejects.toThrow();
  expect(conversation.offers).toBeUndefined();
  expect(await respond('选1','choose',conversation,client)).toContain('请先搜索商品');
  conversation.offers={intentId:'i',sample:true,quotes};
  await respond('选3','unshown',conversation,client);
  expect(client.accept).not.toHaveBeenCalled();
});
