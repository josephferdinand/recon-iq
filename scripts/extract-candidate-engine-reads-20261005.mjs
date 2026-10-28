import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {mkdir,writeFile} from 'node:fs/promises';
const file='./LOCAL_USER/.codex/sessions/2026/10/04/rollout-2026-10-04T21-25-38-01a107a0-c22c-79f3-91b2-dae5e510722b.jsonl';
const out='output/recon-retained-source-recovery-20261005/candidate-read-frames';await mkdir(out,{recursive:true});
const wanted=new Map(),receipt=[];let number=0;
function texts(x){if(typeof x==='string')return[x];if(Array.isArray(x))return x.flatMap(texts);return x&&typeof x==='object'?Object.values(x).flatMap(texts):[];}
for await(const line of createInterface({input:createReadStream(file),crlfDelay:Infinity})){number++;let e;try{e=JSON.parse(line);}catch{continue;}const p=e.payload;if(e.type!=='response_item')continue;
 if(['custom_tool_call','function_call'].includes(p?.type)){const code=p.input??p.arguments;if(typeof code!=='string'||!code.includes('Get-Content')||!code.includes('recon-engine.ts')||!code.includes('fvi-batch4-candidate-20260928')||/vault|\.cred|password|authorization/i.test(code))continue;wanted.set(p.call_id,{line:number,skip400:code.includes('-Skip 400'),skip553:code.includes('-Skip 553'),gitDiff:code.includes('git diff --no-index')});}
 if(['custom_tool_call_output','function_call_output'].includes(p?.type)&&wanted.has(p.call_id)){const values=texts(p.output??p.content),meta=wanted.get(p.call_id);let n=0;for(const text of values){if(text.length<500||text.length>150000)continue;const name='read-'+number+'-'+(++n)+'.txt';await writeFile(out+'/'+name,text,{flag:'wx'});receipt.push({...meta,outputLine:number,file:name,bytes:Buffer.byteLength(text)});}}
}
await writeFile(out+'/RECEIPT-'+Date.now()+'.json',JSON.stringify(receipt,null,2),{flag:'wx'});console.log(JSON.stringify(receipt));
