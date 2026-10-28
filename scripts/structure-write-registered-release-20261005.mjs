import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const phase=process.argv[2];
if(!['prepare','apply','readback'].includes(phase))throw new Error('Explicit prepare/apply/readback required');
const root='output/access-directory-rebased-acceptance-20261005/targeted-rollback/v3-context';
const privateRoot='./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925';
const version='20261005080000',sha=x=>createHash('sha256').update(x).digest('hex'),q=x=>"'"+x.replaceAll("'","''")+"'";
const manifest=JSON.parse(await readFile(root+'/V3-MANIFEST.json','utf8'));
const refs={PROD:'YOUR_PROJECT_REF',DEV:'YOUR_PROJECT_REF'};
const vault=await readFile('./.private/CREDENTIALS.md','utf8');
const start=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->'),end=vault.indexOf('<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->');
if(start<0||end<=start)throw new Error('FVI authority boundary');
const token=vault.slice(start,end).split(/\r?\n/).find(x=>/^\|\s*`SUPABASE_ACCESS_TOKEN`\s*\|/.test(x))?.split('|')[2]?.trim().replace(/^`|`$/g,'');
if(!/^sbp_/.test(token??''))throw new Error('FVI authority unavailable');
async function query(ref,sql,readonly){
 const response=await fetch('https://api.supabase.com/v1/projects/'+ref+'/database/query',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({query:sql,read_only:readonly}),signal:AbortSignal.timeout(75000)});
 const raw=await response.text();
 if(!response.ok){const file=privateRoot+'/FVI-STRUCTURE-REGISTERED-'+phase+'-ERROR-'+Date.now()+'.json';await writeFile(file,JSON.stringify({at:new Date().toISOString(),ref,http:response.status,raw},null,2),{flag:'wx'});throw new Error('Structure '+phase+' HTTP'+response.status+'; private diagnostic saved; inspect remote state before retry');}
 return JSON.parse(raw);
}
const identity=`SELECT current_setting('server_version_num') AS engine,(SELECT count(*)::int FROM supabase_migrations.schema_migrations) AS ledger,(SELECT max(version::text) FROM supabase_migrations.schema_migrations) AS latest,(SELECT count(*)::int FROM supabase_migrations.schema_migrations WHERE version=${q(version)}) AS this_version`;
const intended=`SELECT jsonb_build_object(
 'routines',(SELECT jsonb_agg(jsonb_build_object('oid',p.oid::text,'schema',n.nspname,'name',p.proname,'owner',p.proowner::text,'acl',p.proacl::text,'config',p.proconfig,'args',pg_get_function_identity_arguments(p.oid),'result',pg_get_function_result(p.oid),'definition_sha256',encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex')) ORDER BY n.nspname,p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='private' AND p.proname IN('fvi_active_structure_admin','fvi_structure_write_context','fvi_bu_structure_guard','fvi_group_structure_guard','fvi_seed_missing_group_presets')) OR (n.nspname='public' AND p.proname IN('seed_tenant_group_presets_for_bu','seed_default_tenant_groups'))),
 'policies',(SELECT jsonb_agg(jsonb_build_object('table',p.polrelid::regclass::text,'name',p.polname,'sha256',encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex')) ORDER BY p.polname) FROM pg_policy p WHERE (p.polrelid='public.business_units'::regclass AND p.polname='bu_write') OR (p.polrelid='public.tenant_groups'::regclass AND p.polname='tg_admin')),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('table',t.tgrelid::regclass::text,'name',t.tgname,'sha256',encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex')) ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgname IN('a_fvi_bu_structure_write_guard','a_fvi_group_structure_write_guard')),
 'rpc_acl',jsonb_build_object('anon',has_function_privilege('anon','public.seed_tenant_group_presets_for_bu(uuid,uuid)','EXECUTE'),'service_role',has_function_privilege('service_role','public.seed_tenant_group_presets_for_bu(uuid,uuid)','EXECUTE'),'authenticated',has_function_privilege('authenticated','public.seed_tenant_group_presets_for_bu(uuid,uuid)','EXECUTE'))
) AS intended`;
async function assertVotes(){
 const database=JSON.parse(await readFile('output/approval-council-20261005/database/DECISION.json','utf8'));
 const security=JSON.parse(await readFile('output/approval-council-20261005/security/DECISION.json','utf8'));
 const workflow=JSON.parse(await readFile('output/approval-council-20261005/workflow/DECISION.json','utf8'));
 if(database.access_v3_registered_apply_review?.parent_registered_apply_go!==true||!JSON.stringify(security.dispositions?.SQL).includes('AFFIRMATIVE_SCOPED_PARENT_REGISTERED_APPLY_ACCESS_V3')||!workflow.access_targeted_review?.current_sql_vote?.startsWith('YES_REGISTERED_APPLY'))throw new Error('Exact scoped three-seat affirmative votes absent');
 return {at:new Date().toISOString(),scope:'Access exact V3 registered SQL only',affirmativeSeats:['database','security','workflow'],threshold:3,applicationDeployApproved:false};
}
function assertIntended(value){if(value.routines?.length!==7||value.policies?.length!==2||value.triggers?.length!==2||value.rpc_acl?.anon!==false||value.rpc_acl?.service_role!==false||value.rpc_acl?.authenticated!==true)throw new Error('Intended exact authority set or purpose RPC ACL differs');}
const results=[];
if(phase==='prepare')await writeFile(root+'/REGISTERED-COUNCIL-TALLY.json',JSON.stringify(await assertVotes(),null,2),{flag:'wx'});
for(const plan of manifest.packets){
 if(refs[plan.environment]!==plan.ref)throw new Error('Exact target ref');
 const base=privateRoot+'/FVI-STRUCTURE-'+plan.environment+'-REGISTERED-20261005';
 if(phase==='prepare'){
  const sql=await readFile(root+'/'+plan.file,'utf8');
  if(sha(sql)!==plan.sha256||!sql.endsWith('ROLLBACK;\n'))throw new Error('Exact successful V3 packet changed');
  const before=(await query(plan.ref,identity,true))[0];
  if(before.engine!=='170006'||before.ledger!==plan.initialLedger||before.latest!==plan.latest||before.this_version!==0)throw new Error('Current engine/ledger/version collision');
  const bodyStart=sql.indexOf('-- BEGIN BYTE-IDENTICAL FROZEN RAW FORWARD\n')+'-- BEGIN BYTE-IDENTICAL FROZEN RAW FORWARD\n'.length;
  const bodyEnd=sql.indexOf('-- END BYTE-IDENTICAL FROZEN RAW FORWARD',bodyStart);
  if(bodyStart<50||bodyEnd<0)throw new Error('Frozen raw body markers absent');
  const body=sql.slice(bodyStart,bodyEnd);
  const rawBody=await readFile('output/access-directory-closure-20261005/RETAINED-PROPOSED_RAW_STRUCTURE_FORWARD.sql','utf8');
  if(sha(rawBody)!=='7b3c01d100e3202f6fcc66b8b2b875b2d648ccf3a20cd5f62baf5f3a7c84cb7a'||body.trim()!==rawBody.trim())throw new Error('Frozen 7b3 body mismatch');
  const finalMarker="SELECT 'SOURCE_ONLY_PARENT_ROLLBACK_VERIFICATION' AS receipt_kind,";
  if(sql.split(finalMarker).length!==2)throw new Error('Unique final receipt marker required');
  const prefix=sql.slice(0,sql.indexOf(finalMarker));
  const apply=prefix+`DO $registration_collision$ BEGIN IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version=${q(version)}) THEN RAISE EXCEPTION 'Access migration version collision';END IF;END $registration_collision$;\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${q(version)},'tenant_admin_bu_group_structure',ARRAY[${q(rawBody)}]::text[]);\nCREATE TEMP TABLE _fvi_access_old_ledger_readback ON COMMIT DROP AS SELECT * FROM supabase_migrations.schema_migrations WHERE version<>${q(version)};\nDO $registered_preserve$ DECLARE preserved record;actual record;BEGIN\n SELECT * INTO STRICT preserved FROM pg_temp._fvi_access_old_rows WHERE schema_name='supabase_migrations' AND table_name='schema_migrations';\n SELECT * INTO STRICT actual FROM pg_temp.fvi_access_rowset('pg_temp','_fvi_access_old_ledger_readback',preserved.projection);\n IF actual.row_count<>preserved.row_count OR actual.row_hash<>preserved.row_hash OR (SELECT count(*) FROM supabase_migrations.schema_migrations)<>${plan.initialLedger+1} OR (SELECT max(version::text) FROM supabase_migrations.schema_migrations)<>${q(version)} THEN RAISE EXCEPTION 'Access registered old ledger changed';END IF;END $registered_preserve$;\nSELECT true AS registered_access_checks_passed,(SELECT jsonb_agg(to_jsonb(r) ORDER BY schema_name,table_name) FROM pg_temp._fvi_access_old_rows r) AS old_row_snapshots,(SELECT count(*) FROM pg_temp._fvi_access_old_authority) AS old_authority_objects,(${intended.replace(/;\s*$/,'')}) AS authority_receipt;\nNOTIFY pgrst,'reload schema';\nCOMMIT;\n`;
  const prepared={at:new Date().toISOString(),environment:plan.environment,ref:plan.ref,version,initial:before,expectedLedger:plan.initialLedger+1,rollbackSHA256:plan.sha256,bodySHA256:sha(rawBody),applySHA256:sha(apply),oldFencesRetained:true,registrationAfterPreservation:true,seedInvoked:false};
  await writeFile(base+'-APPLY.sql',apply,{flag:'wx'});await writeFile(base+'-PREPARED.json',JSON.stringify(prepared,null,2),{flag:'wx'});
  results.push({...prepared,preparedOnly:true});
 }else if(phase==='apply'){
  await assertVotes();
  const prepared=JSON.parse(await readFile(base+'-PREPARED.json','utf8')),sql=await readFile(base+'-APPLY.sql','utf8');
  if(prepared.ref!==plan.ref||prepared.version!==version||prepared.rollbackSHA256!==plan.sha256||sha(sql)!==prepared.applySHA256)throw new Error('Frozen registered apply drift');
  const before=(await query(plan.ref,identity,true))[0];if(JSON.stringify(before)!==JSON.stringify(prepared.initial))throw new Error('Current apply target drift or already applied; inspect without replay');
  await writeFile(base+'-INTENT.json',JSON.stringify({at:new Date().toISOString(),ref:plan.ref,version,sha256:sha(sql),status:'submission_pending'},null,2),{flag:'wx'});
  const execution=await query(plan.ref,sql,false),after=(await query(plan.ref,identity,true))[0];
  if(after.engine!=='170006'||after.ledger!==prepared.expectedLedger||after.latest!==version||after.this_version!==1||execution.length!==1||execution[0].registered_access_checks_passed!==true)throw new Error('Registered commit readback differs; inspect without retry');
  assertIntended(execution[0].authority_receipt);
  const receipt={at:new Date().toISOString(),...prepared,before,execution,after,committed:true,appUploaded:false};
  await writeFile(base+'-APPLY-RECEIPT.json',JSON.stringify(receipt,null,2),{flag:'wx'});
  results.push({environment:plan.environment,ref:plan.ref,version,ledger:after.ledger,committed:true,oldRelations:execution[0].old_row_snapshots.length,receipt:base+'-APPLY-RECEIPT.json'});
 }else{
  const receipt=JSON.parse(await readFile(base+'-APPLY-RECEIPT.json','utf8'));if(!receipt.committed||receipt.ref!==plan.ref||receipt.version!==version)throw new Error('Exact committed receipt absent');
  const actual=(await query(plan.ref,identity,true))[0];if(JSON.stringify(actual)!==JSON.stringify(receipt.after))throw new Error('Postrelease current identity drift');
  const current=(await query(plan.ref,intended,true))[0].intended;assertIntended(current);
  if(JSON.stringify(current)!==JSON.stringify(receipt.execution[0].authority_receipt))throw new Error('Independent current authority metadata differs');
  const preserved=[];
  for(const old of receipt.execution[0].old_row_snapshots){
   if(!['public','supabase_migrations'].includes(old.schema_name)||!/^[a-z_]+$/.test(old.table_name)||!/^([a-z_]+|"[a-z_]+")(?:(?:,)([a-z_]+|"[a-z_]+"))*$/.test(old.projection))throw new Error('Exact old snapshot projection unsupported');
   const filter=old.schema_name==='supabase_migrations'?` WHERE version<>${q(version)}`:'';
   const hashes=await query(plan.ref,`SELECT encode(sha256(convert_to(to_jsonb(x)::text,'UTF8')),'hex') AS digest FROM (SELECT ${old.projection} FROM "${old.schema_name}"."${old.table_name}"${filter})x ORDER BY 1`,true);
   let state=createHash('sha256').update('FVI-ACCESS-OLDROWSET-V1','utf8').digest();
   for(const row of hashes){if(!/^[a-f0-9]{64}$/.test(row.digest))throw new Error('Invalid returned row digest');state=createHash('sha256').update(Buffer.concat([state,Buffer.from(row.digest,'hex')])).digest();}
   if(hashes.length!==Number(old.row_count)||state.toString('hex')!==old.row_hash)throw new Error('Independent old row hash differs for '+old.schema_name+'.'+old.table_name+'; preserve evidence and investigate');
   preserved.push({schema:old.schema_name,table:old.table_name,count:hashes.length,sha256:state.toString('hex'),preserved:true});
  }
  const saved={at:new Date().toISOString(),environment:plan.environment,ref:plan.ref,version,actual,authority:current,preserved,independentReadbackPassed:true,appUploaded:false};
  await writeFile(base+'-POSTREADBACK.json',JSON.stringify(saved,null,2),{flag:'wx'});
  results.push({environment:plan.environment,ref:plan.ref,version,ledger:actual.ledger,independentReadbackPassed:true,oldRelations:preserved.length,oldRows:preserved.reduce((n,x)=>n+x.count,0),receipt:base+'-POSTREADBACK.json'});
 }
 console.log(JSON.stringify(results.at(-1)));
}
await mkdir('docs/evidence',{recursive:true});
await writeFile('docs/evidence/FVI_STRUCTURE_REGISTERED_'+phase.toUpperCase()+'_2026-10-05-'+Date.now()+'.json',JSON.stringify({at:new Date().toISOString(),phase,version,results,council:root+'/REGISTERED-COUNCIL-TALLY.json',applicationUploaded:false},null,2),{flag:'wx'});
