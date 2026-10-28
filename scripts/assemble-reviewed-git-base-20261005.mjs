import {readFile,writeFile,mkdir,rename,access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {createHash} from 'node:crypto';
const cwd=process.cwd(),candidate=path.resolve('./LOCAL_USER/AppData/Local/Temp/fvi-batch4-candidate-20260928'),out=path.resolve('output/bounded-source-assembly-20261005');
const decision=JSON.parse(await readFile('output/approval-council-20261005/release/DECISION.json','utf8')).sourceAssembly;
if(!decision?.affirmative||decision.disposition!=='GO_BOUNDED_SOURCE_BASELINE_ASSEMBLY'||path.resolve(decision.candidateRoot)!==candidate)throw new Error('Exact scoped assembly decision required');
const sha=x=>createHash('sha256').update(x).digest('hex'),protectedPaths=new Map();
const restored=JSON.parse(await readFile('output/qualified-dependency-restore-20261005/RESTORE-RECEIPT.json','utf8'));
for(const x of restored.results)protectedPaths.set(x.target,x.sha256);
for(const name of ['ENGINE-CANDIDATE-RESTORE.json','UI-CANDIDATE-RESTORE.json','ACCESS-CANDIDATE-RESTORE.json']){const x=JSON.parse(await readFile('output/recon-retained-source-recovery-20261005/'+name,'utf8'));if(x.results)for(const f of x.results)protectedPaths.set(f.file,f.sha256);else protectedPaths.set(path.relative(candidate,x.target).replace(/\\/g,'/'),x.sha256);}
const integrated=JSON.parse(await readFile('output/parent-integrated-next-20261005/data-prep/INTEGRATION.json','utf8'));for(const x of integrated.records)protectedPaths.set(x.file,x.postimage);
for(const [rel,expected]of protectedPaths){const file=path.resolve(candidate,rel);if(!file.startsWith(candidate+path.sep)||sha(await readFile(file))!==expected)throw new Error('Qualified overlay drift: '+rel);}
const plans=[];
for(const item of decision.exactEligibleScope){const target=path.resolve(candidate,item.path),backup=path.resolve(out,'before',item.path),quarantine=path.resolve(out,'quarantine',item.path);if(!target.startsWith(candidate+path.sep)||!backup.startsWith(out+path.sep)||!quarantine.startsWith(out+path.sep))throw new Error('Verified absolute path boundary');if(protectedPaths.has(item.path)){plans.push({...item,skip:true});continue;}const current=await readFile(target);
 const original=spawnSync('git',['cat-file','blob',item.headBlob],{maxBuffer:2000000});if(original.status!==0)throw new Error('Exact retained HEAD blob unavailable');const variants=[original.stdout,Buffer.from(original.stdout.toString('utf8').replace(/\r?\n/g,'\r\n'))];if(!variants.some(b=>sha(b)===sha(current)))throw new Error('Unrelated candidate source drift: '+item.path);
 let base=null;if(item.baseBlob){const r=spawnSync('git',['cat-file','blob',item.baseBlob],{maxBuffer:2000000});if(r.status!==0)throw new Error('Exact reviewed base blob unavailable');base=r.stdout;}
 plans.push({...item,target,backup,quarantine,current,base});
}
await mkdir(out,{recursive:true});const results=[];
for(const p of plans){if(p.skip){results.push({path:p.path,action:'QUALIFIED_OVERLAY_PRESERVED',sha256:protectedPaths.get(p.path)});continue;}if(p.base){await mkdir(path.dirname(p.backup),{recursive:true});await writeFile(p.backup,p.current,{flag:'wx'});await writeFile(p.target,p.base);if(sha(await readFile(p.target))!==sha(p.base))throw new Error('Base restore drift');results.push({path:p.path,action:'REVIEWED_989_BASE_RESTORED',baseBlob:p.baseBlob,preSha256:sha(p.current),postSha256:sha(p.base),backup:p.backup});}else{await mkdir(path.dirname(p.quarantine),{recursive:true});try{await access(p.quarantine);throw new Error('Quarantine target already exists');}catch(e){if(e.code!=='ENOENT')throw e;}await rename(p.target,p.quarantine);results.push({path:p.path,action:'UNREVIEWED_HEAD_ONLY_QUARANTINED',preSha256:sha(p.current),quarantine:p.quarantine});}}
for(const [rel,expected]of protectedPaths)if(sha(await readFile(path.join(candidate,rel)))!==expected)throw new Error('Qualified overlay changed after assembly');
const receipt={at:new Date().toISOString(),candidate,baseCommit:decision.baseCommit,results,qualifiedOverlaysPreserved:protectedPaths.size,canonicalRuntimeModified:false,wholeCurrentReleaseQualified:false,applicationUploaded:false};await writeFile(out+'/ASSEMBLY-RECEIPT.json',JSON.stringify(receipt,null,2),{flag:'wx'});console.log(JSON.stringify({restored:results.filter(x=>x.action==='REVIEWED_989_BASE_RESTORED').length,quarantined:results.filter(x=>x.action==='UNREVIEWED_HEAD_ONLY_QUARANTINED').length,qualifiedOverlaysPreserved:protectedPaths.size,wholeCurrentReleaseQualified:false,receipt:out+'/ASSEMBLY-RECEIPT.json'}));
