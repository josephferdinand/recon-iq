import{readFile,writeFile}from'node:fs/promises';
import{createHash}from'node:crypto';
const phase=process.argv[2];if(!['prepare','apply','readback'].includes(phase))throw Error('Explicit phase required');
const root='output/access-legacy-group-role-forward-20261005/revision-02',out=root+'/parent-guarded',privateRoot='./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925';
const version='20261005120000',bodySHA='ca6563f2b8ff2a74b8afe744dcb2d1e10a026ae10a3dde38ba4f41e73af607d2';
const sha=x=>createHash('sha256').update(x).digest('hex'),quote=x=>"'"+x.replaceAll("'","''")+"'";
const manifest=JSON.parse(await readFile(root+'/FUNCTION-MANIFEST.json','utf8')),rollbacks=JSON.parse(await readFile(out+'/ROLLBACK-MANIFEST.json','utf8'));
const database=JSON.parse(await readFile('output/approval-council-20261005/database/DECISION.json','utf8')).legacy_role_revision02_registered_apply_review;
const security=JSON.parse(await readFile('output/approval-council-20261005/security/DECISION.json','utf8')).dispositions.SQL;
const workflow=JSON.parse(await readFile('output/approval-council-20261005/workflow/DECISION.json','utf8')).legacy_role_revision02_workflow_vote;
if(database?.apply_go!==true||database.function.postimage_sha256!==bodySHA||database.material_findings_remaining.length||security.vote!=='AFFIRMATIVE_SCOPED_LEGACYROLE_REV02_REGISTERED_APPLY'||workflow.registered_apply_go!==true||workflow.helper_definition_sha256!==bodySHA)throw Error('Exact three scoped registered-apply votes absent');
const vault=await readFile('./.private/CREDENTIALS.md','utf8'),a=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->'),b=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->');
if(a<0||b<=a)throw Error('FVI authority boundary');
const token=vault.slice(a,b).split(/\r?\n/).find(x=>/^\|\s*`SUPABASE_ACCESS_TOKEN`\s*\|/.test(x))?.split('|')[2]?.trim().replace(/^`|`$/g,'');if(!/^sbp_/.test(token??''))throw Error('FVI token unavailable');
async function query(ref,query,read_only){const r=await fetch('https://api.supabase.com/v1/projects/'+ref+'/database/query',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({query,read_only}),signal:AbortSignal.timeout(75000)});const text=await r.text();if(!r.ok){await writeFile(privateRoot+'/FVI-LEGACY-REGISTERED-'+phase+'-ERROR-'+Date.now()+'.json',JSON.stringify({ref,at:new Date().toISOString(),http:r.status,text}),{flag:'wx'});throw Error('Registered helper HTTP'+r.status+'; inspect outcome before any retry');}return JSON.parse(text);}
const identity=`SELECT current_setting('server_version_num') AS engine,(SELECT count(*)::int FROM supabase_migrations.schema_migrations) AS ledger,(SELECT max(version::text) FROM supabase_migrations.schema_migrations) AS latest,(SELECT count(*)::int FROM supabase_migrations.schema_migrations WHERE version=${quote(version)}) AS this_version,(SELECT to_jsonb(p) FROM pg_proc p WHERE oid='private.user_has_tenant_role_or_group(uuid,uuid,public.tenant_role)'::regprocedure) AS helper`;
const results=[];
for(const plan of manifest.files){
 if(!['YOUR_PROJECT_REF','YOUR_PROJECT_REF'].includes(plan.ref))throw Error('Unapproved target');
 const prefix=privateRoot+'/FVI-LEGACY-ROLE-'+plan.environment+'-REGISTERED-20261005';
 const rollback=rollbacks.results.find(x=>x.environment===plan.environment),sql=await readFile(rollback.file,'utf8'),body=await readFile(root+'/'+plan.postimage,'utf8');
 if(sha(sql)!==rollback.sha256||sha(body)!==bodySHA||!sql.endsWith('ROLLBACK;\n'))throw Error('Exact approved rollback/body drift');
 if(phase==='prepare'){
  const before=(await query(plan.ref,identity,true))[0];if(before.engine!=='170006'||before.ledger!==plan.ledger||before.latest!=='20261005080000'||before.this_version!==0)throw Error('Actual target/version drift');
  const sourceReceipt=JSON.parse(await readFile(privateRoot+'/FVI-LEGACY-ROLE-'+plan.environment+'-ROLLBACK-RECEIPT-'+(plan.environment==='PROD'?'1791177461213':'1791177470607')+'.json','utf8'));
  if(!sourceReceipt.rollbackPassed||sourceReceipt.committed||sourceReceipt.sourceSHA256!==rollback.sha256)throw Error('Successful exact rollback proof absent');
  const receiptMarker='SELECT true AS old_rows_preserved';if(sql.split(receiptMarker).length!==2)throw Error('Unique successful preservation marker absent');
  const registration=`DO $legacy_version$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=${quote(version)}) THEN RAISE EXCEPTION 'Legacy helper migration collision';END IF;END $legacy_version$;\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${quote(version)},'legacy_group_role_fk_active_builtin',ARRAY[${quote(body)}]::text[]);\nCREATE TEMP TABLE _fvi_legacy_old_ledger_readback ON COMMIT DROP AS SELECT * FROM supabase_migrations.schema_migrations WHERE version<>${quote(version)};\nDO $legacy_ledger_preserved$ DECLARE old record;actual record;BEGIN SELECT * INTO STRICT old FROM pg_temp._fvi_access_old_rows WHERE schema_name='supabase_migrations' AND table_name='schema_migrations';SELECT * INTO STRICT actual FROM pg_temp.fvi_access_rowset('pg_temp','_fvi_legacy_old_ledger_readback',old.projection);IF actual.row_count<>old.row_count OR actual.row_hash<>old.row_hash OR (SELECT count(*) FROM supabase_migrations.schema_migrations)<>${plan.ledger+1} OR (SELECT max(version::text) FROM supabase_migrations.schema_migrations)<>${quote(version)} THEN RAISE EXCEPTION 'Old ledger preservation failed';END IF;END $legacy_ledger_preserved$;\n`;
  const apply=sql.slice(0,sql.indexOf(receiptMarker))+registration+sql.slice(sql.indexOf(receiptMarker),-('ROLLBACK;\n'.length))+"NOTIFY pgrst,'reload schema';\nCOMMIT;\n";
  const prepared={at:new Date().toISOString(),ref:plan.ref,environment:plan.environment,version,before,expectedLedger:plan.ledger+1,rollbackSHA256:rollback.sha256,bodySHA256:bodySHA,applySHA256:sha(apply),expectedHelper:sourceReceipt.execution[0].post_helper_metadata,council:['security','database','workflow'],oldFencesUnchanged:true};
  await writeFile(prefix+'-APPLY.sql',apply,{flag:'wx'});await writeFile(prefix+'-PREPARED.json',JSON.stringify(prepared,null,2),{flag:'wx'});
  results.push({environment:plan.environment,prepared:true,version,expectedLedger:prepared.expectedLedger,applySHA256:prepared.applySHA256});
 }else if(phase==='apply'){
  const prepared=JSON.parse(await readFile(prefix+'-PREPARED.json','utf8')),apply=await readFile(prefix+'-APPLY.sql','utf8');
  if(prepared.ref!==plan.ref||sha(apply)!==prepared.applySHA256)throw Error('Frozen apply drift');
  const before=(await query(plan.ref,identity,true))[0];if(JSON.stringify(before)!==JSON.stringify(prepared.before))throw Error('Current target changed/already applied; inspect without replay');
  await writeFile(prefix+'-INTENT.json',JSON.stringify({at:new Date().toISOString(),ref:plan.ref,version,status:'submission_pending',applySHA256:sha(apply)}),{flag:'wx'});
  const execution=await query(plan.ref,apply,false),after=(await query(plan.ref,identity,true))[0];
  if(execution.length!==1||execution[0].old_rows_preserved!==true||after.ledger!==prepared.expectedLedger||after.latest!==version||after.this_version!==1||JSON.stringify(after.helper)!==JSON.stringify(prepared.expectedHelper))throw Error('Commit/readback differs; no retry');
  await writeFile(prefix+'-APPLY-RECEIPT.json',JSON.stringify({at:new Date().toISOString(),...prepared,execution,after,committed:true},null,2),{flag:'wx'});
  results.push({environment:plan.environment,committed:true,version,ledger:after.ledger,protectedRelations:execution[0].protected_relations,protectedRows:execution[0].protected_rows,receipt:prefix+'-APPLY-RECEIPT.json'});
 }else{
  const receipt=JSON.parse(await readFile(prefix+'-APPLY-RECEIPT.json','utf8')),actual=(await query(plan.ref,identity,true))[0];if(JSON.stringify(actual)!==JSON.stringify(receipt.after))throw Error('Independent helper identity differs');
  const preserved=[];
  for(const old of receipt.execution[0].old_row_snapshots){
   if(!['public','supabase_migrations'].includes(old.schema_name)||!/^[a-z_]+$/.test(old.table_name)||!/^([a-z_]+|"[a-z_]+")(?:(?:,)([a-z_]+|"[a-z_]+"))*$/.test(old.projection))throw Error('Unsafe old projection');
   const filter=old.schema_name==='supabase_migrations'?` WHERE version<>${quote(version)}`:'';
   const hashes=await query(plan.ref,`SELECT encode(sha256(convert_to(to_jsonb(x)::text,'UTF8')),'hex') AS digest FROM (SELECT ${old.projection} FROM "${old.schema_name}"."${old.table_name}"${filter})x ORDER BY 1`,true);
   let state=createHash('sha256').update('FVI-ACCESS-OLDROWSET-V1').digest();for(const row of hashes){if(!/^[a-f0-9]{64}$/.test(row.digest))throw Error('Unexpected row digest');state=createHash('sha256').update(Buffer.concat([state,Buffer.from(row.digest,'hex')])).digest();}
   if(hashes.length!==Number(old.row_count)||state.toString('hex')!==old.row_hash)throw Error('Independent old rows differ: '+old.table_name);
   preserved.push({schema:old.schema_name,table:old.table_name,count:hashes.length,sha256:state.toString('hex'),preserved:true});
  }
  const post={at:new Date().toISOString(),ref:plan.ref,environment:plan.environment,version,actual,preserved,independentReadbackPassed:true};await writeFile(prefix+'-POSTREADBACK.json',JSON.stringify(post,null,2),{flag:'wx'});
  results.push({environment:plan.environment,version,ledger:actual.ledger,independentReadbackPassed:true,protectedRelations:preserved.length,protectedRows:preserved.reduce((n,x)=>n+x.count,0),receipt:prefix+'-POSTREADBACK.json'});
 }
 console.log(JSON.stringify(results.at(-1)));
}
await writeFile(out+'/REGISTERED-'+phase.toUpperCase()+'.json',JSON.stringify({at:new Date().toISOString(),phase,version,results,noApplicationUpload:true},null,2),{flag:'wx'});
