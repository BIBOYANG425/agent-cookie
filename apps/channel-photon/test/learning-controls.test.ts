import {it,expect,vi} from 'vitest';
import {createLearningControls,respondWithLearning,type LearningLocalState} from '../src/learning-controls.js';
import {createObservationSink} from '../src/learning-capture.js';
const row={field:'pref.color',value:'黑色',evidence:[{contributionId:'p1',agentId:'personal',basis:'stated' as const,createdAt:'2026-10-17T22:00:00Z',snippet:'我喜欢黑色'}],sources:['p1'],status:'card' as const};
function setup(){
 const workspace={getLearning:vi.fn().mockResolvedValue({paused:false}),getLearned:vi.fn().mockResolvedValue({paused:false,learned:[row]}),setLearning:vi.fn().mockResolvedValue({paused:false}),revokeContribution:vi.fn().mockResolvedValue({ok:true,card:{card:[],candidates:[],superseded:[]},sample:true})};
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
it('revokes exact contribution IDs but does not mislabel revoke as history deletion',async()=>{
 const s=setup();s.workspace.setLearning.mockResolvedValue({paused:true});
 s.workspace.getLearned.mockResolvedValueOnce({paused:true,learned:[row]}).mockResolvedValueOnce({paused:true,learned:[]});
 expect(await s.controls.command('忘掉 颜色')).toContain('还不能确认完全删除');expect(s.workspace.revokeContribution).toHaveBeenCalledWith('p1',expect.anything());expect(s.sink.enabled).toBe(false);
});
it('does not guess ambiguous targets',async()=>{
 const s=setup();s.workspace.setLearning.mockResolvedValue({paused:true});expect(await s.controls.command('忘掉 那个')).toContain('没有找到');expect(s.workspace.revokeContribution).not.toHaveBeenCalled();
});
it('daily summary reads current active conclusions and occurs once',async()=>{
 const s=setup();expect(await s.controls.decorate('ok')).toContain('颜色：黑色');expect(await s.controls.decorate('again')).toBe('again');
 delete s.state.lastSummaryDay;s.workspace.getLearned.mockResolvedValue({paused:false,learned:[]});expect(await s.controls.decorate('later')).toBe('later');
});
it('ordinary preference speech is not a shopping intent',async()=>{
 const s=setup();const agent={find:vi.fn(),accept:vi.fn(),getMyCard:vi.fn(),getReceipts:vi.fn()};
 await respondWithLearning('我一直喜欢黑色衣服。','m1',{},agent,s.controls);expect(agent.find).not.toHaveBeenCalled();
});
it('slow or failed summaries cannot replace normal replies',async()=>{
 const s=setup();s.workspace.getLearned.mockRejectedValue(Error('secret'));expect(await s.controls.decorate('normal')).toBe('normal');
});
