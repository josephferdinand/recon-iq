import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const candidate='./LOCAL_USER/AppData/Local/Temp/fvi-batch4-candidate-20260928';
const output='output/parent-integrated-next-20261005/core-successors';
const sha=x=>createHash('sha256').update(x).digest('hex');
const plans=[
 {file:'src/components/business-units-tab.tsx',source:'output/access-directory-rebased-acceptance-20261005/business-units-tab.tsx.proposed',pre:'4b2d3dc239b1d628799de072c3e30231c62486e9761e4956ac68aa10d6a39584',post:'bec06f991be103388eb4a42c0e2a0f3a6532e14ece774131ab297760bd962ea5',kind:'27 focused current-actor/read-only cases'},
 {file:'src/lib/recon-engine.ts',source:'output/recon-performance-recovery-20261005/qualified-postimages/src/lib/recon-engine.ts',pre:'523644c6137e5beb91a0ae0eebc616d58b7201f822b3f41eca07ad82f7742647',post:'e8f3015bbb52790eb52a9713b55c26b989458c9767c04fa010ad298e3756b105',kind:'Exact performance proposal coupled to confirmed failure-state caller'},
 {file:'src/lib/recons.functions.ts',source:'output/recon-selected-caller-recovery-20261005/ready-budget-failure/postimages/src/lib/recons.functions.ts',post:'f065284bbaa4dd1cad54403c2061c1568ada5bc045dfd921b59625e5ea63379b',kind:'Exact recovered selected lifecycle and 85 duplicate guards + eight focused failure cases; restoration then successor'}
];
const prepared=[];
for(const p of plans){const target=path.resolve(candidate,p.file);if(!target.startsWith(path.resolve(candidate)+path.sep))throw new Error('Candidate path escape');const before=await readFile(target),after=await readFile(p.source);if(sha(after)!==p.post||(p.pre&&sha(before)!==p.pre))throw new Error('Exact successor pre/post mismatch: '+p.file);prepared.push({...p,target,before,after,preimage:sha(before)});}
await mkdir(output,{recursive:true});
const results=[];
for(const p of prepared){const backup=path.join(output,'before',p.file);await mkdir(path.dirname(backup),{recursive:true});await writeFile(backup,p.before,{flag:'wx'});await writeFile(p.target,p.after);if(sha(await readFile(p.target))!==p.post)throw new Error('Postcopy bytes differ');results.push({file:p.file,preimage:p.preimage,postimage:p.post,source:p.source,basis:p.kind,backup});}
await writeFile(output+'/INTEGRATION.json',JSON.stringify({at:new Date().toISOString(),candidate,results,appUploaded:false,fullHostedAcceptance:false,reconRemaining:'Missing/unreadable source and unconfirmed positive persistence successor assigned to Hooke'},null,2),{flag:'wx'});
console.log(JSON.stringify({integrated:results.length,appUploaded:false,files:results.map(x=>x.file)}));
