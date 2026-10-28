import {createReadStream} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import ts from 'typescript';
const input='./LOCAL_USER/.codex/sessions/2026/10/04/rollout-2026-10-04T21-25-38-01a107a0-c22c-79f3-91b2-dae5e510722b.jsonl';
const out='output/recon-retained-source-recovery-20261005';
const wanted={
 '4e677bab86dc28c71d322d947b3abe1f42c0865ef618a5b3834c959b54eb4c02':'engine-preimage.ts',
 '523644c6137e5beb91a0ae0eebc616d58b7201f822b3f41eca07ad82f7742647':'engine-postimage.ts',
 '5169d6a0831fc72eab964cb1570baecfee0d4750111ceb93bee58c3606faa501':'count-ui-preimage.tsx',
 '5768b300a8f4a508935204b25a969448bc9863df45f3a1b0b8807f20e1db5842':'count-ui-postimage.tsx',
};
const sha=s=>createHash('sha256').update(s).digest('hex');
await mkdir(out+'/patches',{recursive:true});
const recovered={},patches=[],types={};let lines=0;
const captureReads=new Set(['call_8YYegHAMpc5wZFfIjzkKA1V7','call_ZrCnCRFHgEGRPTcodW2MaWPC']);
async function inspectString(value,recordLine,depth=0){
 if(typeof value!=='string'||value.length<64||value.length>2000000)return;
 for(const variant of new Set([value,value.replaceAll('\r\n','\n'),value.replace(/\r?\n/g,'\r\n'),value.trimEnd()+'\n',value.trimEnd()+'\r\n'])){
  const hash=sha(variant);if(wanted[hash]&&!recovered[hash]){await writeFile(out+'/'+wanted[hash],variant,{flag:'wx'});recovered[hash]={file:wanted[hash],recordLine,sha256:hash};}
 }
 if(value.startsWith('*** Begin Patch')&&value.includes('src/')&&!patches.some(p=>p.sha256===sha(value))){
  const file='patches/patch-'+String(patches.length+1).padStart(3,'0')+'.txt';await writeFile(out+'/'+file,value,{flag:'wx'});patches.push({file,recordLine,sha256:sha(value),sourceOnlyInspection:true});
 }
 if(depth<2&&(value.startsWith('{')||value.startsWith('['))){try{await inspectObject(JSON.parse(value),recordLine,depth+1);}catch{}}
}
async function inspectObject(value,recordLine,depth=0){
 if(typeof value==='string')return inspectString(value,recordLine,depth);
 if(Array.isArray(value)){for(const item of value)await inspectObject(item,recordLine,depth);}
 else if(value&&typeof value==='object'){for(const [key,item]of Object.entries(value)){if(!['instructions','system','developer'].includes(key))await inspectObject(item,recordLine,depth);}}
}
for await(const line of createInterface({input:createReadStream(input),crlfDelay:Infinity})){
 lines++;let event;try{event=JSON.parse(line);}catch{continue;}
 const payload=event.payload;types[event.type]=(types[event.type]??0)+1;
 if(event.type!=='response_item'||!payload)continue;
 if(captureReads.has(payload.call_id)&&['function_call_output','custom_tool_call_output'].includes(payload.type)){
  const strings=[];function gather(value){if(typeof value==='string')strings.push(value);else if(Array.isArray(value))value.forEach(gather);else if(value&&typeof value==='object')Object.values(value).forEach(gather);}gather(payload.output);
  const raw=strings.find(value=>value.length>1000);
  if(raw){const file=out+'/read-output-'+lines+'.txt';try{await writeFile(file,raw,{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}}
 }
 if(['function_call_output','custom_tool_call_output'].includes(payload.type))await inspectObject(payload.output??payload.content,lines);
 if(['function_call','custom_tool_call'].includes(payload.type)){
  const code=payload.input??payload.arguments;
  await inspectString(code,lines);
  if(typeof code==='string'&&code.length<2000000){
   const tree=ts.createSourceFile('captured-tool.js',code,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
   const strings=[];function walk(node){if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))strings.push(node.text);ts.forEachChild(node,walk);}walk(tree);
   for(const literal of strings)await inspectString(literal,lines);
  }
 }
}
const receipt={at:new Date().toISOString(),input,lines,types,recovered,patches,oldCommandsExecuted:false,privateCredentialsInspected:false,sourceComplete:Object.keys(recovered).length===4};
await writeFile(out+'/EXTRACTION-'+Date.now()+'.json',JSON.stringify(receipt,null,2),{flag:'wx'});
console.log(JSON.stringify({lines,knownWholeSourceImages:Object.keys(recovered).length,sourcePatchLiterals:patches.length,receipt:out+'/EXTRACTION.json',commandsExecuted:false}));
