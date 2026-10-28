import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fingerprint} from './qa/dev-opaque-verification-20261004/rewrite.mjs';
const phase=process.argv[2],ref='YOUR_PROJECT_REF';
if(!['prepare','dry-run','apply'].includes(phase))throw new Error('Explicit PROD-only release phase required');
const root='./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925',base=root+'/FVI-ACCESS-CURRENT-SCOPE-PROD-20261004-v2',version='20261004163000';
const sha=value=>createHash('sha256').update(value).digest('hex'),q=value=>"'"+value.replaceAll("'","''")+"'";
const vault=await readFile('./.private/CREDENTIALS.md','utf8');
const start=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->'),end=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->');
if(start<0||end<=start)throw new Error('FVI credential boundary required');
const token=vault.slice(start,end).split(/\r?\n/).find(line=>/^\|\s*`SUPABASE_ACCESS_TOKEN`\s*\|/.test(line))?.split('|')[2]?.trim().replace(/^`|`$/g,'');
if(!/^sbp_/.test(token??''))throw new Error('FVI management authority unavailable');
async function query(sql,readOnly){
 const response=await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({query:sql,read_only:readOnly}),signal:AbortSignal.timeout(105000)});
 const raw=await response.text();
 if(!response.ok){const file=base+'-'+phase+'-ERROR-'+Date.now()+'.json';await writeFile(file,JSON.stringify({at:new Date().toISOString(),http:response.status,raw},null,2),{flag:'wx'});throw new Error('Access release HTTP'+response.status+'; diagnostic saved privately');}
 return {raw,rows:JSON.parse(raw)};
}
const identity="SELECT current_setting('server_version_num') AS engine,(SELECT count(*)::int FROM supabase_migrations.schema_migrations) AS ledger,(SELECT max(version::text) FROM supabase_migrations.schema_migrations) AS latest";
function initialState(result){return result.rows[0]?.engine==='170006'&&result.rows[0]?.ledger===455&&result.rows[0]?.latest==='20261004082000';}
if(phase==='prepare'){
 const originalSource=await readFile('output/access-full-acceptance-20261004/packet/PROPOSED_ACCESS_FORWARD.sql','utf8');
 if(sha(originalSource)!=='49ff86edc36f33ba0eedc166accc9baed13cad141a49bff9e4af65f3e9ed4c23')throw new Error('Frozen Access SQL source changed');
 const terminators=[...originalSource.matchAll(/^\$function\$\s*$/gm)];
 if(terminators.length!==2)throw new Error('Exactly two missing function terminators expected');
 const source=originalSource.replace(/^\$function\$\s*$/gm,'$function$;');
 const before=await query(identity,true);if(!initialState(before))throw new Error('Actual PROD schema changed before prepare');
 const names=['data_prep_pipelines','audit_log','data_resource_registry','rbac_user_grants','rbac_role_permissions','tenant_members','tenant_group_members','tenant_groups','tenant_group_roles','bu_group_assignments'];
 const catalog=await query(`SELECT c.oid::text,c.relname,string_agg(quote_ident(a.attname),',' ORDER BY a.attnum) AS projection FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname=ANY(ARRAY[${names.map(q).join(',')}]) GROUP BY c.oid,c.relname ORDER BY c.relname`,true);
 if(catalog.rows.length!==names.length)throw new Error('Every affected existing table must be preserved');
 let sql="BEGIN;SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='80s';SET LOCAL work_mem='4MB';\nLOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;\n";
 sql+=`DO $identity$ BEGIN IF current_setting('server_version_num')<>'170006' OR (SELECT count(*) FROM supabase_migrations.schema_migrations)<>455 OR (SELECT max(version::text) FROM supabase_migrations.schema_migrations)<>'20261004082000' OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=${q(version)}) THEN RAISE EXCEPTION 'Access exact engine/ledger/collision drift';END IF;END $identity$;\n`;
 sql+="CREATE TEMP TABLE _access_oldledger AS SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(m) ORDER BY version)::text,'UTF8')),'hex') AS sha FROM supabase_migrations.schema_migrations m;CREATE TEMP TABLE _access_oldrows(schema_name text,table_name text,projection text,row_count bigint,sha text);\n";
 for(const row of catalog.rows)sql+=`LOCK TABLE public.${row.relname} IN SHARE MODE;\n`;
 sql+=`DO $snapshot$ DECLARE r record;n bigint;v text;h bytea;item record;BEGIN FOR r IN SELECT * FROM (VALUES ${catalog.rows.map(row=>`('public',${q(row.relname)},${q(row.projection)})`).join(',')}) AS t(schema_name,table_name,projection) LOOP ${fingerprint('r.projection,r.schema_name,r.table_name')} INSERT INTO _access_oldrows VALUES(r.schema_name,r.table_name,r.projection,n,v);END LOOP;END $snapshot$;\n`;
 sql+="DO $strong_source$ BEGIN IF encode(sha256(convert_to(pg_get_functiondef('public.upsert_data_prep_pipeline_for_api(uuid,uuid,jsonb,uuid)'::regprocedure),'UTF8')),'hex')<>'b6e3862b72db5256a61308afa7120224a4765a396b51caa190add6649b72fc13' OR encode(sha256(convert_to(pg_get_functiondef('public.effective_user_permissions(uuid,uuid,uuid)'::regprocedure),'UTF8')),'hex')<>'bebb206ddd38d92d9fd0bb187ab322947f3ea776b4d93557f004160ac01356a1' THEN RAISE EXCEPTION 'Access exact SHA256 preimage drift';END IF;END $strong_source$;\n";
 sql+=source+'\n';
 sql+=`DO $preserve$ DECLARE r record;n bigint;v text;h bytea;item record;BEGIN FOR r IN SELECT * FROM _access_oldrows LOOP ${fingerprint('r.projection,r.schema_name,r.table_name')} IF n IS DISTINCT FROM r.row_count OR v IS DISTINCT FROM r.sha THEN RAISE EXCEPTION 'Access changed historical rows';END IF;END LOOP;END $preserve$;\n`;
 sql+=`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${q(version)},'current_resource_edit_and_permission_subject_scope',ARRAY[${q(source)}]::text[]);DO $registered$ BEGIN IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>456 OR (SELECT max(version::text) FROM supabase_migrations.schema_migrations)<>${q(version)} OR (SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(m) ORDER BY version)::text,'UTF8')),'hex') FROM supabase_migrations.schema_migrations m WHERE version<>${q(version)}) IS DISTINCT FROM (SELECT sha FROM _access_oldledger) THEN RAISE EXCEPTION 'Access old migration ledger changed';END IF;END $registered$;SELECT true AS access_checks_passed,(SELECT count(*) FROM _access_oldrows)::int AS old_tables_preserved,(SELECT sum(row_count)::bigint FROM _access_oldrows) AS old_rows_preserved;\n`;
 const prepared={at:new Date().toISOString(),target:'PROD '+ref,version,initialLedger:455,expectedLedger:456,originalChildSourceSha256:sha(originalSource),parentRepair:'Two missing CREATE FUNCTION delimiter semicolons only; function bodies and all catalog/authority/ABI guards unchanged',sourceSha256:sha(source),catalog:catalog.rows,dryRunSha256:sha(sql+'ROLLBACK;\n'),applySha256:sha(sql+"NOTIFY pgrst,'reload schema';COMMIT;\n")};
 await writeFile(base+'-DRY-RUN.sql',sql+'ROLLBACK;\n',{flag:'wx'});await writeFile(base+'-APPLY.sql',sql+"NOTIFY pgrst,'reload schema';COMMIT;\n",{flag:'wx'});await writeFile(base+'-PREPARED.json',JSON.stringify(prepared,null,2),{flag:'wx'});
 console.log(JSON.stringify({prepared:base+'-PREPARED.json',oldTables:names.length,sourceSha256:prepared.sourceSha256}));
}else{
 const prepared=JSON.parse(await readFile(base+'-PREPARED.json','utf8'));
 const sql=await readFile(base+(phase==='dry-run'?'-DRY-RUN.sql':'-APPLY.sql'),'utf8');
 if(sha(sql)!==(phase==='dry-run'?prepared.dryRunSha256:prepared.applySha256))throw new Error('Immutable Access packet changed');
 if(phase==='apply'){
  const rollback=JSON.parse(await readFile(base+'-DRY-RUN-RECEIPT.json','utf8'));
  if(!rollback.rollbackVerified||rollback.packetSha256!==prepared.dryRunSha256)throw new Error('Exact Access rollback proof required');
  try{await readFile(base+'-APPLY-RECEIPT.json');throw new Error('Existing apply receipt; read actual state, never repeat');}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 const before=await query(identity,true);if(!initialState(before))throw new Error('Mutable PROD target changed');
 const execution=await query(sql,false),after=await query(identity,true);
 const ok=execution.rows.some(row=>row.access_checks_passed===true)&&(phase==='dry-run'?before.raw===after.raw:after.rows[0]?.ledger===456&&after.rows[0]?.latest===version);
 const receipt={at:new Date().toISOString(),target:'PROD '+ref,phase,packetSha256:sha(sql),sourceSha256:prepared.sourceSha256,before,execution,after,rollbackVerified:phase==='dry-run'&&ok,commitVerified:phase==='apply'&&ok,hostedAccessAcceptance:false};
 await writeFile(base+(phase==='dry-run'?'-DRY-RUN-RECEIPT.json':'-APPLY-RECEIPT.json'),JSON.stringify(receipt,null,2),{flag:'wx'});
 if(!ok)throw new Error('Actual Access postconditions unconfirmed');console.log(JSON.stringify({phase,verified:true,ledger:after.rows[0].ledger,latest:after.rows[0].latest,proof:base+'-'+(phase==='dry-run'?'DRY-RUN':'APPLY')+'-RECEIPT.json'}));
}
