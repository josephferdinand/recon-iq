import {open,readdir,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
const base='./LOCAL_USER/.codex/sessions/2026/10';const matches=[];let inspected=0,own=0;
for(const date of ['04','03','02','01']){
 for(const name of await readdir(base+'/'+date)){
  if(!name.endsWith('.jsonl'))continue;const file=base+'/'+date+'/'+name;
  const fd=await open(file,'r');const buffer=Buffer.alloc(16384);let first;try{const {bytesRead}=await fd.read(buffer,0,buffer.length,0);first=buffer.subarray(0,bytesRead).toString().split('\n')[0];}finally{await fd.close();}
  if(!first.includes('"type":"session_meta"'))continue;const match=first.match(/"cwd":"((?:\\.|[^"\\])*)"/);if(!match)continue;inspected++;
  const cwd=JSON.parse('"'+match[1]+'"');if(!/ReconIQ|fvi-batch4-candidate|fvi-codex-docs-release/i.test(cwd))continue;own++;
  let n=0,count=0,mutation=0;for await(const line of createInterface({input:createReadStream(file),crlfDelay:Infinity})){n++;if(!line.includes(process.argv[2]??'ReconRunControl'))continue;let e;try{e=JSON.parse(line);}catch{continue;}if(process.argv[3]&&e.timestamp>process.argv[3])continue;const p=e.payload;if(e.type!=='response_item'||!['custom_tool_call','function_call'].includes(p?.type))continue;const code=p.input??p.arguments;if(typeof code!=='string')continue;count++;if(/apply_patch|writeFile|write_text/.test(code))mutation++;}
  if(mutation)matches.push({file,cwd,sourceCalls:count,mutationCalls:mutation});
 }
}
const receipt={at:new Date().toISOString(),metadataInspected:inspected,fviSessionsScanned:own,matches,unrelatedSessionContentsRead:false};await writeFile('output/recon-retained-source-recovery-20261005/FVI-UI-SOURCE-SESSION-LOCATOR-'+Date.now()+'.json',JSON.stringify(receipt,null,2),{flag:'wx'});console.log(JSON.stringify(receipt));
