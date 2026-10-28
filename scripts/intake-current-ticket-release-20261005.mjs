import{readFile,writeFile,mkdir}from'node:fs/promises';
import{createHash}from'node:crypto';
import path from'node:path';
const candidate='./LOCAL_USER/AppData/Local/Temp/fvi-batch4-candidate-20260928';
const root='output/approval-council-20261005/release/ticket-continuity-next';
const out='output/parent-integrated-next-20261005/published-tickets';
const sha=x=>createHash('sha256').update(x).digest('hex');
const manifest=JSON.parse(await readFile(root+'/MANIFEST.json','utf8'));
if(manifest.status!=='SOURCE_READY'||manifest.files.length!==2)throw Error('Complete exact Ticket packet required');
for(const d of [...manifest.coupledDependenciesAlreadyIntegrated,...manifest.directImportBoundaries]){
 const intended=manifest.files.find(f=>f.path===d.path);
 if(intended){if(d.sha256!==intended.postimageSha256)throw Error('Ticket coupled postimage inconsistency');continue;}
 if(sha(await readFile(path.join(candidate,d.path)))!==d.sha256)throw Error('Current Ticket dependency changed: '+d.path);
}
const inputs=[];
for(const f of manifest.files){const current=await readFile(path.join(candidate,f.path)),post=await readFile(f.postimage);if(sha(current)!==f.preimageSha256||sha(post)!==f.postimageSha256)throw Error('Ticket exact pre/post drift');inputs.push({f,current,post});}
await mkdir(out,{recursive:true});
for(const{f,current,post}of inputs){const backup=path.join(out,'preimages',f.path);await mkdir(path.dirname(backup),{recursive:true});await writeFile(backup,current,{flag:'wx'});await writeFile(path.join(candidate,f.path),post);}
await writeFile(out+'/INTEGRATION.json',JSON.stringify({at:new Date().toISOString(),files:manifest.files,coupledDependenciesPreserved:true,retainedTests:15,SQLApplied:false,applicationUploaded:false},null,2),{flag:'wx'});
console.log(JSON.stringify({integrated:2,coupledDependenciesPreserved:true,noSQLReplay:true}));
