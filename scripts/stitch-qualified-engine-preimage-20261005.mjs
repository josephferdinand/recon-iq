import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root='output/recon-retained-source-recovery-20261005';
const wanted='4e677bab86dc28c71d322d947b3abe1f42c0865ef618a5b3834c959b54eb4c02';
const sha=s=>createHash('sha256').update(s).digest('hex');
const rawHead=(await readFile(root+'/read-section-23-2.txt','utf8')).replaceAll('\r\n','\n');
const marker=rawHead.indexOf('…');
const prefix=rawHead.slice(0,rawHead.lastIndexOf('\n',marker)+1);
const rawTail=(await readFile(root+'/read-section-31-1.txt','utf8')).replaceAll('\r\n','\n');
const tail=rawTail.slice(rawTail.indexOf('\n\n')+2);
const headLines=prefix.trimEnd().split('\n'),tailLines=tail.split('\n');
const git=spawnSync('git',['show','989fda7:src/lib/recon-engine.ts'],{maxBuffer:2000000});
if(git.status!==0)throw new Error('Retained approved source unavailable');
const bases=[['approved989',git.stdout.toString()],['canonical',await readFile('src/lib/recon-engine.ts','utf8')]];
const attempts=[];let found;
for(const [basis,body]of bases){
 const text=body.replaceAll('\r\n','\n');
 for(let count=2;count<=8;count++){
  const anchor=headLines.slice(-count).join('\n')+'\n';
  const first=text.indexOf(anchor);if(first<0||text.indexOf(anchor,first+1)>=0)continue;
  const end=text.indexOf(tailLines.slice(0,3).join('\n'),first+anchor.length);if(end<0)continue;
  const gap=text.slice(first+anchor.length,end);
  attempts.push({basis,anchorLines:count,gapLines:gap.split('\n').length});
  for(let n=1;n<=tailLines.length;n++){
   const candidate=prefix+gap+tailLines.slice(0,n).join('\n');
   for(const value of [candidate,candidate+'\n',(candidate+'\n').replaceAll('\n','\r\n')]){
    if(sha(value)!==wanted)continue;found={value,basis,anchorLines:count,tailLines:n,gapLines:gap.split('\n').length,sha256:wanted};break;
   }
   if(found)break;
  }
  if(found)break;
 }
 if(found)break;
}
if(found)await writeFile(root+'/engine-preimage-EXACT.ts',found.value,{flag:'wx'});
const receipt={at:new Date().toISOString(),exactRecovered:!!found,qualified:found?{basis:found.basis,anchorLines:found.anchorLines,tailLines:found.tailLines,gapLines:found.gapLines,sha256:wanted}:null,attempts,commandsReplayed:false,workingSourceChanged:false};
await writeFile(root+'/ENGINE-STITCH-RECEIPT.json',JSON.stringify(receipt,null,2),{flag:'wx'});
console.log(JSON.stringify(receipt));
