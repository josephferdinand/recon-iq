import {spawnSync} from 'node:child_process';
import {writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const out='output/recon-retained-source-recovery-20261005/git-images';
await mkdir(out,{recursive:true});
const cases=[['src/lib/recon-engine.ts','4e677bab86dc28c71d322d947b3abe1f42c0865ef618a5b3834c959b54eb4c02'],['src/components/recons-tab.tsx','5169d6a0831fc72eab964cb1570baecfee0d4750111ceb93bee58c3606faa501']];
const sha=value=>createHash('sha256').update(value).digest('hex'),results=[];
for(const [file,wanted]of cases){
 const commits=spawnSync('git',['rev-list','--all','--',file],{encoding:'utf8',maxBuffer:1000000});
 if(commits.status!==0)throw new Error('Retained Git history unavailable');
 const refs=commits.stdout.trim().split('\n').filter(Boolean);let found=false;
 for(const ref of refs){const actual=spawnSync('git',['show',ref+':'+file],{maxBuffer:2000000});if(actual.status!==0)continue;const text=actual.stdout.toString();for(const [encoding,value]of [['git',text],['crlf',text.replace(/\r?\n/g,'\r\n')]]){if(sha(value)!==wanted)continue;const name=file.endsWith('.tsx')?'count-ui-preimage.tsx':'engine-preimage.ts';await writeFile(out+'/'+name,value,{flag:'wx'});results.push({file,ref,encoding,sha256:wanted,recovered:true,path:out+'/'+name});found=true;break;}if(found)break;}
 if(!found)results.push({file,knownImage:wanted,commitsSearched:refs.length,recovered:false});
}
await writeFile(out+'/RECEIPT.json',JSON.stringify({at:new Date().toISOString(),results,workingFilesChanged:false},null,2),{flag:'wx'});
console.log(JSON.stringify(results));
