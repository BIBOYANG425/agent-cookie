import {bounded,containsSensitive} from '@agent-cookie/learn';
import {resolveForgetPreference,preferenceLabels,type WorkspaceClient,type LearnedResponse} from '@agent-cookie/sdk';
import type {ObservationSink} from './learning-capture.js';
import {respond,type AgentWorkspace,type Conversation} from './agent.js';
export interface LearningLocalState {paused:boolean;lastSummaryDay?:string}
export type LearningWorkspace=Pick<WorkspaceClient,'getLearning'|'getLearned'|'setLearning'|'forgetLearning'>;
import { localeFromMessage, translator, type Locale } from './i18n.js';
import { isShoppingRequest } from './keywords.js';
export { isShoppingRequest } from './keywords.js';
const labelKeys = {'pref.color':'color','pref.material':'material','pref.fit':'fit','pref.brand':'brand','pref.style':'style','pref.avoid':'avoid','pref.occasion':'occasion','pref.size_system':'sizeSystem'} as const;
const label = (field: string, locale: Locale) => field in labelKeys ? translator(locale)(labelKeys[field as keyof typeof labelKeys]) : field;
export function createLearningControls(options:{workspace:LearningWorkspace;sink:ObservationSink;state:LearningLocalState;save:()=>Promise<void>;day?:()=>string}) {
  const call=<T>(f:(signal:AbortSignal)=>Promise<T>,ms=1500)=>bounded(f,ms);
  const freeze=async()=>{options.sink.pause();options.state.paused=true;await options.save();};
  return {
    async command(text:string, fallback?:Locale):Promise<string|undefined>{
      const locale=localeFromMessage(text,undefined,fallback);
      const msg=translator(locale);
      const t=text.trim();
      if(/^(?:暂停学习|pause learning)[。.!！]?$/i.test(t)){
        try{await freeze();const r=await call(signal=>options.workspace.setLearning({enabled:false},{signal}));
          if(!r.paused)throw Error();return msg('paused');
        }catch{return msg('pausedLocal');}
      }
      if(/^(?:恢复学习|resume learning)[。.!！]?$/i.test(t)){
        options.sink.pause();
        try{const r=await call(signal=>options.workspace.setLearning({enabled:true},{signal}));if(r.paused)throw Error();
          options.state.paused=false;await options.save();options.sink.resume();return msg('resumed');
        }catch{options.state.paused=true;return msg('resumeUnknown');}
      }
      const forget=/^(?:忘掉|忘记|forget)\s*(.+?)[。.!！]?$/i.exec(t);
      if(!forget)return;

      try{
        await freeze();
        const before=await call(signal=>options.workspace.getLearned({signal}));
        const target=forget[1].trim();
        const resolved=resolveForgetPreference(target,before.learned);
        if(resolved.kind==='missing')return msg('noPreference');
        if(resolved.kind==='ambiguous')return msg('ambiguous');
        if(resolved.kind==='partial'){
          const field=Object.entries(preferenceLabels).find(([,name])=>name===resolved.label)?.[0]??resolved.label??target;
          return msg('category',label(field,locale));
        }
        if(resolved.kind!=='resolved')throw Error();
        const field=resolved.field;
        const result=await call(signal=>options.workspace.forgetLearning({field},{signal}),5000);
        if(result.projection!=='complete')return msg('projection');
        const after=await call(signal=>options.workspace.getLearned({signal}));
        if(!after.paused||after.learned.some(p=>p.field===field))throw Error();
        return msg('forgotten');
      }catch{return msg('forgetUnknown');}
    },
    async decorate(reply:string,locale:Locale='zh'):Promise<string>{
      const msg=translator(locale);
      const day=(options.day??(()=>new Date().toLocaleDateString('en-CA')))();
      if(options.state.paused||options.state.lastSummaryDay===day)return reply;
      try{
        const current:LearnedResponse=await call(signal=>options.workspace.getLearned({signal}),250);
        if(current.paused){await freeze();return reply;}
        const rows=current.learned.filter(p=>Object.hasOwn(labelKeys,p.field)&&p.status==='card'&&!containsSensitive(p.value)&&p.evidence.every(e=>!containsSensitive(e.snippet??'')));
        if(!rows.length)return reply;
        options.state.lastSummaryDay=day;await options.save();
        return reply+msg('summary')+rows.slice(0,3).map(p=>`${label(p.field,locale)}：${p.value}`).join('\n')+msg('controls');
      }catch{return reply;}
    },
  };
}
export type LearningControls=ReturnType<typeof createLearningControls>;
export async function respondWithLearning(text:string,id:string,conversation:Conversation,workspace:AgentWorkspace,controls:LearningControls){
  const locale=localeFromMessage(text,conversation.cardLang,conversation.locale);
  const command=await controls.command(text,locale);if(command!==undefined)return command;
  const operation=/^(?:身份卡|我的资料|读卡|查看身份卡|card|回执|查看回执|receipts|(?:要|选|选择|我要)?\s*(?:第)?\s*[1-9一二两三四五]\s*(?:双|个|款|件)?[。！!]?|(?:choose|select|take)\s+[1-9])$/i.test(text.trim());
  const reply=operation||isShoppingRequest(text)?await respond(text,id,conversation,workspace):translator(locale)('chat');
  return controls.decorate(reply,localeFromMessage(text,conversation.cardLang,conversation.locale));
}
