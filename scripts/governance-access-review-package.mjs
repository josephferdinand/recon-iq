// Emit an incremental leased patch against the actual bounded packet; never copy
// product files into that packet or overwrite a different agent's source.
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const repo=resolve(import.meta.dirname,'..');
const bounded='./LOCAL_USER/AppData/Local/Temp/fvi-codex-docs-release-20260930';
const output=mkdtempSync(join(tmpdir(),'fvi-governance-access-review-return-'));
const sha=x=>createHash('sha256').update(x).digest('hex');
const files=[
 'src/lib/governance-access-review.functions.ts',
 'supabase/migrations/20261002133100_governance_access_review_decisions.sql',
 'tests/governance-access-review.spec.ts',
 'scripts/governance-access-review-qualify.mjs',
 'scripts/governance-access-review-catalog-request.sql',
 'scripts/governance-access-review-package.mjs',
 'docs/handover/returns/2026-10-02-HARVEY-GOVERNANCE-ACCESS-REVIEW-RETURN.md',
];
let patch='';const manifest=[];
for(const relative of files) {
 const source=join(repo,relative);const baseline=join(bounded,relative);const bytes=readFileSync(source);
 const before=existsSync(baseline)?readFileSync(baseline):null;
 manifest.push({path:relative,preimage:before?sha(before):'ABSENT',sha256:sha(bytes),bytes:bytes.length});
 if(before&&sha(before)===sha(bytes))continue;
 if(!before){
   const lines=bytes.toString('utf8').replace(/\r\n/g,'\n').replace(/\n$/,'').split('\n');
   patch+=`diff --git a/${relative} b/${relative}\nnew file mode 100644\n--- /dev/null\n+++ b/${relative}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(x=>'+'+x).join('\n')}\n`;
 }else{
   const r=spawnSync('git',['diff','--no-index','--',baseline,source],{encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});
   if(r.error||![0,1].includes(r.status))throw Error('Leased incremental diff failed');
   patch+=r.stdout.split('\n').map(line=>line.startsWith('diff --git ')?`diff --git a/${relative} b/${relative}`:line.startsWith('--- ')?`--- a/${relative}`:line.startsWith('+++ ')?`+++ b/${relative}`:line).join('\n');
 }
}
const patchPath=join(output,'HARVEY-governance-access-review.patch');writeFileSync(patchPath,patch);
const manifestPath=join(output,'manifest.json');writeFileSync(manifestPath,JSON.stringify({created_at:new Date().toISOString(),owner:'Harvey — Access-review backend',canonical:repo,bounded,patchPath,patchSha256:sha(patch),files:manifest,hostedWrites:false},null,2));
console.log(JSON.stringify({patchPath,manifestPath,patchSha256:sha(patch),files:files.length}));
