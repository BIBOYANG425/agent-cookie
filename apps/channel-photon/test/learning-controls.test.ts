import {it,expect,vi} from 'vitest';
import {createLearningControls,isShoppingRequest,respondWithLearning,type LearningLocalState} from '../src/learning-controls.js';
import {createObservationSink} from '../src/learning-capture.js';
const row={field:'pref.color',value:'黑色',evidence:[{contributionId:'p1',agentId:'personal',basis:'stated' as const,createdAt:'2026-10-17T22:00:00Z',snippet:'我喜欢黑色'}],sources:['p1'],status:'card' as const};
function setup(){
 const workspace={getLearning:vi.fn().mockResolvedValue({paused:false}),getLearned:vi.fn().mockResolvedValue({paused:false,learned:[row]}),setLearning:vi.fn().mockResolvedValue({paused:false}),forgetLearning:vi.fn().mockResolvedValue({field:'pref.color',paused:true,removed:1,projection:'complete',historyErased:false})};
 const sink=createObservationSink({observe:async()=>({queued:true})});const state:LearningLocalState={paused:false};const save=vi.fn(async()=>{});
 return {workspace,sink,state,save,controls:createLearningControls({workspace,sink,state,save,day:()=> '2026-10-17'})};
}
it('freezes immediately on pause even when server fails',async()=>{
 const s=setup();s.workspace.setLearning.mockRejectedValue(Error('secret'));
 const pending=s.controls.command('暂停学习');expect(s.sink.enabled).toBe(false);expect(await pending).toContain('后台尚未确认');expect(s.state.paused).toBe(true);
});
it('requires backend confirmation before resume',async()=>{
 const s=setup();s.sink.pause();expect(await s.controls.command('恢复学习')).toContain('后台已确认恢复');expect(s.sink.enabled).toBe(true);
});
it('uses the atomic forget endpoint and distinguishes current cleanup from retained Git history',async()=>{
 const s=setup();s.workspace.setLearning.mockResolvedValue({paused:true});
 s.workspace.getLearned.mockResolvedValueOnce({paused:true,learned:[row]}).mockResolvedValueOnce({paused:true,learned:[]});
 expect(await s.controls.command('忘掉 颜色')).toContain('旧 Git 历史仍保留');expect(s.workspace.forgetLearning).toHaveBeenCalledWith({field:'pref.color'},expect.anything());expect(s.sink.enabled).toBe(false);
});
it('does not guess ambiguous targets',async()=>{
 const s=setup();s.workspace.setLearning.mockResolvedValue({paused:true});expect(await s.controls.command('忘掉 那个')).toContain('没有找到');expect(s.workspace.forgetLearning).not.toHaveBeenCalled();
});
it('daily summary reads current active conclusions and occurs once',async()=>{
 const s=setup();expect(await s.controls.decorate('ok')).toContain('颜色：黑色');expect(await s.controls.decorate('again')).toBe('again');
 delete s.state.lastSummaryDay;s.workspace.getLearned.mockResolvedValue({paused:false,learned:[]});expect(await s.controls.decorate('later')).toBe('later');
});
it('ordinary preference speech is not a shopping intent',async()=>{
 const s=setup();const agent={find:vi.fn(),accept:vi.fn(),getMyCard:vi.fn(),getReceipts:vi.fn()};
 await respondWithLearning('我一直喜欢黑色衣服。','m1',{},agent,s.controls);expect(agent.find).not.toHaveBeenCalled();
});
it.each(['我平时穿衣服常选深色','我挑衣服时总会先看黑色那件。','我的外套大多是蓝色','I usually buy plain shirts','鞋'])('does not turn incidental product speech into a search: %s',async text=>{
 const s=setup();const agent={find:vi.fn(),accept:vi.fn(),getMyCard:vi.fn(),getReceipts:vi.fn()};
 await respondWithLearning(text,'casual',{},agent,s.controls);expect(agent.find).not.toHaveBeenCalled();
});
it.each(['帮我找一件外套','我想买个礼物','推荐一双鞋','找黑色衣服','我喜欢黑色，帮我找一件外套','Please find a blue jacket','Can you recommend a gift?','I am looking for a shirt'])('requires an actual shopping request: %s',text=>{
 expect(isShoppingRequest(text)).toBe(true);
});
it('slow or failed summaries cannot replace normal replies',async()=>{
 const s=setup();s.workspace.getLearned.mockRejectedValue(Error('secret'));expect(await s.controls.decorate('normal')).toBe('normal');
});

it('does not claim completed cleanup while the backend projection is pending',async()=>{
 const s=setup();s.workspace.forgetLearning.mockResolvedValue({field:'pref.color',paused:true,removed:1,projection:'pending',historyErased:false});
 expect(await s.controls.command('忘掉 颜色')).toContain('暂不能确认删除完成');expect(s.sink.enabled).toBe(false);
});

it('never silently deletes other values when the user names only one value',async()=>{
 const s=setup();s.workspace.getLearned.mockResolvedValue({paused:false,learned:[row,{...row,value:'蓝色'}]});
 expect(await s.controls.command('忘掉 黑色')).toContain('还有其他偏好');expect(s.workspace.forgetLearning).not.toHaveBeenCalled();
});
