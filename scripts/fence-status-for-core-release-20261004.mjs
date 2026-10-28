import {readFile,writeFile,mkdir,unlink,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const phase=process.argv[2],root=path.resolve('./LOCAL_USER/AppData/Local/Temp/fvi-codex-docs-release-20260930');
if(!['hold','restore'].includes(phase))throw new Error('Explicit hold or restore required');
const intake=path.join(root,'audit/status-next-intake-1791125713155');
const state=JSON.parse(await readFile(path.join(intake,'receipt.json'),'utf8'));
const audit=path.join(root,'audit/core-group1-status-fence-20261004');
const sha=value=>createHash('sha256').update(value).digest('hex');
function child(base,relative){const file=path.resolve(base,relative);if(!file.startsWith(path.resolve(base)+path.sep))throw new Error('Bounded file path escaped');return file;}
async function existing(file){try{const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Regular owned file required');return await readFile(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function exclusive(file,bytes){await mkdir(path.dirname(file),{recursive:true});try{await writeFile(file,bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST'||sha(await readFile(file))!==sha(bytes))throw e;}}
await mkdir(audit,{recursive:true});
const prepared=[];
for(const entry of state.files){
 const target=child(root,entry.relative),saved=child(path.join(audit,'postimages'),entry.relative);
 const current=await existing(target),currentSha=current===null?null:sha(current);
 const pre=entry.beforeSha===null?null:await readFile(child(path.join(intake,'preimages'),entry.relative));
 if(pre!==null&&sha(pre)!==entry.beforeSha)throw new Error('Frozen status preimage changed');
 let post=await existing(saved);
 if(post===null){if(currentSha!==entry.afterSha)throw new Error('Status postimage unavailable');post=current;}
 if(sha(post)!==entry.afterSha||![entry.beforeSha,entry.afterSha].includes(currentSha))throw new Error('Status source conflict; do not overwrite');
 prepared.push({...entry,target,saved,currentSha,pre,post});
}
for(const entry of prepared){
 await exclusive(entry.saved,entry.post);
 if(phase==='hold'){
  if(entry.beforeSha===null){if(entry.currentSha!==null)await unlink(entry.target);}
  else if(entry.currentSha!==entry.beforeSha)await writeFile(entry.target,entry.pre);
 }else if(entry.currentSha!==entry.afterSha){await mkdir(path.dirname(entry.target),{recursive:true});await writeFile(entry.target,entry.post);}
 const actual=await existing(entry.target),actualSha=actual===null?null:sha(actual);
 if(actualSha!==(phase==='hold'?entry.beforeSha:entry.afterSha))throw new Error('Exact source fence readback failed');
}
const receipt={at:new Date().toISOString(),phase,statusFilesPreserved:prepared.length,files:prepared.map(({relative,beforeSha,afterSha})=>({relative,beforeSha,afterSha})),noProductScopeDropped:true,ownerStatusLaneContinues:true};
await writeFile(path.join(audit,`${phase}-receipt-${Date.now()}.json`),JSON.stringify(receipt,null,2),{flag:'wx'});
console.log(JSON.stringify({phase,files:prepared.length,exactReadback:true,audit}));
