import {createIsolatedOtel} from '@photon-ai/otel';
import type {LearningMetric} from './index.js';
export type PipelineMetric=LearningMetric|{stage:'capture';status:'queued'|'dropped'|'accepted'|'unavailable';count:number;durationMs:number};

/** No global instrumentation, baggage, raw errors, values, text, hashes or identifiers. */
export function createLearningTelemetry(options:{endpoint?:string;headers?:Record<string,string>}={}) {
  if(!options.endpoint)return {metric:(_metric:PipelineMetric)=>{},shutdown:async()=>{}};
  const url=new URL(options.endpoint);
  if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw Error('Invalid learning telemetry endpoint.');
  const runtime=createIsolatedOtel({endpoint:url.toString(),headers:options.headers,serviceName:'agent-cookie-learning',serviceVersion:'0.0.0',traceparentHeader:'x-agent-cookie-learning-trace'});
  const log=runtime.createLogger('agent-cookie.learning');
  const pending=new Set<Promise<unknown>>();
  return {
    metric(m:PipelineMetric):void{
      try{
        if(!m||!['filter','classify','extract','capture'].includes(m.stage)||!['ok','queued','dropped','accepted','unavailable'].includes(m.status)
          ||!Number.isFinite(m.count)||!Number.isFinite(m.durationMs)||pending.size>=32)return;
        // Explicit construction, never {...m}. Model outputs and message objects cannot escape.
        const attributes={'learning.stage':m.stage,'learning.status':m.status,
          'learning.count':Math.max(0,Math.min(200,Math.floor(m.count))),
          'learning.duration_ms':Math.max(0,Math.min(10000,Math.round(m.durationMs)))};
        const task=runtime.withSpan('learning.'+m.stage,attributes,()=>{
          log.emit({body:'learning.stage',severityNumber:9,attributes});
        }).catch(()=>{});
        pending.add(task);void task.finally(()=>pending.delete(task));
      }catch{/* metrics never interfere with the pipeline */}
    },
    async shutdown(){await Promise.allSettled([...pending]);try{await runtime.shutdown()}catch{/* no raw exporter errors */}},
  };
}
