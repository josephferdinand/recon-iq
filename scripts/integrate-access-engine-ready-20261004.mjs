import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve('./LOCAL_USER/AppData/Local/Temp/fvi-codex-docs-release-20260930');
const sha=x=>createHash('sha256').update(x).digest('hex');
const manifest=JSON.parse(await readFile('output/access-full-acceptance-20261004/packet/MANIFEST.json','utf8'));
const entries=manifest.sourceFiles.filter(e=>e.kind==='candidate').map(e=>({relative:e.file,pre:e.preimageSha256,post:e.postimageSha256,source:e.proposed}));
entries.push({relative:'src/lib/recon-engine.ts',pre:'4e677bab86dc28c71d322d947b3abe1f42c0865ef618a5b3834c959b54eb4c02',post:'523644c6137e5beb91a0ae0eebc616d58b7201f822b3f41eca07ad82f7742647',source:'./LOCAL_USER/AppData/Local/Temp/fvi-batch4-candidate-20260928/output/recon-engine-business-closure-20261004/postimages/src/lib/recon-engine.ts'});
const prepared=[];
for(const entry of entries){const target=path.resolve(root,entry.relative);if(!target.startsWith(root+path.sep))throw new Error('Bounded source path escaped');const before=await readFile(target),after=await readFile(entry.source);if(sha(after)!==entry.post||![entry.pre,entry.post].includes(sha(before)))throw new Error('Exact ready source conflict:'+entry.relative);prepared.push({...entry,target,before,after});}
const audit=path.join(root,'audit','access-engine-intake-'+Date.now());
await mkdir(audit,{recursive:true});
for(const entry of prepared){const backup=path.join(audit,'preimages',entry.relative);await mkdir(path.dirname(backup),{recursive:true});await writeFile(backup,entry.before,{flag:'wx'});if(sha(entry.before)!==entry.post)await writeFile(entry.target,entry.after);if(sha(await readFile(entry.target))!==entry.post)throw new Error('Exact source intake readback failed');}
await writeFile(path.join(audit,'receipt.json'),JSON.stringify({at:new Date().toISOString(),entries:prepared.map(({relative,pre,post})=>({relative,pre,post})),sourceIntegrated:true,deployed:false,accessSql:'PROD456/latest20261004163000 committed separately',countEditorUiStillOpen:true},null,2),{flag:'wx'});
console.log(JSON.stringify({sourceIntegrated:true,files:prepared.length,receipt:path.join(audit,'receipt.json')}));
