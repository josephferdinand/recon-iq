import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import ts from 'typescript';
const source=process.argv[2]??'./LOCAL_USER/.codex/sessions/2026/09/28/rollout-2026-09-28T20-56-57-01a0e8a0-57a5-7e30-a678-4c2c14c19f85.jsonl';
const root=process.argv[3]??'output/recon-retained-source-recovery-20261005/parent-source-literals';
const allowed=['src/lib/recon-engine.ts','src/components/recons-tab.tsx'];
const wanted=new Map([
 ['4e677bab86dc28c71d322d947b3abe1f42c0865ef618a5b3834c959b54eb4c02','engine-preimage.ts'],
 ['523644c6137e5beb91a0ae0eebc616d58b7201f822b3f41eca07ad82f7742647','engine-deployed.ts'],
 ['5169d6a0831fc72eab964cb1570baecfee0d4750111ceb93bee58c3606faa501','recons-preimage.tsx'],
 ['5768b300a8f4a508935204b25a969448bc9863df45f3a1b0b8807f20e1db5842','recons-deployed.tsx'],
]);
const sha=x=>createHash('sha256').update(x).digest('hex');
await mkdir(root,{recursive:true});
const patches=[],matches=[],seen=new Set();let lines=0,selected=0;
async function save(name,text){try{await writeFile(root+'/'+name,text,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;if(sha(await readFile(root+'/'+name))!==sha(text))throw new Error('Source collision');}}
for await(const line of createInterface({input:createReadStream(source),crlfDelay:Infinity})){
 lines++;if(!allowed.some(p=>line.includes(p.split('/').at(-1))))continue;
 let event;try{event=JSON.parse(line);}catch{continue;}
 const p=event.payload;if(event.type!=='response_item'||!['custom_tool_call','function_call'].includes(p?.type))continue;
 const code=p.input??p.arguments;if(typeof code!=='string'||code.length>3000000)continue;
 selected++;
 const ast=ts.createSourceFile('source-data.js',code,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),strings=[];
 function walk(node){if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))strings.push(node.text);ts.forEachChild(node,walk);}walk(ast);
 for(const literal of strings){
  for(const value of new Set([literal,literal.replace(/\r\n/g,'\n'),literal.replace(/\r?\n/g,'\r\n')])){const hash=sha(value);if(wanted.has(hash)&&!seen.has(hash)){seen.add(hash);await save(wanted.get(hash),value);matches.push({line:lines,sha256:hash,file:wanted.get(hash)});}}
  if(!literal.startsWith('*** Begin Patch'))continue;
  const parts=literal.split(/(?=^\*\*\* (?:Update|Add|Delete) File: )/m).slice(1);
  const keep=parts.filter(part=>allowed.some(path=>part.split('\n')[0].replace(/\\/g,'/').endsWith(path)));
  if(!keep.length)continue;
  const patch='*** Begin Patch\n'+keep.map(x=>x.replace(/\*\*\* End Patch\s*$/,'').trimEnd()).join('\n')+'\n*** End Patch';
  const hash=sha(patch);if(seen.has(hash))continue;seen.add(hash);
  const file='patch-'+String(patches.length+1).padStart(3,'0')+'.txt';await save(file,patch);patches.push({line:lines,file,sha256:hash});
 }
}
const receipt={at:new Date().toISOString(),source,lines,selectedCalls:selected,patches,matches,oldCommandsExecuted:false,workingSourceChanged:false};
await save('RECEIPT-'+Date.now()+'.json',JSON.stringify(receipt,null,2));
console.log(JSON.stringify({lines,selectedCalls:selected,patches:patches.length,matches}));
