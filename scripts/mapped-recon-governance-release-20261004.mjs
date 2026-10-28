import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const phase=process.argv[2],env=process.argv[3];
const refs={PROD:'YOUR_PROJECT_REF',DEV:'YOUR_PROJECT_REF'},ledgers={PROD:452,DEV:430};
if(!refs[env]||!['prepare','dry-run','apply'].includes(phase))throw Error('Explicit phase and FVI target required');
const privateRoot='./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925';
const base=privateRoot+'/FVI-MAPPED-RECON-GOVERNANCE-'+env+'-RELEASE-20261004-v3';
const sourcePath='output/mapped-recon-governance-20261004/20261004080000-mapped-recon-governance.forward.sql';
const version='20261004080000',sha=s=>createHash('sha256').update(s).digest('hex'),quote=s=>"'"+s.replaceAll("'","''")+"'";
const vault=await readFile('./.private/CREDENTIALS.md','utf8');
const a=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->'),b=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->');
if(a<0||b<=a)throw Error('Canonical FVI credential boundary missing');
const token=vault.slice(a,b).split(/\r?\n/).find(x=>/^\|\s*`SUPABASE_ACCESS_TOKEN`\s*\|/.test(x))?.split('|')[2]?.trim().replace(/^`|`$/g,'');
if(!/^sbp_/.test(token??''))throw Error('FVI management credential unavailable');
async function query(sql,readOnly){
 const r=await fetch(`https://api.supabase.com/v1/projects/${refs[env]}/database/query`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({query:sql,read_only:readOnly}),signal:AbortSignal.timeout(110000)});
 const raw=await r.text();if(!r.ok){const file=base+'-'+phase+'-ERROR-'+Date.now()+'.json';await writeFile(file,JSON.stringify({at:new Date().toISOString(),http:r.status,raw},null,2),{flag:'wx'});throw Error('HTTP'+r.status+'; diagnostic retained privately '+file);}
 return {raw,rows:JSON.parse(raw)};
}
const identitySql="SELECT current_setting('server_version_num') AS engine,(SELECT count(*) FROM supabase_migrations.schema_migrations)::int AS ledger,(SELECT max(version::text) FROM supabase_migrations.schema_migrations) AS latest";
if(phase==='prepare'){
 const source=await readFile(sourcePath,'utf8');if(sha(source)!=='52b95886bba07d652c392a543e031dc853d595af6abbb8dded6aefb948380ca6')throw Error('Reviewed corrected source drift');
 const catalogPath=privateRoot+(env==='PROD'?'/FVI-MAPPED-RECON-GOVERNANCE-PROD-CATALOG-2026-10-04T06-30-55-088Z-ASSEMBLER-ENVELOPE.json':'/FVI-MAPPED-RECON-GOVERNANCE-DEV-CATALOG-2026-10-04T06-30-59-241Z-ASSEMBLER-ENVELOPE.json');
 const catalog=JSON.parse(await readFile(catalogPath,'utf8')).catalog;
 const tables=catalog.relations.filter(x=>['r','p'].includes(x.relkind));
 const rpcNames=['request_recon_definition_edit','decide_recon_definition_edit','submit_recon_definition_promotion','decide_recon_definition_promotion'];
 const functions=catalog.helpers.filter(x=>x.schema==='public'&&rpcNames.includes(x.name));if(functions.length!==4)throw Error('Exact four RPC contracts required');
 const before=await query(identitySql,true);if(before.rows[0]?.ledger!==ledgers[env]||before.rows[0]?.latest!=='20261004033000'||before.rows[0]?.engine!=='170006')throw Error('Actual target drift');
 let sql="BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='90s';\n";
 // Run the exact captured catalog guard before any DDL, in its original session context.
 const guardEnd=source.indexOf('END $current$;')+'END $current$;'.length;if(guardEnd<20)throw Error('Exact guard boundary missing');
 sql+=source.slice(0,guardEnd)+'\nLOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;\n';
 sql+="CREATE TEMP TABLE _mapped_oldledger AS SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(m) ORDER BY version)::text,'UTF8')),'hex') AS sha FROM supabase_migrations.schema_migrations m;\n";
 sql+="CREATE TEMP TABLE _mapped_oldrows(schema_name text,table_name text,projection text,row_count bigint,sha text);\n";
 for(const t of tables){
  const columns=catalog.columns.filter(x=>x.schema===t.nspname&&x.table===t.relname).sort((a,b)=>a.position-b.position).map(x=>'"'+x.name.replaceAll('"','""')+'"').join(',');
  if(!columns)throw Error('Original column projection missing');
  const relation='"'+t.nspname.replaceAll('"','""')+'"."'+t.relname.replaceAll('"','""')+'"';
  sql+=`LOCK TABLE ${relation} IN SHARE MODE;\nINSERT INTO _mapped_oldrows SELECT ${quote(t.nspname)},${quote(t.relname)},${quote(columns)},count(*),encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM (SELECT ${columns} FROM ${relation})x;\n`;
 }
 const identities=functions.map(x=>`(n.nspname=${quote(x.schema)} AND p.proname=${quote(x.name)} AND pg_get_function_identity_arguments(p.oid)=${quote(x.identity)})`);
 sql+=`CREATE TEMP TABLE _mapped_oldfunctions AS SELECT p.oid,p.proowner,p.proacl,p.proconfig,p.prosecdef,p.proargnames,p.proargtypes,pg_get_function_result(p.oid) AS result FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE ${identities.join(' OR ')};\nDO $rpc_count$ BEGIN IF (SELECT count(*) FROM _mapped_oldfunctions)<>4 THEN RAISE EXCEPTION 'exact four RPC identity preimages absent'; END IF; END $rpc_count$;\n`;
 sql+=source.slice(guardEnd)+'\n';
 sql+=`DO $preserve$ DECLARE r record;n bigint;v text;BEGIN FOR r IN SELECT * FROM _mapped_oldrows LOOP EXECUTE format('SELECT count(*),encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),''[]''::jsonb)::text,''UTF8'')),''hex'') FROM (SELECT %s FROM %I.%I)x',r.projection,r.schema_name,r.table_name) INTO n,v;IF n IS DISTINCT FROM r.row_count OR v IS DISTINCT FROM r.sha THEN RAISE EXCEPTION 'mapped governance changed historical/identity/business rows';END IF;END LOOP;IF EXISTS(SELECT 1 FROM _mapped_oldfunctions o LEFT JOIN pg_proc p ON p.oid=o.oid WHERE p.oid IS NULL OR ROW(p.proowner,p.proacl,p.proconfig,p.prosecdef,p.proargnames,p.proargtypes,pg_get_function_result(p.oid)) IS DISTINCT FROM ROW(o.proowner,o.proacl,o.proconfig,o.prosecdef,o.proargnames,o.proargtypes,o.result)) THEN RAISE EXCEPTION 'mapped governance changed existing authority/ABI/configuration';END IF;END $preserve$;\n`;
 sql+=`DO $newprivileges$ BEGIN IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='private' AND p.proname LIKE 'mapped_recon_governance_%' AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE') OR has_function_privilege('service_role',p.oid,'EXECUTE'))) THEN RAISE EXCEPTION 'mapped helper execute privilege exposed';END IF;END $newprivileges$;\n`;
 sql+=`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${quote(version)},'mapped_reconciliation_governance',ARRAY[${quote(source)}]::text[]);\nDO $registered$ BEGIN IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>${ledgers[env]+1} OR (SELECT max(version::text) FROM supabase_migrations.schema_migrations)<>${quote(version)} OR (SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(m) ORDER BY version)::text,'UTF8')),'hex') FROM supabase_migrations.schema_migrations m WHERE version<>${quote(version)}) IS DISTINCT FROM (SELECT sha FROM _mapped_oldledger) THEN RAISE EXCEPTION 'mapped governance old ledger or registration changed';END IF;END $registered$;\nSELECT true AS mapped_release_checks_passed,(SELECT count(*) FROM _mapped_oldrows)::int AS old_tables_preserved;\n`;
 const prepared={at:new Date().toISOString(),environment:env,ref:refs[env],version,initialLedger:ledgers[env],expectedLedger:ledgers[env]+1,sourceSha256:sha(source),dryRunSha256:sha(sql+'ROLLBACK;\n'),applySha256:sha(sql+"NOTIFY pgrst,'reload schema';COMMIT;\n"),oldTables:tables.length};
 await writeFile(base+'-DRY-RUN.sql',sql+'ROLLBACK;\n',{flag:'wx'});await writeFile(base+'-APPLY.sql',sql+"NOTIFY pgrst,'reload schema';COMMIT;\n",{flag:'wx'});await writeFile(base+'-PREPARED.json',JSON.stringify(prepared,null,2),{flag:'wx'});console.log(JSON.stringify({environment:env,prepared:base+'-PREPARED.json',oldTables:tables.length,sourceSha256:prepared.sourceSha256}));
}else{
 const prepared=JSON.parse(await readFile(base+'-PREPARED.json','utf8')),sql=await readFile(base+(phase==='dry-run'?'-DRY-RUN.sql':'-APPLY.sql'),'utf8');if(sha(sql)!==(phase==='dry-run'?prepared.dryRunSha256:prepared.applySha256))throw Error('Immutable prepared packet drift');
 if(phase==='apply'){const dry=JSON.parse(await readFile(base+'-DRY-RUN-RECEIPT.json','utf8'));if(!dry.rollbackVerified||dry.packetSha256!==prepared.dryRunSha256)throw Error('Exact actual rollback proof required');try{await readFile(base+'-APPLY-RECEIPT.json');throw Error('Already committed; readback only');}catch(e){if(e.code!=='ENOENT')throw e;}}
 const before=await query(identitySql,true);if(before.rows[0]?.ledger!==ledgers[env]||before.rows[0]?.latest!=='20261004033000')throw Error('Mutable target drift');
 const execution=await query(sql,false),after=await query(identitySql,true);const passed=execution.rows.some(x=>x.mapped_release_checks_passed===true);
 const verified=passed&&(phase==='dry-run'?before.raw===after.raw:after.rows[0]?.ledger===prepared.expectedLedger&&after.rows[0]?.latest===version);
 const receipt={at:new Date().toISOString(),environment:env,phase,packetSha256:sha(sql),before,after,execution,rollbackVerified:phase==='dry-run'&&verified,commitVerified:phase==='apply'&&verified,hostedWorkflowAcceptance:false};
 await writeFile(base+(phase==='dry-run'?'-DRY-RUN-RECEIPT.json':'-APPLY-RECEIPT.json'),JSON.stringify(receipt,null,2),{flag:'wx'});if(!verified)throw Error('Exact release postcondition not proven');console.log(JSON.stringify({environment:env,phase,verified,ledger:after.rows[0].ledger,latest:after.rows[0].latest}));
}
