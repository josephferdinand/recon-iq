// Package only this lane's source/proof artifacts; no global release packet.
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,readdirSync,statSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const packet='docs/handover/returns/2026-10-03-curie-recon-read-packet';
const pre=JSON.parse(readFileSync(`${packet}/preimages.json`));
const files=[...Object.keys(pre),
 'supabase/migrations/20261003153000_public_reconciliation_run_read.sql',
 'scripts/public-recon-read-catalog-request-20261003.sql','scripts/capture-public-recon-read-supplement-20261003.mjs',
 'scripts/public-recon-read-current-guard-20261003.sql','scripts/public-recon-read-dependency-guard-20261003.sql',
 'scripts/check-public-recon-read-current-guards-20261003.mjs','scripts/prepare-public-recon-read-forward-20261003.mjs',
 'scripts/public-recon-read-token-forward.inc.sql','scripts/public-recon-read-port-forward.inc.sql',
 'scripts/public-recon-read-concurrency-20261003.mjs','scripts/public-recon-read-fixture-diff-20261003.mjs',
 'scripts/package-public-recon-read-return-20261003.mjs',
 'scripts/public-recon-token-assurance-catalog-request-20261003.sql','scripts/capture-public-recon-token-assurance-20261003.mjs',
 'tests/public-recon-token-assurance-qualification.mjs','scripts/public-recon-read-owned-qa-driver-20261003.mjs',
 'docs/handover/returns/2026-10-03-curie-token-MFA-PROOF.md',
 'tests/public-recon-read-native-qualification.mjs','tests/sql/public-recon-read-regression.sql','tests/public-recon-token-issuance.spec.ts',
 'docs/handover/returns/2026-10-03-curie-token-CONTRACT.md','docs/handover/returns/2026-10-03-curie-recon-read-RETURN.md'];
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
const entries=[],patches=[];
for(const file of files){
 const destination=`${packet}/postimages/${file}`;mkdirSync(dirname(destination),{recursive:true});copyFileSync(file,destination);
 entries.push({path:file,preimageSha256:pre[file]??null,postimageSha256:hash(file)});
 const original=pre[file]?`${packet}/preimages/${file}`:'NUL';
 const diff=spawnSync('git',['diff','--no-index','--no-ext-diff','--src-prefix=a/','--dst-prefix=b/',original,file],{encoding:'utf8',maxBuffer:4*1024*1024});
 if(![0,1].includes(diff.status))throw Error('Patch generation failed');
 let patch=diff.stdout;if(pre[file])patch=patch.replaceAll(`${packet}/preimages/${file}`,file);
 // Replace the Windows null path marker with the portable addition marker.
 patch=patch.replace(/^--- a\/NUL$/gmu,'--- /dev/null');patches.push(patch);
}
writeFileSync(`${packet}/incremental.patch`,patches.join('\n'));
const evidence=[];for(const env of ['PROD','DEV']){
 const root=`${packet}/native-${env}`;
 for(const name of readdirSync(root))if(statSync(join(root,name)).isFile())evidence.push({path:join(root,name).replaceAll('\\','/'),sha256:hash(join(root,name))});
 const r=JSON.parse(readFileSync(`${root}/receipt.json`));if(r.status!=='PASS'||r.migrationSha256!==hash(files.find(f=>f.startsWith('supabase/'))))throw Error('Native receipt is not final migration');
}
for(const file of [`${packet}/focused-tests.log`])evidence.push({path:file,sha256:hash(file)});
for(const env of ['PROD','DEV'])for(const name of readdirSync(`${packet}/assurance-${env}`)){
 const file=`${packet}/assurance-${env}/${name}`;if(statSync(file).isFile())evidence.push({path:file,sha256:hash(file)});
}
evidence.push({path:`${packet}/token-assurance-summary.json`,sha256:hash(`${packet}/token-assurance-summary.json`)});
const routeDependencies=['src/routes/api/v1/$tenantSlug/recons/$reconId/runs/history.ts','src/routes/api/v1/$tenantSlug/recons/$reconId/runs/$runId/results.ts'].map(path=>({path,sha256:hash(path),changedByCurie:false}));
writeFileSync(`${packet}/manifest.json`,JSON.stringify({at:new Date().toISOString(),scope:'Curie bounded source/native qualification only; no hosted apply/deploy',source:entries,routeDependencies,evidence,patchSha256:hash(`${packet}/incremental.patch`),migrationSha256:hash('supabase/migrations/20261003153000_public_reconciliation_run_read.sql'),privateMetadataRoot:'./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925',privateReadOnlyReceipt:'FVI-RECON-READ-CURRENT-GUARDS-20261003.json'},null,2));
console.log(JSON.stringify({packet,sourceFiles:entries.length,evidenceFiles:evidence.length,manifestSha256:hash(`${packet}/manifest.json`),migrationSha256:hash('supabase/migrations/20261003153000_public_reconciliation_run_read.sql')}));
