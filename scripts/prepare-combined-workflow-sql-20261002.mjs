import {readFile,writeFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
const packet='./LOCAL_USER/AppData/Local/Temp/fvi-codex-docs-release-20260930',candidate='./LOCAL_USER/AppData/Local/Temp/fvi-batch4-candidate-20260928',privateRoot='./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925',canonical='./LOCAL_USER/OneDrive - 8gsp1y/Documents/ChatGPT/ReconIQ',vaultRoot='E:/Falcon Group Projects/Cloud Data/Secured Key Vault';
const sha=x=>createHash('sha256').update(x).digest('hex'),quote=x=>`'${x.replaceAll("'","''")}'`;
const versions=[
 ['20261002103000','workspace_dashboard_team_scope'],['20261002110000','exception_assignment_workflow'],
 ['20261002113000','exception_lifecycle_atomic'],['20261002113100','exception_nrl_proposal_scoped'],
 ['20261002113200','exception_nrl_draft_apply'],['20261002113300','exception_assignment_disable'],
 ['20261002115000','reference_table_atomic_save'],['20261002120000','tasks_manual_eod_evidence'],
 ['20261002121000','ticket_workflow'],['20261002133000','governance_membership_requests'],
 ['20261002133100','governance_access_review_decisions'],
];
const sources=[];
for(const [version,name]of versions){
 const dir=await import('node:fs/promises').then(m=>m.readdir(packet+'/supabase/migrations'));
 let file=dir.find(f=>f.startsWith(version+'_')&&f.endsWith('.sql'));
 let source;
 for(const base of [packet,canonical,candidate]){const files=await import('node:fs/promises').then(m=>m.readdir(base+'/supabase/migrations'));const found=files.find(f=>f.startsWith(version+'_')&&f.endsWith('.sql'));if(found){file=found;source=await readFile(base+'/supabase/migrations/'+file,'utf8');break;}}
 if(!file||source===undefined)throw Error('Qualified migration missing: '+version);
 sources.push({version,name,file,source,sha256:sha(source)});
}
function unwrap(source){
 const beginCount=(source.match(/^BEGIN;[ \t]*\r?$/gmu)||[]).length,commitCount=(source.match(/^COMMIT;[ \t]*\r?$/gmu)||[]).length;
 if(beginCount!==commitCount||beginCount>1)throw Error('Unexpected transaction boundary count');
 if(!beginCount)return source;
 return source.replace(/^BEGIN;[ \t]*\r?\n?/mu,'').replace(/^COMMIT;[ \t]*\r?\n?/mu,'');
}
for(const [environment,ref,count]of [['PROD','YOUR_PROJECT_REF',437],['DEV','YOUR_PROJECT_REF',415]]){
 const captured=JSON.parse(await readFile(`${privateRoot}/FVI-GOVERNANCE-CATALOG-${environment}-EXTENDED-20261002.json`,'utf8'));
 const query=captured.query.trim().replace(/;$/u,'');if(captured.ref!==ref||Number(captured.rows[0].catalog.ledger.count)!==count)throw Error('Governance target capture changed');
 const guard=`DO $gov_parent_preimage$ DECLARE observed jsonb; BEGIN SELECT catalog INTO observed FROM (${query}) captured; IF observed IS DISTINCT FROM ${quote(JSON.stringify(captured.rows[0].catalog))}::jsonb THEN RAISE EXCEPTION 'Combined governance exact current metadata preimage drift'; END IF; END $gov_parent_preimage$;`;
 const fragments=[
 [`home`,`${candidate}/tests/sql/workspace-dashboard-team-scope-103000-guarded.sql`],
 [`exceptions`,`${vaultRoot}/FVI-${environment}-LIFECYCLE-GUARDED-FORWARD-20261002.sql`],
 [`reference`,`${candidate}/output/playwright/reference-atomic-save-pg16-20261002/${environment}-reference-atomic-save-guarded.sql`],
 [`manual-eod`,`${privateRoot}/BOYLE-${environment}-TASKS-GUARDED-PROPOSAL-20261002.sql`],
 [`tickets`,`${canonical}/scripts/qa/output/FVI_PRODUCTION_RECON_DATAPREP_FULL_QA_2026-10-01/READY_Volta_TICKETS_121000_GUARDED_${environment}_20261002.sql`],
 [`membership`,`${packet}/supabase/migrations/20261002133000_governance_membership_requests.sql`],
 [`access-review`,`${packet}/supabase/migrations/20261002133100_governance_access_review_decisions.sql`],
 ];
 let sql=`BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='90s'; SET LOCAL app.fvi_target_project_ref=${quote(ref)};\nDO $ledger$ BEGIN IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>${count} OR (SELECT max(version::text) FROM supabase_migrations.schema_migrations)<>'20261002104000' THEN RAISE EXCEPTION 'Combined initial ledger drift'; END IF; END $ledger$;\n${guard}\n`;
 const fragmentManifest=[];
 for(const [label,file]of fragments){
  const original=await readFile(file,'utf8');let s=original,contextFix=null;
  if(label==='manual-eod'){
   const proof=JSON.parse(await readFile(privateRoot+'/FVI-MANUAL-DEFAULT-DEPARSE-PROBE-20261002.json','utf8'));
   const paths=proof.result;if(!proof.read_only||paths.length!==3||!paths.every(p=>p.rows[0].builtin_uuid_oid_3432===true)||paths[0].rows[0].default_expr!=='pg_catalog.gen_random_uuid()'||paths[1].rows[0].default_expr!=='gen_random_uuid()')throw Error('Actual default OID/deparser context proof absent');
   const old='SET LOCAL search_path=public,extensions,pg_catalog;';if(s.split(old).length!==2)throw Error('Unexpected guard-context boundary');
   s=s.replace(old,'SET LOCAL search_path=public,extensions;');contextFix='Implicit pg_catalog first matches captured metadata; no guard/default/function/ACL changes';
  }
  if(label==='tickets'){
   const old='SET LOCAL search_path = public, extensions, pg_catalog;';if(s.split(old).length!==2)throw Error('Unexpected Ticket guard-context boundary');
   s=s.replace(old,'SET LOCAL search_path = public, extensions;');contextFix='Implicit pg_catalog first preserves original captured metadata fingerprint; exact expected fingerprint unchanged';
  }
  sql+='\n-- Reviewed fragment '+label+'\n'+unwrap(s)+'\n';fragmentManifest.push({label,file,sha256:sha(original),combinedFragmentSha256:sha(s),contextFix});
 }
 sql+='\n'+sources.map(m=>`DO $register_${m.version}$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=${quote(m.version)}) THEN IF (SELECT statements FROM supabase_migrations.schema_migrations WHERE version=${quote(m.version)}) IS DISTINCT FROM ARRAY[${quote(m.source)}]::text[] THEN RAISE EXCEPTION 'Combined ledger registered different source for ${m.version}'; END IF; ELSE INSERT INTO supabase_migrations.schema_migrations(version,statements,name) VALUES(${quote(m.version)},ARRAY[${quote(m.source)}],${quote(m.name)}); END IF; END $register_${m.version}$;`).join('\n')+"\nNOTIFY pgrst,'reload schema';\n";
 const base=`${privateRoot}/FVI-COMBINED-${environment}-WORKFLOW-20261002`;
 await writeFile(base+'-DRY-RUN.sql',sql+'ROLLBACK;\n');await writeFile(base+'-APPLY.sql',sql+'COMMIT;\n');
 await writeFile(base+'-PREPARED.json',JSON.stringify({at:new Date().toISOString(),environment,ref,initialLedger:count,expectedLedger:count+versions.length,expectedLatest:'20261002133100',dryRunSha256:sha(sql+'ROLLBACK;\n'),applySha256:sha(sql+'COMMIT;\n'),fragments:fragmentManifest,migrations:sources.map(({source,...m})=>m),applied:false,requiredGlobalBuildAndPg17DryRun:true},null,2));
 console.log(JSON.stringify({environment,initialLedger:count,expectedLedger:count+versions.length,migrations:versions.length,bytes:sql.length,dryRun:base+'-DRY-RUN.sql',sourceOnlyPrepared:true}));
}
