import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const candidate='./LOCAL_USER/AppData/Local/Temp/fvi-batch4-candidate-20260928';
const canonical='./LOCAL_USER/OneDrive - 8gsp1y/Documents/ChatGPT/ReconIQ';
const packet='./LOCAL_USER/AppData/Local/Temp/fvi-codex-docs-release-20260930';
const privateRoot='./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925';
const reportRoot=candidate+'/output/hilbert-report-current-qualified-20261003-v2';
const referenceRoot=canonical+'/scripts/qa/output/reference-metadata-contract-20261003/combined-20261003180000';
const sha=s=>createHash('sha256').update(s).digest('hex');
const quote=s=>`'${s.replaceAll("'","''")}'`;
const reportManifest=JSON.parse(await readFile(reportRoot+'/current-guarded-packet-manifest.json','utf8'));
const homeManifest=JSON.parse(await readFile(candidate+'/output/home-team-p1-20261003/READY.json','utf8'));
const referenceManifest=JSON.parse(await readFile(referenceRoot+'/RESERVATION_AND_GUARD_RECEIPT.json','utf8'));
const sources=[];
for(const [version,name,path,expected] of [
 ['20261003010000','report_design_scheduler',reportManifest.source_path,reportManifest.source_sha256],
 ['20261003160000','workspace_dashboard_team_metrics',packet+'/'+homeManifest.sql.path,homeManifest.sql.sha256],
 ['20261003180000','reference_table_view_summary',referenceManifest.sourcePath,referenceManifest.sourceSHA256],
]){const source=await readFile(path,'utf8');if(sha(source)!==expected)throw Error('Source drift: '+version);sources.push({version,name,path,source,sha256:expected});}
function split(raw,source){const body=source.replace(/^\s*BEGIN;\s*$/m,'').replace(/^\s*COMMIT;\s*$/m,'').trim();const i=raw.indexOf(body);if(i<0)throw Error('Exact source body absent');const prefix=raw.slice(0,i);if((prefix.match(/^BEGIN;\s*$/gm)||[]).length!==1)throw Error('Unexpected prefix transaction');return {prefix:prefix.replace(/^BEGIN;\s*$/m,''),body,suffix:raw.slice(i+body.length)};}
for(const [environment,ref,count] of [['PROD','YOUR_PROJECT_REF',448],['DEV','YOUR_PROJECT_REF',426]]){
 const r=reportManifest.targets.find(x=>x.environment===environment),h=homeManifest.native.find(x=>x.environment===environment),v=referenceManifest.liveGuards.find(x=>x.environment===environment);
 if(r.project_ref!==ref||r.ledger_before!==count||v.ref!==ref||v.count!==count)throw Error('Qualified target mismatch');
 const reportSql=await readFile(reportRoot+'/'+r.packets.find(x=>x.mode==='apply').path,'utf8');
 const homeSql=await readFile(candidate+'/output/home-team-p1-20261003/native-'+environment+'/guarded-apply.sql','utf8');
 const referenceGuard=await readFile(v.guardPath,'utf8'),referenceBody=await readFile(referenceManifest.mutationPath,'utf8');
 if(sha(reportSql)!==r.packets.find(x=>x.mode==='apply').sha256||sha(homeSql)!==h.applySha256||sha(referenceGuard)!==v.guardSHA256||sha(referenceBody)!==referenceManifest.mutationSHA256)throw Error('Qualified fragment drift');
 const rf=split(reportSql,sources[0].source),hf=split(homeSql,sources[1].source);
 const registerIndex=rf.suffix.indexOf('INSERT INTO supabase_migrations.schema_migrations(version,name,statements)');
 if(registerIndex<0||!hf.suffix.trim().startsWith('INSERT INTO supabase_migrations.schema_migrations'))throw Error('Registration boundary changed');
 const profile=rf.suffix.match(/DO \$profile\$ BEGIN[\s\S]*?END \$profile\$;/g);
 if(profile?.length!==1)throw Error('Exact original catalog preimage check absent or ambiguous');
 const precisionProof=JSON.parse(await readFile(privateRoot+'/FVI-REPORTS-LOSSLESS-QUALIFICATION-'+environment+'-20261004.json','utf8'));
 if(precisionProof.environment!==environment||precisionProof.frozenEnvelopeSHA256!==r.full_capture_sha256||precisionProof.frozenCatalogSHA256!==r.catalog_sha256||precisionProof.allOtherFieldsIdentical!==true||precisionProof.changes.length!==4||!precisionProof.changes.every(c=>/^catalog\/sequences\/\d+\/maximum$/.test(c.path)&&c.expected==='9223372036854776000'&&c.actual==='9223372036854775807')||sha(precisionProof.losslessCatalogText)!==precisionProof.losslessCatalogSHA256)throw Error('Exact field-only lossless capture correction unproven');
 if(profile[0].split(r.catalog_sha256).length!==2)throw Error('Catalog digest correction is ambiguous');
 const correctedProfile=profile[0].replace(r.catalog_sha256,precisionProof.losslessCatalogSHA256);
 if(rf.prefix.split(r.catalog_sha256).length!==2)throw Error('Original early catalog guard absent or ambiguous');
 const correctedPrefix=rf.prefix.replace(r.catalog_sha256,precisionProof.losslessCatalogSHA256);
 const plannedPost=JSON.parse(await readFile(privateRoot+'/FVI-REPORTS-PLANNED-POSTCATALOG-'+environment+'-20261004.json','utf8'));
 if(plannedPost.environment!==environment||plannedPost.preCatalogSHA256!==precisionProof.losslessCatalogSHA256||plannedPost.expectedHomeSourceSHA256!==sources[1].sha256||plannedPost.allOtherCatalogFieldsIdentical!==true||plannedPost.addedIndex.name!=='recon_exceptions_home_team_run_idx'||!sources[1].source.includes('CREATE INDEX recon_exceptions_home_team_run_idx')||sha(plannedPost.postCatalogText)!==plannedPost.postCatalogSHA256)throw Error('Exact reviewed Home index postcondition unproven');
 const plannedPostProfile=correctedProfile.replace(precisionProof.losslessCatalogSHA256,plannedPost.postCatalogSHA256);
 // Every captured dependency/ledger/namespace preimage is checked before any source mutation.
 // Standalone postchecks that assume one newly registered version are replaced by exact three-source checks below.
 let sql=`BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='90s'; SET LOCAL app.fvi_target_project_ref=${quote(ref)};\n`;
 sql+='\n-- Exact report preimages and old-row/ledger preservation snapshots; lossless bigint capture correction\n'+correctedPrefix;
 sql+='\n-- Exact Home preimages\n'+hf.prefix;
 sql+='\n-- Exact Reference preimages\n'+referenceGuard;
 sql+='\n-- Qualified report source\n'+rf.body+'\n-- Qualified Home source\n'+hf.body+'\n-- Qualified Reference mutation (preimages already fenced above)\n'+referenceBody;
 sql+='\n-- Exact postcatalog includes only reviewed Home index addition; every old metadata field retained\nSET LOCAL search_path=pg_catalog,public,extensions;\n'+rf.suffix.slice(0,registerIndex).replace(profile[0],plannedPostProfile);
 for(const s of sources)sql+=`\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${quote(s.version)},${quote(s.name)},ARRAY[${quote(s.source)}]::text[]);\n`;
 sql+=`DO $combined_registration$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>${count+3}
 OR (SELECT max(version::text) FROM supabase_migrations.schema_migrations)<>'20261003180000'
 OR (SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(m) ORDER BY version)::text,'UTF8')),'hex') FROM supabase_migrations.schema_migrations m WHERE version NOT IN (${sources.map(s=>quote(s.version)).join(',')})) IS DISTINCT FROM (SELECT sha FROM _hilbert_report_oldledger)
 ${sources.map(s=>`OR (SELECT encode(sha256(convert_to(statements[1],'UTF8')),'hex') FROM supabase_migrations.schema_migrations WHERE version=${quote(s.version)}) IS DISTINCT FROM ${quote(s.sha256)}`).join('\n')}
 THEN RAISE EXCEPTION 'Combined exact registration or historical ledger preservation failed'; END IF;
 END $combined_registration$;
 NOTIFY pgrst,'reload schema';\n`;
 const base=privateRoot+'/FVI-HOME-REFERENCE-REPORTS-'+environment+'-20261004-v5';
 for(const [phase,end]of [['DRY-RUN','ROLLBACK;\n'],['APPLY','COMMIT;\n']])await writeFile(base+'-'+phase+'.sql',sql+end,{flag:'wx'});
 const manifest={at:new Date().toISOString(),environment,ref,initialLedger:count,initialLatest:'20261002133100',expectedLedger:count+3,expectedLatest:'20261003180000',sourceOnlyPrepared:true,allGuardsBeforeMutation:true,preservationTables:46,catalogGuardCorrection:{originalSha256:sha(profile[0]),correctedPreSha256:sha(correctedProfile),correctedPostSha256:sha(plannedPostProfile),bothOriginalPreAndPostChecksRetained:true,losslessCatalogSHA256:precisionProof.losslessCatalogSHA256,plannedPostCatalogSHA256:plannedPost.postCatalogSHA256,reviewedIndexAddition:plannedPost.addedIndex,allOldExpectedFieldsUnchanged:true,correctedFields:precisionProof.changes,reason:'Four rounded impossible bigint maxima corrected; exact postcatalog includes reviewed Home performance index, old metadata/rows/ledger preserved'},dryRunSha256:sha(sql+'ROLLBACK;\n'),applySha256:sha(sql+'COMMIT;\n'),sources:sources.map(({source,...s})=>s),fragments:{reportSha256:sha(reportSql),homeSha256:sha(homeSql),referenceGuardSha256:sha(referenceGuard),referenceMutationSha256:sha(referenceBody)}};
 await writeFile(base+'-PREPARED.json',JSON.stringify(manifest,null,2),{flag:'wx'});
 console.log(JSON.stringify({environment,initialLedger:count,expectedLedger:count+3,bytes:sql.length,migrations:3,prepared:base+'-PREPARED.json',dryRunSha256:manifest.dryRunSha256}));
}
