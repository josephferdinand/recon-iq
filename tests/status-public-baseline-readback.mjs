import fs from 'node:fs';import {createHash} from 'node:crypto';
const results=[];
for(const url of ['https://status.reconiq.example/','https://app.reconiq.example/api/public/status.json']){
 try{const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(8000),headers:{accept:'application/json,text/html'}});const body=await response.text();let data;try{data=JSON.parse(body);}catch{}
  results.push({url,http:response.status,contentType:response.headers.get('content-type'),sha256:createHash('sha256').update(body).digest('hex'),bytes:Buffer.byteLength(body),
   overall:data?.overall??null,data_status:data?.data_status??null,component_count:Array.isArray(data?.components)?data.components.length:null,
   legacy_history_count:Array.isArray(data?.history)?data.history.length:null,health_row_count:Array.isArray(data?.health)?data.health.length:null,
   verified_functional_proof:false,note:'Read-only baseline: HTTP/rendering/declared rows do not qualify functional service health.'});
 }catch(error){results.push({url,http:null,error_code:error.cause?.code??error.name,note:'No TLS bypass or hosted mutation attempted.'});}
}
fs.writeFileSync('docs/evidence/status-lane-2026-10-03/public-baseline-readback.json',JSON.stringify({at:new Date().toISOString(),read_only:true,results},null,2));console.log(JSON.stringify(results));
