import{readFile,writeFile,mkdir}from'node:fs/promises';
import{createHash}from'node:crypto';
import path from'node:path';
const root='output/approval-council-20261005/security/published-reference-source-recovery',out='output/parent-integrated-next-20261005/published-reference',candidate=path.resolve('./LOCAL_USER/AppData/Local/Temp/fvi-batch4-candidate-20260928');
const manifest=JSON.parse(await readFile(root+'/RECOVERY-MANIFEST.json','utf8')),sha=x=>createHash('sha256').update(x).digest('hex');
const plans=manifest.primaryReferenceFiles.map(x=>({file:x.path,source:root+'/postimages/'+x.path,pre:x.candidatePreimageSha256,post:x.postimageSha256}));
plans.push({file:manifest.auxiliaryAtomicDependency.path,source:root+'/'+manifest.auxiliaryAtomicDependency.proposal,pre:null,post:manifest.auxiliaryAtomicDependency.sha256});
plans.push({file:manifest.route.path,source:root+'/route-postimages/'+manifest.route.path,pre:manifest.route.preimageSha256,post:manifest.route.postimageSha256});
const ready=[];
for(const p of plans){const target=path.resolve(candidate,p.file);if(!target.startsWith(candidate+path.sep))throw Error('Candidate path boundary');let before=null;try{before=await readFile(target);}catch(error){if(error.code!=='ENOENT')throw error;}if((before?sha(before):null)!==p.pre)throw Error('Exact current Reference preimage/absence drift: '+p.file);const after=await readFile(p.source);if(sha(after)!==p.post)throw Error('Frozen Reference postimage drift');ready.push({...p,target,before,after});}
await mkdir(out,{recursive:true});
const results=[];
for(const p of ready){if(p.before){const file=path.join(out,'before',p.file);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,p.before,{flag:'wx'});}await mkdir(path.dirname(p.target),{recursive:true});await writeFile(p.target,p.after);if(sha(await readFile(p.target))!==p.post)throw Error('Reference postcopy mismatch');results.push({file:p.file,pre:p.pre,post:p.post,source:p.source});}
await writeFile(out+'/INTEGRATION.json',JSON.stringify({at:new Date().toISOString(),results,sourceChain:root+'/SOURCE-CHAIN.json',original42And17And35And19Reused:true,routeOnlyReferenceAdmission:true,SQLReapplied:false,compilerPass:false,appUploaded:false,fullDeployedPerFileManifestRecovered:false},null,2),{flag:'wx'});
console.log(JSON.stringify({integrated:results.length,coupledAtomicRecoveryIncluded:true,currentWorkspaceUnrelatedBytesPreserved:true,SQLReapplied:false,appUploaded:false}));
