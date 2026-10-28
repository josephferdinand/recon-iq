import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
const input=process.argv[2]??'./LOCAL_USER/.codex/sessions/2026/10/01/rollout-2026-10-01T22-42-51-01a0f874-5c3d-7241-8e0c-67e7694d6c25.jsonl';let n=0;
for await(const line of createInterface({input:createReadStream(input),crlfDelay:Infinity})){n++;if(!line.includes('recons-tab.tsx'))continue;let e;try{e=JSON.parse(line);}catch{continue;}const p=e.payload,s=p?.input??p?.arguments;if(e.type!=='response_item'||!['custom_tool_call','function_call'].includes(p?.type)||typeof s!=='string'||/vault|password|\.cred/i.test(s))continue;if(/apply_patch|writeFile|write_text|\.replace\(/.test(s))console.log(JSON.stringify({line:n,call:p.call_id,size:s.length,first:s.slice(0,250)}));}
