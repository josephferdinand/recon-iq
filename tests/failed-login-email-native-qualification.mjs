// Nash — retained PG17.6 qualification using exact consumed hosted metadata.
// No hosted SQL apply, real auth credentials/session replay, provider send or upload.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
const environment=process.env.FVI_FAILED_LOGIN_ENV??'PROD';
if(!['PROD','DEV'].includes(environment))throw Error('Explicit PROD/DEV required');
const metadataFile=`./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925/FVI-FAILED-LOGIN-CATALOG-${environment}-20261003.json`;
const bytes=readFileSync(metadataFile),metadata=JSON.parse(bytes),c=metadata.rows?.[0]?.catalog;
if(metadata.read_only!==true||metadata.ref!==(environment==='PROD'?'YOUR_PROJECT_REF':'YOUR_PROJECT_REF')||c?.engine!=='170006'||c.ledger.count!==(environment==='PROD'?448:426)||c.ledger.latest!=='20261002133100')throw Error('Captured environment identity drift');
const output=`docs/handover/returns/2026-10-03-failed-login-email-packet/native-${environment}-${Date.now()}`;
mkdirSync(output,{recursive:true});
const q=x=>`"${String(x).replaceAll('"','""')}"`,lit=x=>`'${String(x).replaceAll("'","''")}'`,sha=x=>createHash('sha256').update(x).digest('hex');
const authFields=['id','email','email_confirmed_at','deleted_at','is_anonymous'];
const tables=[['auth','users'],['public','email_send_log'],['public','email_send_state'],['public','security_events'],['public','rate_limit_buckets'],['pgmq','q_transactional_emails'],['pgmq','q_transactional_emails_dlq']];
const consumedColumns=c.columns.filter(a=>tables.some(([s,t])=>a.schema===s&&a.table===t)&&(a.schema!=='auth'||authFields.includes(a.name)));
const expectedHelpers=c.helpers.filter(h=>h.schema==='pgmq'||['enqueue_email','read_email_batch','delete_email','move_to_dlq','rate_limit_hit'].includes(h.name));
const signature=h=>`${h.schema}.${h.name}(${h.identity.split(', ').map(x=>x.slice(x.indexOf(' ')+1)).join(',')})`;
const guard=`SELECT (
 current_setting('server_version_num')='170006'
 AND (SELECT count(*)=${c.ledger.count} AND max(version::text)='20261002133100' FROM supabase_migrations.schema_migrations)
 AND to_regclass('private.failed_login_attempts') IS NULL AND to_regclass('private.failed_login_delivery_audit') IS NULL
 AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'failed_login_%')
 AND ${expectedHelpers.map(h=>`EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure(${lit(signature(h))}) AND md5(pg_get_functiondef(p.oid))=${lit(createHash('md5').update(h.definition).digest('hex'))} AND pg_get_userbyid(p.proowner)=${lit(h.owner)} AND p.proacl::text IS NOT DISTINCT FROM ${h.acl===null?'NULL':lit(h.acl)})`).join('\n AND ')}
 AND ${consumedColumns.map(a=>`EXISTS(SELECT 1 FROM information_schema.columns i WHERE i.table_schema=${lit(a.schema)} AND i.table_name=${lit(a.table)} AND i.column_name=${lit(a.name)} AND i.udt_name=${lit(a.type)} AND i.is_nullable=${lit(a.nullable)} AND i.column_default IS NOT DISTINCT FROM ${a.default===null?'NULL':lit(a.default)} AND i.is_identity=${lit(a.identity)} AND i.identity_generation IS NOT DISTINCT FROM ${a.identity_generation===null?'NULL':lit(a.identity_generation)})`).join('\n AND ')}
) AS failed_login_preimage_matches;`;
writeFileSync(`${output}/guard-query.sql`,guard);
writeFileSync(`docs/handover/returns/2026-10-03-failed-login-email-packet/guard-${environment}.sql`,guard);
let fixture=`CREATE SCHEMA private; CREATE SCHEMA auth; CREATE SCHEMA pgmq; CREATE SCHEMA supabase_migrations;
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE supabase_auth_admin; CREATE ROLE dashboard_user;
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role,supabase_auth_admin,dashboard_user; GRANT USAGE ON SCHEMA private TO service_role;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role',true),''); $$;
CREATE TABLE public.tenants(id uuid PRIMARY KEY);
CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY);
INSERT INTO supabase_migrations.schema_migrations SELECT lpad(n::text,14,'0') FROM generate_series(1,${c.ledger.count-1})n;
INSERT INTO supabase_migrations.schema_migrations VALUES('20261002133100');
SET check_function_bodies=off;
`;
for(const a of consumedColumns){const m=a.default?.match(/nextval\('([^']+)'::regclass\)/);if(m)fixture+=`CREATE SEQUENCE ${m[1]};\n`;}
for(const [schema,table] of tables){const cols=consumedColumns.filter(a=>a.schema===schema&&a.table===table);if(!cols.length)throw Error(`Actual ${schema}.${table} columns absent`);fixture+=`CREATE TABLE ${q(schema)}.${q(table)}(${cols.map(a=>`${q(a.name)} ${a.type}${a.identity==='YES'?` GENERATED ${a.identity_generation} AS IDENTITY`:a.default?` DEFAULT ${a.default}`:''}${a.nullable==='NO'?' NOT NULL':''}`).join(',')});\n`;}
fixture+='ALTER TABLE auth.users ADD PRIMARY KEY(id);\n';
for(const type of c.composite_types??[])fixture+=`CREATE TYPE pgmq.${q(type.name)} AS (${type.fields.map(f=>`${q(f.name)} ${f.type}`).join(',')});\n`;
for(const k of c.constraints)fixture+=`ALTER TABLE ${q(k.schema)}.${q(k.table)} ADD CONSTRAINT ${q(k.name)} ${k.definition};\n`;
for(const h of expectedHelpers){fixture+=h.definition+';\n';fixture+=`ALTER FUNCTION ${signature(h)} OWNER TO ${q(h.owner)};\n`;if(h.acl!==null){fixture+=`REVOKE ALL ON FUNCTION ${signature(h)} FROM PUBLIC,anon,authenticated,service_role;\n`;for(const entry of h.acl.slice(1,-1).split(',')){const m=entry.match(/^([^=]*)=([^/]*)\//);if(m?.[2].includes('X'))fixture+=`GRANT EXECUTE ON FUNCTION ${signature(h)} TO ${m[1]?q(m[1]):'PUBLIC'};\n`;}}}
for(const r of c.relations.filter(r=>tables.some(([s,t])=>r.schema===s&&r.name===t))){
 fixture+=`ALTER TABLE ${q(r.schema)}.${q(r.name)} OWNER TO ${q(r.owner)}; REVOKE ALL ON ${q(r.schema)}.${q(r.name)} FROM PUBLIC,anon,authenticated,service_role;\n`;
 for(const entry of String(r.acl??'{}').slice(1,-1).split(',')){const m=entry.match(/^([^=]*)=([^/]*)\//);if(!m)continue;const map={a:'INSERT',r:'SELECT',w:'UPDATE',d:'DELETE',D:'TRUNCATE',x:'REFERENCES',t:'TRIGGER',m:'MAINTAIN'};const permissions=[...m[2]].filter(x=>map[x]).map(x=>map[x]);if(permissions.length)fixture+=`GRANT ${permissions.join(',')} ON ${q(r.schema)}.${q(r.name)} TO ${m[1]?q(m[1]):'PUBLIC'};\n`;}
 if(r.rls)fixture+=`ALTER TABLE ${q(r.schema)}.${q(r.name)} ENABLE ROW LEVEL SECURITY;\n`;
}
// Existing policies are retained on email state/log. Security-event actor reads
// depend on unrelated tenant-role helpers; notification writes run as postgres.
for(const p of c.policies.filter(p=>['email_send_log','email_send_state'].includes(p.tablename)))fixture+=`CREATE POLICY ${q(p.policyname)} ON public.${q(p.tablename)} AS ${p.permissive} FOR ${p.cmd} TO ${p.roles.map(r=>r==='public'?'PUBLIC':q(r)).join(',')}${p.qual?` USING (${p.qual})`:''}${p.with_check?` WITH CHECK (${p.with_check})`:''};\n`;
fixture+='SET check_function_bodies=on;\n';
writeFileSync(`${output}/fixture.sql`,fixture);
const migration=readFileSync('supabase/migrations/20261003170000_failed_login_email_notifications.sql','utf8');
const revisionOnly=process.env.FVI_FAILED_LOGIN_REVISION_ONLY==='true';
const regression=readFileSync(revisionOnly?'tests/sql/failed-login-email-correlation-regression.sql':'tests/sql/failed-login-email-regression.sql','utf8');
const container=`fvi-nash-failed-login-${environment.toLowerCase()}-${randomUUID().slice(0,8)}`;
const command=(args,input)=>{const result=spawnSync('docker',args,{input,encoding:'utf8',timeout:60000,maxBuffer:6*1024*1024});if(result.error||result.status!==0)throw Error(`${args[0]} failed: ${result.error?.message??result.stderr}`);return result.stdout;};
const psql=sql=>command(['exec','-i',container,'psql','-X','-U','postgres','-v','ON_ERROR_STOP=1','-t','-A'],sql);
const logs=[];let created=false,receipt;
const concurrent=sql=>new Promise((resolve,reject)=>{const proc=spawn('docker',['exec','-i',container,'psql','-X','-U','postgres','-v','ON_ERROR_STOP=1','-t','-A']);let out='',err='';proc.stdout.on('data',x=>out+=x);proc.stderr.on('data',x=>err+=x);proc.on('error',reject);proc.on('close',code=>code===0?resolve(out):reject(Error(err)));proc.stdin.end(sql);});
try{
 command(['run','-d','--pull=never','--name',container,'--memory','512m','--cpus','1','--label','fvi.owner=nash-failed-login','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17.6-alpine']);created=true;
 for(let i=0;i<40;i++){if(spawnSync('docker',['exec',container,'pg_isready','-U','postgres'],{timeout:1000}).status===0)break;if(i===39)throw Error('Own native fixture unavailable');await new Promise(r=>setTimeout(r,250));}
 logs.push(psql(fixture)); const actualGuard=psql(guard).trim();if(actualGuard!=='t')throw Error('Exact captured consumed-schema preimage mismatch');
 // A real source/ACL change must fail the same parent guard; no normalization.
 logs.push(psql(`BEGIN; REVOKE EXECUTE ON FUNCTION public.enqueue_email(text,jsonb) FROM service_role; ${guard} ROLLBACK;`));
 if(!logs.at(-1).includes('\nf\n'))throw Error('Negative ACL guard did not fail');
 logs.push(psql(`BEGIN; ${migration} ROLLBACK;`)); if(psql(guard).trim()!=='t')throw Error('Rollback fixture changed preimage');
 logs.push(psql(migration)); logs.push(psql(regression));
 if(!revisionOnly){
 const raceId='30000000-0000-4000-8000-000000000001';
 const begin=`SELECT public.failed_login_begin('${raceId}',repeat('c',64),'password','owned@example.test');`;
 const acquisition=await Promise.all([concurrent(`BEGIN; ${begin} SELECT pg_sleep(0.4); COMMIT;`),concurrent(begin)]);
 if(acquisition.filter(x=>x.includes('"acquired": true')).length!==1)throw Error('Two-session reservation not idempotent');
 logs.push(...acquisition);
 logs.push(psql(`SELECT public.failed_login_finish('${raceId}',repeat('c',64),'invalid_credentials');`));
 const claim=`SELECT public.failed_login_claim('${raceId}',(SELECT queue_message_id FROM private.failed_login_attempts WHERE id='${raceId}'));`;
 const claims=await Promise.all([concurrent(`BEGIN; ${claim} SELECT pg_sleep(0.4); COMMIT;`),concurrent(claim)]);
 if(claims.filter(x=>x.includes('"send": true')).length!==1)throw Error('Two-session dispatch not exclusive');
 logs.push(...claims);
 // Definite rejection reaches auditable retained dead-letter after bounded retries.
 logs.push(psql(`DO $$ DECLARE a private.failed_login_attempts; c jsonb; BEGIN SELECT * INTO a FROM private.failed_login_attempts WHERE id='${raceId}'; FOR n IN 1..5 LOOP IF n=1 THEN SELECT jsonb_build_object('lease_id',lease_id) INTO c FROM private.failed_login_attempts WHERE id=a.id; ELSE c:=public.failed_login_claim(a.id,a.queue_message_id); END IF; PERFORM public.failed_login_settle(a.id,(c->>'lease_id')::uuid,'retry',NULL,'provider_rejected'); END LOOP; PERFORM fvi_failed_login_test.assert((SELECT delivery_state='dead_letter' FROM private.failed_login_attempts WHERE id=a.id),'bounded retry retained dlq'); END $$;`));
 }
 receipt={status:'PASS',environment,at:new Date().toISOString(),container,metadataSha256:sha(bytes),migrationSha256:sha(migration),guardSha256:sha(guard),engine:psql("SELECT current_setting('server_version_num');").trim(),cases:(regression.match(/-- CASE:/g)??[]).length,assertions:(regression.match(/fvi_failed_login_test\.(assert|denied)\(/g)??[]).length-2,concurrencyCases:revisionOnly?0:2,negativePreimageCases:1,rollbackQualification:'PASS',output,revisionOnly,scope:revisionOnly?'Changed server-correlation/six-argument ACL/credential-shaped receipt cases only on captured consumed PG17 schema. Prior45 assertions/two races per environment retained, not rerun. No hosted writes/auth/MFA/email/delivery.':'Exact consumed auth columns and public queue/receipt/rate controls, raw captured pgmq overloads/format/read/composite shapes, synthetic new actors/old-row fixtures. Full auth schema/session service, pgmq extension installation, unrelated tenant read policies, provider traffic and hosted delivery are not exercised.'};
}catch(error){receipt={status:'FAIL',environment,at:new Date().toISOString(),container,error:error.message,output};process.exitCode=1;}
finally{if(created)try{command(['stop',container]);}catch(error){receipt.stopError=error.message;}}
writeFileSync(`${output}/qualification.log`,logs.join('\n'));writeFileSync(`${output}/receipt.json`,JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
