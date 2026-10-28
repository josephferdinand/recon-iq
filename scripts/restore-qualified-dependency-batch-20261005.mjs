import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
const cwd=process.cwd(),target=path.resolve('./LOCAL_USER/AppData/Local/Temp/fvi-batch4-candidate-20260928'),out='output/qualified-dependency-restore-20261005';
const sha=x=>createHash('sha256').update(x).digest('hex'),items=[];
const knowledgeRoot='output/knowledge-deployed-dependencies-recovery-20261005';const k=JSON.parse(await readFile(knowledgeRoot+'/manifest.json','utf8'));
for(const f of k.files)items.push({target:f.path,image:knowledgeRoot+'/recovered/'+f.path,sha256:f.sha256,tier:f.qualification});
const helperRoot='output/release-helpers-recovery-20261005',h=JSON.parse(await readFile(helperRoot+'/recovery-manifest.json','utf8'));
for(const f of h.source_images){if(f.target==='scripts/build-fvi-development-from-protected-files.mjs')continue;items.push({target:f.target,image:f.image,sha256:f.image_sha256,tier:f.status});}
const dh=JSON.parse(await readFile(helperRoot+'/dev-helper-recovered/recovery-manifest.json','utf8'));
for(const f of dh.images)items.push({target:f.target,image:f.image,sha256:f.image_sha256,tier:f.status});
const dpRoot='output/data-prep-executor-recovery-20261005',dp=JSON.parse(await readFile(dpRoot+'/RECOVERY-AND-GUARD-MANIFEST.json','utf8'));
for(const f of dp.recovered)items.push({target:f.path,image:dpRoot+'/recovered-base/'+f.path,sha256:f.sha256,tier:f.content_qualification});
const seen=new Set();
for(const item of items){if(seen.has(item.target))throw new Error('Duplicate restoration target');seen.add(item.target);const dest=path.resolve(target,item.target),image=path.resolve(cwd,item.image);if(!dest.startsWith(target+path.sep)||!image.startsWith(cwd+path.sep)||!(/^(src|scripts|tests)\//.test(item.target)||item.target==='vite.config.ts'))throw new Error('Restoration path boundary');const bytes=await readFile(image);if(sha(bytes)!==item.sha256)throw new Error('Qualified source hash mismatch for '+item.target);item.destination=dest;item.bytes=bytes;}
await mkdir(out+'/before',{recursive:true});const results=[];
for(const item of items){let old=null;try{old=await readFile(item.destination);}catch(e){if(e.code!=='ENOENT')throw e;}if(old&&sha(old)===item.sha256){results.push({...item,bytes:undefined,alreadyExact:true});continue;}if(old){const backup=path.join(out,'before',item.target);await mkdir(path.dirname(backup),{recursive:true});await writeFile(backup,old,{flag:'wx'});}await mkdir(path.dirname(item.destination),{recursive:true});await writeFile(item.destination,item.bytes);if(sha(await readFile(item.destination))!==item.sha256)throw new Error('Restored source drift');results.push({target:item.target,image:item.image,sha256:item.sha256,tier:item.tier,priorSha256:old?sha(old):null,bytes:item.bytes.length});}
const receipt={at:new Date().toISOString(),target,results,canonicalRuntimeModified:false,wholeCandidateQualified:false,applicationDeployed:false,councilIntake:'output/approval-council-20261005/INITIAL-SCOPED-TALLY.json'};await writeFile(out+'/RESTORE-RECEIPT.json',JSON.stringify(receipt,null,2),{flag:'wx'});console.log(JSON.stringify({restored:results.length,alreadyExact:results.filter(x=>x.alreadyExact).length,wholeCandidateQualified:false,receipt:out+'/RESTORE-RECEIPT.json'}));
