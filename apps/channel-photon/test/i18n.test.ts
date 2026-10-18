import { expect, it, vi } from 'vitest';
import { dictionaries, localeFromMessage } from '../src/i18n.js';
import { catalogQuery, isShoppingRequest } from '../src/keywords.js';
import { shoppingInput } from '../src/intent.js';
import { respond, publicFailure, type AgentWorkspace, type Conversation } from '../src/agent.js';

it('keeps both reply dictionaries complete and nonempty', () => {
  expect(Object.keys(dictionaries.zh).sort()).toEqual(Object.keys(dictionaries.en).sort());
  for (const key of Object.keys(dictionaries.zh) as Array<keyof typeof dictionaries.zh>) {
    expect(dictionaries.zh[key].trim()).not.toBe(''); expect(dictionaries.en[key].trim()).not.toBe('');
    expect(dictionaries.en[key].match(/\{\d+\}/g)??[]).toEqual(dictionaries.zh[key].match(/\{\d+\}/g)??[]);
  }
});
it.each([
  ['防水外套 150 以内','waterproof jacket',{budget:'150'}], ['送妈妈的围巾','scarf for mom',undefined],
  ['10 码篮球鞋','basketball shoes',{size:'10'}], ['送爸爸的雨衣，两家','rain jacket for dad',{count:'2'}],
  ['Find a hat size L under $30, 3 options by Friday','Find a hat size L under $30, 3 options by Friday',{size:'L',budget:'30',count:'3',deadline:'by Friday'}],
] as const)('keeps original text and builds catalog query for %s', (text,query,conditions) => {
  expect(shoppingInput(text)).toEqual({text,query,...(conditions?{public:conditions}:{})}); expect(isShoppingRequest(text)).toBe(true);
});
it.each(['外套','夹克','围巾','篮球鞋','越野跑鞋','跑鞋','帽子','手套','背包','T恤','袜子','卫衣'])('has a deterministic keyword for %s', text => expect(catalogQuery(text)).toMatch(/^[a-z -]+$/));
it('omits unknown Chinese keywords and out-of-range seller counts', () => {
  expect(shoppingInput('找个茶杯，13家')).toEqual({text:'找个茶杯，13家'});
  expect(shoppingInput('find a mug, 6 options')).toEqual({text:'find a mug, 6 options',query:'find a mug, 6 options'});
});
const quote = {id:'q',intentId:'i',agentId:'shop',text:'Sample scarf',price:2500,currency:'USD' as const,source:'fixture' as const,etaDate:null};
const workspace = () => ({find:vi.fn<AgentWorkspace['find']>().mockResolvedValue({sample:true,intentId:'i',quotes:[quote]}),
  accept:vi.fn<AgentWorkspace['accept']>().mockResolvedValue({sample:true,quoteId:'q',status:'handoff',continueUrl:'https://example.com/demo'}),
  getMyCard:vi.fn<AgentWorkspace['getMyCard']>().mockResolvedValue({card:[{field:'lang',value:'en'}]}), getReceipts:vi.fn<AgentWorkspace['getReceipts']>().mockResolvedValue({sample:true,receipts:[]})});
it('keeps sizeNote verbatim, unknown delivery, and honest English fixture and handoff labels', async () => {
  const client=workspace(); const conversation:Conversation={}; const note='没有 M，有 S、L';
  client.find.mockResolvedValueOnce({sample:true,intentId:'i',quotes:[{...quote,sizeNote:note}]});
  const reply=await respond('find a scarf by Friday','m',conversation,client);
  for (const text of ['Sample recorded quotes','Arrival date unknown',note,'cannot currently be guaranteed']) expect(reply).toContain(text);
  expect(await respond('2','missing',conversation,client)).toContain('Search for products first');
  const handoff=await respond('choose 1','select',conversation,client);
  for (const text of ['[Sample demo]','No payment or order has been confirmed','demo only']) expect(handoff).toContain(text);
  expect(client.accept).toHaveBeenCalledWith('q', expect.any(String));
});
it('reports unknown translation and supports generic Chinese selection, up to five displayed offers', async () => {
  const client=workspace(), conversation:Conversation={};
  expect(await respond('帮我找个茶杯','m',conversation,client)).toContain('未识别到可翻译的商品关键词');
  client.find.mockResolvedValueOnce({sample:true,intentId:'i',quotes:Array.from({length:5},(_,i)=>({...quote,id:`q${i}`}))});
  expect(await respond('帮我找围巾，五家','five',conversation,client)).toContain('选5');
  await respond('要第五个','choose',conversation,client); expect(client.accept).toHaveBeenLastCalledWith('q4',expect.any(String));
});
it('uses message script first, then card lang for neutral input, and localizes safe failures', () => {
  expect(localeFromMessage('find a scarf','zh')).toBe('en'); expect(localeFromMessage('围巾','en')).toBe('zh');
  expect(localeFromMessage('2','en')).toBe('en'); expect(localeFromMessage('2','zh-TW')).toBe('zh');
  expect(publicFailure({code:'GRANT_EXPIRED'},'en')).toContain('expired'); expect(publicFailure(Error('SECRET'),'en')).not.toContain('SECRET');
});
it('reads card language for a neutral selection without replacing original words', async () => {
  const client = workspace();
  expect(await respond('2', 'neutral', {}, client)).toContain('Search for products first');
  expect(client.getMyCard).toHaveBeenCalledOnce(); expect(client.find).not.toHaveBeenCalled();
});
