import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {mkdir,writeFile} from 'node:fs/promises';
const input='./LOCAL_USER/.codex/sessions/2026/10/04/rollout-2026-10-04T21-25-38-01a107a0-c22c-79f3-91b2-dae5e510722b.jsonl';
const root='output/recon-retained-source-recovery-20261005/ui-read-frames';await mkdir(root,{recursive:true});
const ids=new Set(['call_i4Ahm9s5TAMaBF5NQlK96hBz','call_XdsFGTs9zFLby4esYub6zwwn','call_cCkT5FNGRgC2NYDWqehgmzEQ','call_F69Tda8DKC2BTrueceF4edof']);
function strings(x){if(typeof x==='string')return[x];if(Array.isArray(x))return x.flatMap(strings);return x&&typeof x==='object'?Object.values(x).flatMap(strings):[];}
function decode(text,start){let out='';for(let i=start+1;i<text.length;i++){const c=text[i];if(c==='"')return out;if(c==='\r'||c==='\n')return out;if(c!=='\\'){out+=c;continue;}const n=text[++i],table={n:'\n',r:'\r',t:'\t',b:'\b',f:'\f','"':'"','\\':'\\','/':'/'};if(Object.hasOwn(table,n)){out+=table[n];continue;}if(n==='u'&&/^[a-f0-9]{4}$/i.test(text.slice(i+1,i+5))){out+=String.fromCharCode(parseInt(text.slice(i+1,i+5),16));i+=4;continue;}return out;}return out;}
let lineNumber=0;const receipt=[];
for await(const line of createInterface({input:createReadStream(input),crlfDelay:Infinity})){lineNumber++;let e;try{e=JSON.parse(line);}catch{continue;}const p=e.payload;if(e.type!=='response_item'||!['custom_tool_call_output','function_call_output'].includes(p?.type)||!ids.has(p.call_id))continue;let count=0;for(const raw of strings(p.output??p.content)){let cursor=0;while((cursor=raw.indexOf('"output":',cursor))>=0){const first=raw.indexOf('"',cursor+9);cursor+=9;if(first<0)break;const text=decode(raw,first);const name='read-'+lineNumber+'-'+(++count)+'.txt';await writeFile(root+'/'+name,text,{flag:'wx'});receipt.push({line:lineNumber,call:p.call_id,file:name,bytes:Buffer.byteLength(text),truncated:text.includes('truncated'),uiImportAt:text.indexOf('import { useMemo')});}}}
await writeFile(root+'/RECEIPT.json',JSON.stringify(receipt,null,2),{flag:'wx'});console.log(JSON.stringify(receipt));
