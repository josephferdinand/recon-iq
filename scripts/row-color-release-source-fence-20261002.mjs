import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const packet='./LOCAL_USER/AppData/Local/Temp/fvi-codex-docs-release-20260930';
const audit='./LOCAL_USER/AppData/Local/Temp/fvi-codex-audit-20260930-4746723';
const stash=audit+'/row-color-next-workflow-preserved-20261002';
const receipt=stash+'/receipt.json';
const sha=b=>createHash('sha256').update(b).digest('hex');
const baseline=JSON.parse(await readFile(packet+'/reviewed-artifact-manifest-20261001-77f15362.json','utf8'));
if(baseline.deployment_prefix!=='77f15362'||baseline.source.length!==975)throw Error('Reviewed source baseline absent');
const map=new Map(baseline.source.map(f=>[f.path,f.sha256]));
const sources=new Map([
 ...['components/tickets-tab.tsx','lib/tickets.functions.ts','components/navigator-hub.tsx','components/kb-tab.tsx','lib/kb.functions.ts','lib/kb-reader.functions.ts'].map(p=>[p,audit+'/tickets-next-preimages-20261002/src/'+p]),
 ...['components/audit-tab.tsx','lib/tenants.functions.ts'].map(p=>[p,audit+'/audit-attribution-next-preimages-20261002/src/'+p]),
 ...['components/manual-match-approvals-tab.tsx','lib/manual-match-approvals.functions.ts','components/ageing-eod-tabs.tsx'].map(p=>[p,'./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925/BOYLE-REBASE-ACTUAL-RELEASE-20261002/preimage/src/'+p]),
]);
const sourcePath=rel=>{const dest=path.resolve(packet,'src',rel);if(!dest.startsWith(path.resolve(packet,'src')+path.sep))throw Error('Source path escaped packet');return dest;};
async function verifyColorOnly(){const differences=[];for(const [rel,hash]of map){const bytes=await readFile(sourcePath(rel));if(sha(bytes)!==hash)differences.push(rel);}if(differences.some(p=>p!=='styles.css'))throw Error('Non-color source still differs: '+differences.join(','));console.log(JSON.stringify({baseline:'77f15362',verified_source_files:map.size,only_changed_source:differences}));}
const phase=process.argv[2];
if(phase==='prepare'){
 let previous;try{previous=JSON.parse(await readFile(receipt,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 if(previous)throw Error('Preservation receipt already exists; inspect before another prepare');
 const records=[];
 for(const [rel,file]of sources){const [old,current]=await Promise.all([readFile(file),readFile(sourcePath(rel))]);if(sha(old)!==map.get(rel))throw Error('Preimage not last deployed source: '+rel);records.push({path:rel,baseline_sha256:sha(old),pending_sha256:sha(current),old,current});}
 for(const [rel,hash]of map){const b=await readFile(sourcePath(rel));if(sha(b)!==hash&&!sources.has(rel)&&rel!=='styles.css')throw Error('Unowned pending source: '+rel);}
 await mkdir(stash,{recursive:true});
 for(const r of records){const file=path.join(stash,'src',r.path);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,r.current,{flag:'wx'});if(sha(await readFile(file))!==r.pending_sha256)throw Error('Preservation verification failed');}
 const state={at:new Date().toISOString(),phase:'preserved-before-temporary-baseline-copy',baseline:'77f15362',files:records.map(({old,current,...r})=>r)};
 await writeFile(receipt,JSON.stringify(state,null,2),{flag:'wx'});
 for(const r of records)await writeFile(sourcePath(r.path),r.old);
 state.phase='color-only-build-prepared';await writeFile(receipt,JSON.stringify(state,null,2));await verifyColorOnly();
 console.log(JSON.stringify({preserved_pending_files:records.length,receipt}));
}else if(phase==='verify')await verifyColorOnly();
else if(phase==='restore'){
 const state=JSON.parse(await readFile(receipt,'utf8'));if(state.phase!=='color-only-build-prepared')throw Error('Expected preservation state absent');
 const items=[];for(const r of state.files){const [cur,saved]=await Promise.all([readFile(sourcePath(r.path)),readFile(path.join(stash,'src',r.path))]);if(sha(cur)!==r.baseline_sha256||sha(saved)!==r.pending_sha256)throw Error('Source drift before pending restore: '+r.path);items.push({r,saved});}
 for(const {r,saved}of items)await writeFile(sourcePath(r.path),saved);
 for(const {r}of items)if(sha(await readFile(sourcePath(r.path)))!==r.pending_sha256)throw Error('Pending work restore mismatch');
 state.phase='pending-workflow-restored';state.restored_at=new Date().toISOString();await writeFile(receipt,JSON.stringify(state,null,2));console.log(JSON.stringify({pending_files_restored:items.length,css_correction_preserved:true,receipt}));
}else throw Error('Explicit prepare/verify/restore required');
