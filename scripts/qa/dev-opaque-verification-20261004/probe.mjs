import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {loadFrozen,rewritePacket,fingerprint,sha} from './rewrite.mjs';
import {query,temporaryProbe,identity} from './diagnose.mjs';
const out=fileURLToPath(new URL('./output/',import.meta.url));
const {packet,prepared}=await loadFrozen();const {newSnapshot,newPreserve}=rewritePacket(packet);
const mode=process.argv[2];
if(mode==='full'){
 const before=await query('probe-before',identity);
 if(before.rows[0].ledger!==431||before.rows[0].latest!=='20261004080000')throw Error('DEV identity drift');
 const lock="EXECUTE format('LOCK TABLE %I.%I IN SHARE MODE',r.nspname,r.relname);";
 if(!newSnapshot.includes(lock))throw Error('Lock preimage drift');
 const scan=fingerprint('cols,r.nspname,r.relname');const compare=fingerprint('r.projection,r.schema_name,r.table_name');
 const snap=newSnapshot.replace(lock,'').replace(scan,"started:=clock_timestamp();"+scan+"INSERT INTO _oa_probe_timings VALUES(r.relname,'snapshot',n,extract(epoch FROM (clock_timestamp()-started))*1000);");
 const preserve=newPreserve.replace(compare,"started:=clock_timestamp();"+compare+"INSERT INTO _oa_probe_timings VALUES(r.table_name,'preserve',n,extract(epoch FROM (clock_timestamp()-started))*1000);");
 const oldFunctions=packet.split('\n').find(x=>x.startsWith('CREATE TEMP TABLE _oa_oldfunctions '));
 const oldLedger=packet.split('\n').find(x=>x.startsWith('CREATE TEMP TABLE _oa_oldledger '));
 if(!oldFunctions||!oldLedger)throw Error('Frozen contract snapshots absent');
 const sql=`BEGIN ISOLATION LEVEL REPEATABLE READ;SET LOCAL statement_timeout='80s';
CREATE TEMP TABLE _oa_probe_timings(table_name text,phase text,row_count bigint,elapsed_ms numeric);
CREATE TEMP TABLE _oa_oldrows(schema_name text,table_name text,projection text,row_count bigint,sha text);
${oldFunctions}
${oldLedger}
${snap}
${preserve}
DO $check$ BEGIN IF (SELECT count(*) FROM _oa_oldrows)<>34 THEN RAISE EXCEPTION 'full 34-table coverage changed';END IF;
IF (SELECT encode(sha256(convert_to(jsonb_agg(to_jsonb(m) ORDER BY version)::text,'UTF8')),'hex') FROM supabase_migrations.schema_migrations m) IS DISTINCT FROM (SELECT sha FROM _oa_oldledger) THEN RAISE EXCEPTION 'old ledger changed';END IF;END $check$;
SELECT jsonb_build_object('passed',true,'read_only',current_setting('transaction_read_only'),'tables',(SELECT count(*) FROM _oa_oldrows),'rows',(SELECT sum(row_count) FROM _oa_oldrows),'function_contracts',(SELECT count(*) FROM _oa_oldfunctions),'work_mem_restored',current_setting('work_mem'),'timings',(SELECT jsonb_agg(to_jsonb(t) ORDER BY table_name,phase) FROM _oa_probe_timings t)) AS proof;ROLLBACK;`;
 await writeFile(out+'readonly-full-probe.sql',sql);
 const execution=await temporaryProbe('temporary-full-probe',sql,100000);
 const after=await query('probe-after',identity);
 const ok=JSON.stringify(before.rows)===JSON.stringify(after.rows)&&execution.rows[0]?.proof?.passed===true&&execution.rows[0]?.proof?.tables===34;
 await writeFile(out+'probe-summary.json',JSON.stringify({at:new Date().toISOString(),project:'YOUR_PROJECT_REF',sourceSha256:prepared.sourceSha256,probeSha256:sha(sql),temporaryOnlyRollbackVerified:ok,fullCoupledMigrationRollbackExecuted:false,locksSkippedOnlyForTemporaryProbe:true,sourceBodiesExecuted:false,durableChanges:false,executionMs:execution.elapsedMs,before:before.rows,after:after.rows,proof:execution.rows[0]?.proof},null,2));
 if(!ok)throw Error('Read-only verification failed');console.log(JSON.stringify({passed:true,tables:34,rows:execution.rows[0].proof.rows,executionMs:execution.elapsedMs,fullMigrationRollback:false}));
}else if(mode==='new-plan'){
 const sql=await readFile(out+'new-largest-plan.sql','utf8');
 const r=await query('new-largest-plan',sql);console.log(JSON.stringify({elapsedMs:r.elapsedMs,plan:r.rows}));
}else if(mode==='old-plan'){
 const t=JSON.parse(await readFile(out+'tables.json','utf8')).rows.find(x=>x.relname==='recon_exceptions');
 const sql=`BEGIN READ ONLY; SET LOCAL statement_timeout='20s';EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) SELECT count(*),encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM (SELECT ${t.projection} FROM public.recon_exceptions)x;ROLLBACK;`;
 await writeFile(out+'old-largest-plan.sql',sql);
 try{const r=await query('old-largest-plan',sql);console.log(JSON.stringify({elapsedMs:r.elapsedMs,plan:r.rows}));}finally{await query('identity-after-old-plan',identity);}
}else if(mode==='behavior'){
 const scan=fingerprint("'id,value,payload','pg_temp','_oa_probe_fixture'");
 const mutations=[
  ['reorder','DELETE FROM _oa_probe_fixture; INSERT INTO _oa_probe_fixture SELECT * FROM _oa_probe_baseline ORDER BY value DESC NULLS FIRST;',true],
  ['value edit',"UPDATE _oa_probe_fixture SET value='edited' WHERE id=2;",false],
  ['null edit',"UPDATE _oa_probe_fixture SET value='' WHERE id=2;",false],
  ['delete','DELETE FROM _oa_probe_fixture WHERE id=2;',false],
  ['insert',"INSERT INTO _oa_probe_fixture VALUES(3,'new','{}');",false],
  ['duplicate multiplicity same count','DELETE FROM _oa_probe_fixture WHERE id=2; INSERT INTO _oa_probe_fixture SELECT * FROM _oa_probe_fixture LIMIT 1;',false],
  ['JSON edit',"UPDATE _oa_probe_fixture SET payload='{\"a\":2}' WHERE id=2;",false],
  ['added column outside original projection',"ALTER TABLE _oa_probe_fixture ADD COLUMN new_value text DEFAULT 'new';",true]
 ];
 const cases=mutations.map(([name,mutation,equal])=>`TRUNCATE _oa_probe_fixture;INSERT INTO _oa_probe_fixture(id,value,payload) SELECT * FROM _oa_probe_baseline;${mutation}${scan} IF (n=old_n AND v=old_v) IS DISTINCT FROM ${equal} THEN RAISE EXCEPTION 'behavior case failed: ${name}';END IF;INSERT INTO _oa_probe_cases VALUES('${name}',true);`).join('\n');
 const sql=`BEGIN;SET LOCAL statement_timeout='20s';SET LOCAL work_mem='4MB';
CREATE TEMP TABLE _oa_probe_fixture(id integer,value text,payload jsonb);INSERT INTO _oa_probe_fixture VALUES(1,'same','{"a":1}'),(1,'same','{"a":1}'),(2,NULL,'{"a":1}');
CREATE TEMP TABLE _oa_probe_baseline AS TABLE _oa_probe_fixture;CREATE TEMP TABLE _oa_probe_cases(name text,passed boolean);
DO $behavior$ DECLARE n bigint;v text;h bytea;item record;old_n bigint;old_v text;BEGIN ${scan}old_n:=n;old_v:=v;${cases}
TRUNCATE _oa_probe_fixture;${scan}IF n<>0 OR v IS DISTINCT FROM encode(sha256(convert_to('FVI-OA-ROWSET-V2','UTF8')),'hex') THEN RAISE EXCEPTION 'empty table failed';END IF;INSERT INTO _oa_probe_cases VALUES('empty table',true);END $behavior$;
SELECT name,passed FROM _oa_probe_cases ORDER BY name;ROLLBACK;`;
 await writeFile(out+'behavior-probe.sql',sql);
 const r=await temporaryProbe('behavior-probe',sql);if(r.rows.length!==9||r.rows.some(x=>x.passed!==true))throw Error('Focused behavior proof absent');console.log(JSON.stringify({cases:r.rows.length,passed:true,elapsedMs:r.elapsedMs}));
}else throw Error('Explicit probe mode required: full, behavior, old-plan, new-plan');
