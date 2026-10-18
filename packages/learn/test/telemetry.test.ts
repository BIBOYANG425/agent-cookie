import {createServer} from 'node:http';
import {gunzipSync} from 'node:zlib';
import {it,expect} from 'vitest';
import {createLearningTelemetry} from '../src/telemetry.js';

it('exports real Photon OTel spans and logs with allowlisted metadata only',async()=>{
 const payloads:Buffer[]=[];const paths:string[]=[];
 const server=createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
   const body=Buffer.concat(chunks);payloads.push(req.headers['content-encoding']==='gzip'?gunzipSync(body):body);paths.push(req.url!);
   res.writeHead(200,{'content-type':'application/json'});res.end('{}');});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{
   const port=(server.address() as {port:number}).port;
   const telemetry=createLearningTelemetry({endpoint:`http://127.0.0.1:${port}`});
   const canary='RAW_CANARY +12135551234 secret@example.com 我喜欢紫色';
   telemetry.metric({stage:'extract',status:'ok',count:1,durationMs:3,text:canary,evidence:canary,key:'pref.secret',error:new Error(canary)} as any);
   telemetry.metric({stage:canary,status:'ok',count:1,durationMs:1} as any);
   await telemetry.shutdown();
   expect(paths).toContain('/v1/traces');expect(paths).toContain('/v1/logs');
   const bytes=Buffer.concat(payloads).toString('utf8');
   expect(bytes).toContain('learning.extract');expect(bytes).toContain('learning.stage');
   for(const secret of [canary,'RAW_CANARY','2135551234','secret@example.com','pref.secret','紫色'])expect(bytes).not.toContain(secret);
 }finally{await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));}
});
it('is disabled without an explicit exporter and rejects credential-bearing URLs',async()=>{
 const t=createLearningTelemetry();t.metric({stage:'filter',status:'ok',count:0,durationMs:1});await t.shutdown();
 expect(()=>createLearningTelemetry({endpoint:'https://user:secret@example.com'})).toThrow();
});
