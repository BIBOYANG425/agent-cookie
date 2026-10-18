import {bounded,containsSensitive,explicitStatement} from '@agent-cookie/learn';
import type {WorkspaceClient,LearnedResponse} from '@agent-cookie/sdk';
import type {ObservationSink} from './learning-capture.js';
import {respond,type AgentWorkspace,type Conversation} from './agent.js';
export interface LearningLocalState {paused:boolean;lastSummaryDay?:string}
export type LearningWorkspace=Pick<WorkspaceClient,'getLearning'|'getLearned'|'setLearning'|'forgetLearning'>;
const labels:Record<string,string>={'pref.color':'颜色','pref.material':'材质','pref.fit':'版型','pref.brand':'品牌','pref.style':'风格','pref.avoid':'避开','pref.occasion':'场合','pref.size_system':'尺码体系'};
export function createLearningControls(options:{workspace:LearningWorkspace;sink:ObservationSink;state:LearningLocalState;save:()=>Promise<void>;day?:()=>string}) {
  const call=<T>(f:(signal:AbortSignal)=>Promise<T>,ms=1500)=>bounded(f,ms);
  const freeze=async()=>{options.sink.pause();options.state.paused=true;await options.save();};
  return {
    async command(text:string):Promise<string|undefined>{
      const t=text.trim();
      if(/^(?:暂停学习|pause learning)[。.!！]?$/i.test(t)){
        try{await freeze();const r=await call(signal=>options.workspace.setLearning({enabled:false},{signal}));
          if(!r.paused)throw Error();return '已暂停学习，后台已确认。已有偏好可在控制台撤销，或回复「忘掉 颜色」。';
        }catch{return '本机已暂停学习；后台尚未确认暂停，请稍后查看控制台。';}
      }
      if(/^(?:恢复学习|resume learning)[。.!！]?$/i.test(t)){
        options.sink.pause();
        try{const r=await call(signal=>options.workspace.setLearning({enabled:true},{signal}));if(r.paused)throw Error();
          options.state.paused=false;await options.save();options.sink.resume();return '后台已确认恢复学习。只学习你的非敏感稳定偏好，可随时暂停或撤销。';
        }catch{options.state.paused=true;return '尚未确认恢复学习，本机继续暂停。';}
      }
      const forget=/^(?:忘掉|忘记|forget)\s*(.+?)[。.!！]?$/i.exec(t);
      if(!forget)return;

      try{
        await freeze();
        const before=await call(signal=>options.workspace.getLearned({signal}));
        const target=forget[1].trim();
        const keys=[...new Set(before.learned.filter(p=>p.field===target||labels[p.field]===target||p.value===target).map(p=>p.field))];
        if(keys.length!==1)return keys.length?'对应多个偏好。请到控制台选择要撤销的项；本机采集已暂停。':'没有找到明确对应的偏好。请用控制台显示的名称（例如「忘掉 颜色」）；本机采集已暂停。';
        const field=before.learned.find(p=>p.field===keys[0])!.field;
        const result=await call(signal=>options.workspace.forgetLearning({field},{signal}),5000);
        if(result.projection!=='complete')return '后台已暂停学习并移除当前偏好；记忆文件清理仍在等待完成，暂不能确认删除完成。';
        const after=await call(signal=>options.workspace.getLearned({signal}));
        if(!after.paused||after.learned.some(p=>keys.includes(p.field)))throw Error();
        return '已删除当前偏好及其证据，学习保持暂停。旧 Git 历史仍保留，本次没有擦除历史版本。';
      }catch{return '本机学习已暂停，但后台未确认删除。请到控制台核对；我不会把它说成已删除。';}
    },
    async decorate(reply:string):Promise<string>{
      const day=(options.day??(()=>new Date().toLocaleDateString('en-CA')))();
      if(options.state.paused||options.state.lastSummaryDay===day)return reply;
      try{
        const current:LearnedResponse=await call(signal=>options.workspace.getLearned({signal}),250);
        if(current.paused){await freeze();return reply;}
        const rows=current.learned.filter(p=>Object.hasOwn(labels,p.field)&&p.status==='card'&&!containsSensitive(p.value)&&p.evidence.every(e=>!containsSensitive(e.snippet??'')));
        if(!rows.length)return reply;
        options.state.lastSummaryDay=day;await options.save();
        return reply+'\n\n今日偏好摘要（当前已确认）：\n'+rows.slice(0,3).map(p=>`${labels[p.field]??'偏好'}：${p.value}`).join('\n')+'\n可在控制台查看，回复「忘掉 X」或「暂停学习」。';
      }catch{return reply;}
    },
  };
}
export type LearningControls=ReturnType<typeof createLearningControls>;
export function isShoppingRequest(text:string):boolean {
  if(explicitStatement(text)||/我.{0,5}(?:喜欢|偏好|习惯)|\bI (?:like|prefer|love)\b/iu.test(text))return false;
  return /(?:帮我|想|我要|另)?(?:找|买|挑|选购|推荐)|\b(?:find|search|buy|shop|recommend|looking for)\b/iu.test(text)
    || (text.length<40&&!/[。.!?？]/u.test(text)&&/(?:鞋|外套|礼物|收纳|衣服|coat|jacket|shoes?|gift|shirt|bag)/iu.test(text));
}
export async function respondWithLearning(text:string,id:string,conversation:Conversation,workspace:AgentWorkspace,controls:LearningControls){
  const command=await controls.command(text);if(command!==undefined)return command;
  const operation=/^(?:身份卡|我的资料|读卡|查看身份卡|card|回执|查看回执|receipts|(?:要|选|选择|我要)?\s*(?:第)?\s*[1-9一二两三四五]\s*(?:双|个|款|件)?[。！!]?|(?:choose|select|take)\s+[1-9])$/i.test(text.trim());
  const reply=operation||isShoppingRequest(text)?await respond(text,id,conversation,workspace):'收到。日常聊天不会自动变成购物请求；偏好是否学到，以控制台记录为准。';
  return controls.decorate(reply);
}
