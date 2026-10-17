import {it,expect,vi} from 'vitest';
import {createLearningControls,respondWithLearning,type LearningLocalState} from '../src/learning-controls.js';
import {createObservationSink} from '../src/learning-capture.js';
const row={id:'p1',key:'pref.color',value:'黑色',evidence:'我喜欢黑色',basis:'stated' as const,status:'confirmed' as const,updatedAt:'2026-10-17T22:00:00Z'};
function setup(){
 const workspace={getLearning:vi.fn().mockResolvedValue({enabled:true,generation:1,learned:[row]}),setLearning:vi.fn().mockResolvedValue({enabled:true,generation:2,forgottenKeys:['pref.color']})};
 const sink=createObservationSink({observe:async()=>({accepted:true})});const state:LearningLocalState={paused:false};const save=vi.fn(async()=>{});
 return {workspace,sink,state,save,controls:createLearningControls({workspace,sink,state,save,day:()=> '2026-10-17'})};
}
it('freezes immediately on pause even when server fails',async()=>{
 const s=setup();s.workspace.setLearning.mockRejectedValue(Error('secret'));
 const pending=s.controls.command('暂停学习');expect(s.sink.enabled).toBe(false);expect(await pending).toContain('后台尚未确认');expect(s.state.paused).toBe(true);
});
it('requires backend confirmation before resume',async()=>{
 const s=setup();s.sink.pause();expect(await s.controls.command('恢复学习')).toContain('后台已确认恢复');expect(s.sink.enabled).toBe(true);
});
it('only confirms exact forgotten keys with a newer generation',async()=>{
 const s=setup();expect(await s.controls.command('忘掉 颜色')).toContain('已确认删除');expect(s.workspace.setLearning).toHaveBeenCalledWith({forgetKeys:['pref.color']},expect.anything());
 s.workspace.setLearning.mockResolvedValue({enabled:true,generation:1,forgottenKeys:['pref.color']});
 expect(await s.controls.command('忘掉 黑色')).toContain('未确认删除');expect(s.sink.enabled).toBe(false);
});
it('does not guess ambiguous targets',async()=>{
 const s=setup();expect(await s.controls.command('忘掉 那个')).toContain('没有找到');expect(s.workspace.setLearning).not.toHaveBeenCalled();
});
it('daily summary reads current active conclusions and occurs once',async()=>{
 const s=setup();expect(await s.controls.decorate('ok')).toContain('颜色：黑色');expect(await s.controls.decorate('again')).toBe('again');
 delete s.state.lastSummaryDay;s.workspace.getLearning.mockResolvedValue({enabled:true,generation:3,learned:[]});expect(await s.controls.decorate('later')).toBe('later');
});
it('ordinary preference speech is not a shopping intent',async()=>{
 const s=setup();const agent={find:vi.fn(),accept:vi.fn(),getMyCard:vi.fn(),getReceipts:vi.fn()};
 await respondWithLearning('我一直喜欢黑色衣服。','m1',{},agent,s.controls);expect(agent.find).not.toHaveBeenCalled();
});
it('slow or failed summaries cannot replace normal replies',async()=>{
 const s=setup();s.workspace.getLearning.mockRejectedValue(Error('secret'));expect(await s.controls.decorate('normal')).toBe('normal');
});
