import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root='output/recon-retained-source-recovery-20261005',wanted='4e677bab86dc28c71d322d947b3abe1f42c0865ef618a5b3834c959b54eb4c02';
const sha=s=>createHash('sha256').update(s).digest('hex');
const raw=(await readFile(root+'/read-section-23-2.txt','utf8')).replaceAll('\r\n','\n');
const marker=raw.indexOf('…'),prefix=raw.slice(0,raw.lastIndexOf('\n',marker)+1),anchor=prefix.trimEnd().split('\n').slice(-6).join('\n')+'\n';
const bases=[['989',spawnSync('git',['show','989fda7:src/lib/recon-engine.ts'],{encoding:'utf8',maxBuffer:2000000}).stdout],['canonical',await readFile('src/lib/recon-engine.ts','utf8')]];
const results=[];
for(const [basis,source]of bases){
 const body=source.replaceAll('\r\n','\n'),at=body.indexOf(anchor);
 if(at<0||body.indexOf(anchor,at+1)>=0){results.push({basis,exact:false,anchor:false});continue;}
 const text=prefix+body.slice(at+anchor.length);
 const exact=[text,text.replaceAll('\n','\r\n'),text.trimEnd(),text.trimEnd()+'\n',(text.trimEnd()+'\n').replaceAll('\n','\r\n')].find(s=>sha(s)===wanted);
 if(exact)await writeFile(root+'/engine-preimage-EXACT.ts',exact,{flag:'wx'});
 results.push({basis,exact:!!exact,sha256:sha(exact??text),bytes:Buffer.byteLength(exact??text)});
}
await writeFile(root+'/HEAD-TAIL-QUALIFICATION.json',JSON.stringify(results,null,2),{flag:'wx'});
console.log(JSON.stringify(results));
