import { describe, expect, it, vi } from 'vitest';
import { AssistantClient, WorkspaceClient, type FindInput } from '../src/index.js';

const config = {baseUrl:'http://127.0.0.1:4310', key:'sample-test-key'};
describe('text intent wire contract', () => {
  it.each([
    {text:'  给朋友挑个生日礼物。\n'},
    {text:'帮我找黑色外套，M码，预算100到160美元。',query:'black jacket',public:{budget:'100-160',size:'M',color:'黑色'}},
    {text:'walking shoes',public:{deadline:'by Friday'}},
  ] as FindInput[])('sends the exact sentence and only supplied optional fields', async input => {
    const fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>Response.json({intentId:'i'}));
    const client=new WorkspaceClient({...config,fetch:fetcher});
    const untrusted = {...input,userId:'other',agentId:'someone',arm:'treatment'};
    await client.createIntent(untrusted,'stable');
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual(input);
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({'Idempotency-Key':'stable'});
  });
  it('sends the kind hint beside the sentence when given (A52), for find as well', async () => {
    const fetcher=vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({intentId:'i'}))
      .mockResolvedValueOnce(Response.json({intentId:'j'}))
      .mockResolvedValueOnce(new Response('event: complete\ndata: {"type":"complete","intentId":"j"}\n\n',{headers:{'content-type':'text/event-stream'}}));
    const client=new WorkspaceClient({...config,fetch:fetcher});
    await client.createIntent({text:'trail shoes, size 42',kind:'shoes'},'k1');
    expect(await client.find({text:'trail shoes, size 42',public:{size:'42'},kind:'trail_shoes'},'k2')).toEqual({intentId:'j',quotes:[],sample:false});
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({text:'trail shoes, size 42',kind:'shoes'});
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({text:'trail shoes, size 42',public:{size:'42'},kind:'trail_shoes'});
  });
  it.each([
    {kind:''}, {text:'gift',kind:'Shoes'}, {text:'gift',kind:'trail-shoes'}, {text:'gift',kind:'9lives'},
    {text:'gift',kind:''}, {text:'gift',kind:'k'.repeat(65)}, {text:'gift',kind:42}, {text:''}, {text:'  '}, {text:'鞋'.repeat(334)}, {text:'gift',query:'q'.repeat(201)},
    {text:'gift',public:{color:'色'.repeat(86)}}, {text:'gift',public:{size:42}},
    {text:'gift',public:{constructor:'unsafe'}}, {text:'gift',public:Object.fromEntries(Array.from({length:21},(_,i)=>['k'+i,'v']))},
  ])('rejects malformed input before transport', async input => {
    const fetcher=vi.fn<typeof fetch>();
    const client=new WorkspaceClient({...config,fetch:fetcher});
    await expect(client.createIntent(input as FindInput,'invalid')).rejects.toThrow('Invalid shopping intent');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([{role:'personal',Client:WorkspaceClient},{role:'assistant',Client:AssistantClient}])('normalizes legacy calls for $role clients without weakening HTTP text', async ({Client}) => {
    const fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>Response.json({intentId:'i'}));
    const client=new Client({...config,fetch:fetcher});
    const legacy:FindInput={kind:'trail_shoes',public:{budget:'120'}};
    await client.createIntent(legacy,'legacy');
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toEqual({...legacy,text:'trail_shoes'});
    const generic:FindInput={text:'送妈妈的围巾',query:'scarf for mom',kind:'gift',public:{count:'3'}};
    await client.createIntent(generic,'generic');
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual(generic);
  });
  it('preserves a size warning verbatim and rejects malformed warnings',async()=>{
    const note='没有 M，有 S、L\nPlease check the size chart.';
    const q={id:'q',intentId:'i',agentId:'retail',text:'Sample jacket',price:8900,currency:'USD',source:'fixture',sizeNote:note};
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({quotes:[q]}))
      .mockResolvedValueOnce(Response.json({quotes:[{...q,sizeNote:42}]}));
    const client=new WorkspaceClient({...config,fetch:fetcher});
    expect(await client.getQuotes('i')).toEqual({sample:true,quotes:[q]});
    await expect(client.getQuotes('i')).rejects.toThrow('Invalid quote response');
  });
});
