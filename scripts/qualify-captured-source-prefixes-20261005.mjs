import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root='output/recon-retained-source-recovery-20261005';
const sha=value=>createHash('sha256').update(value).digest('hex');
const wanted='4e677bab86dc28c71d322d947b3abe1f42c0865ef618a5b3834c959b54eb4c02';
const captured=await readFile(root+'/read-section-23-2.txt','utf8');
let found;
for(let end=0;end<captured.length;end++){
 if(captured[end]!=='\n')continue;
 const prefix=captured.slice(0,end+1);
 for(const value of new Set([prefix,prefix.replaceAll('\r\n','\n'),prefix.replace(/\r?\n/g,'\r\n'),prefix.trimEnd()])){
  if(sha(value)!==wanted)continue;found={value,chars:value.length,sha256:wanted};break;
 }
 if(found)break;
}
if(found)await writeFile(root+'/engine-preimage-EXACT.ts',found.value,{flag:'wx'});
const receipt={at:new Date().toISOString(),exactPreimageRecovered:!!found,sha256:found?.sha256,chars:found?.chars,capturedSource:'read-section-23-2.txt',historicalCommandsExecuted:false};
await writeFile(root+'/PREFIX-QUALIFICATION.json',JSON.stringify(receipt,null,2),{flag:'wx'});
console.log(JSON.stringify(receipt));
