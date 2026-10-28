// Curie — exact captured PG17 security/read dependencies, synthetic actors/rows.
// No hosted write, auth login, full migration replay or deployment claim.
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
const environment=process.env.FVI_RECON_READ_ENV??'PROD';
if(!['PROD','DEV'].includes(environment))throw Error('Explicit PROD/DEV required');
const file=`./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925/FVI-RECON-READ-SUPPLEMENT-${environment}-20261003.json`;
const bytes=readFileSync(file);const c=JSON.parse(bytes);
if(c.read_only!==true||c.engine!=='170006'||c.ledger!==(environment==='PROD'?448:426)||c.latest!=='20261002133100')throw Error('Metadata identity drift');
const output=`docs/handover/returns/2026-10-03-curie-recon-read-packet/native-${environment}`;mkdirSync(output,{recursive:true});
if(existsSync(`${output}/receipt.json`)){const attempt=Date.now();for(const f of ['receipt.json','qualification.log','fixture.sql'])if(existsSync(`${output}/${f}`))copyFileSync(`${output}/${f}`,`${output}/prior-${attempt}-${f}`);}
const q=x=>`"${String(x).replaceAll('"','""')}"`,lit=x=>`'${String(x).replaceAll("'","''")}'`;
const core=['api_tokens','audit_log','audit_chain_head'];
let fixture=`CREATE SCHEMA auth; CREATE SCHEMA private; CREATE SCHEMA extensions; CREATE SCHEMA supabase_migrations;
CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role BYPASSRLS; CREATE ROLE supabase_auth_admin; CREATE ROLE dashboard_user;
GRANT USAGE ON SCHEMA public,private,auth TO authenticated,anon,service_role;
CREATE EXTENSION citext; CREATE EXTENSION ltree; CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY);
INSERT INTO supabase_migrations.schema_migrations SELECT lpad(n::text,14,'0') FROM generate_series(1,${c.ledger-1}) n;
INSERT INTO supabase_migrations.schema_migrations VALUES('20261002133100');
CREATE SEQUENCE public.audit_log_id_seq START 9007199254740993;
SET check_function_bodies=off;
`;
const enums=new Map();for(const e of c.enums){const values=enums.get(e.name)??[];values.push(e);enums.set(e.name,values);}
const requiredTypes=new Set(c.columns.map(a=>a.type.replaceAll('[]','')));requiredTypes.add('platform_role');requiredTypes.add('tenant_role');
for(const [name,values] of enums)if(requiredTypes.has(name)||requiredTypes.has('public.'+name))fixture+=`CREATE TYPE public.${q(name)} AS ENUM(${values.sort((a,b)=>a.order-b.order).map(e=>lit(e.value)).join(',')});\n`;
for(const r of c.relations){
 const columns=c.columns.filter(a=>a.table===r.relname);
 // All consumed types are exact. Full nullable/default/generated shape is
 // restored for token and audit. Unconsumed other-table write rules are omitted.
 const defs=[],dropped=[];let position=1;
 for(const a of columns){while(position<a.position){const name=`fixture_dropped_${position++}`;defs.push(`${q(name)} text`);dropped.push(name);}defs.push(`${q(a.name)} ${a.type}${core.includes(r.relname)?`${a.generated==='s'?` GENERATED ALWAYS AS (${a.default}) STORED`:a.default?` DEFAULT ${a.default}`:''}${a.not_null?' NOT NULL':''}`:''}`);position++;}
 fixture+=`CREATE TABLE public.${q(r.relname)}(${defs.join(',')});\n`;
 for(const name of dropped)fixture+=`ALTER TABLE public.${q(r.relname)} DROP COLUMN ${q(name)};\n`;
}
fixture+='ALTER TABLE public.tenants ADD PRIMARY KEY(id); ALTER TABLE public.api_service_principals ADD UNIQUE(id,tenant_id);\n';
for(const k of c.constraints.filter(k=>core.includes(k.table)))fixture+=`ALTER TABLE public.${q(k.table)} ADD CONSTRAINT ${q(k.name)} ${k.definition}${k.validated?'':' NOT VALID'};\n`;
for(const i of c.indexes.filter(i=>i.table==='api_tokens'&&!i.definition.includes('api_tokens_pkey')))fixture+=i.definition+';\n';
// Install raw captured helper bodies/owners/ACLs; CRLF is deliberately retained.
for(const h of c.helpers){
 fixture+=h.definition+';\n';
 const sig=`${q(h.schema)}.${q(h.name)}(${h.identity})`;
 if(h.acl===null){fixture+=`ALTER FUNCTION ${sig} OWNER TO ${q(h.owner)};\n`;continue;}
 fixture+=`ALTER FUNCTION ${sig} OWNER TO ${q(h.owner)}; REVOKE ALL ON FUNCTION ${sig} FROM PUBLIC,anon,authenticated,service_role,${q(h.owner)};\n`;
 const acl=h.acl===null?`{${h.owner}=X/${h.owner},=X/${h.owner}}`:h.acl;
 for(const entry of acl.slice(1,-1).split(',')){
   const m=entry.match(/^([^=]*)=([^/]*)\//u);if(!m||!m[2].includes('X'))continue;
   const role=m[1]||'PUBLIC'; fixture+=`GRANT EXECUTE ON FUNCTION ${sig} TO ${role==='PUBLIC'?'PUBLIC':q(role)}${m[2].includes('*')?' WITH GRANT OPTION':''};\n`;
 }
}
for(const r of c.relations){
 fixture+=`ALTER TABLE public.${q(r.relname)} OWNER TO ${q(r.owner)}; REVOKE ALL ON public.${q(r.relname)} FROM PUBLIC,anon,authenticated,service_role;\n`;
 for(const entry of String(r.acl??'{}').slice(1,-1).split(',')){
  const m=entry.match(/^([^=]*)=([^/]*)\//u);if(!m)continue;
  const map={a:'INSERT',r:'SELECT',w:'UPDATE',d:'DELETE',D:'TRUNCATE',x:'REFERENCES',t:'TRIGGER',m:'MAINTAIN'};
  const permissions=[...m[2]].filter(x=>map[x]).map(x=>map[x]);if(permissions.length)fixture+=`GRANT ${permissions.join(',')} ON public.${q(r.relname)} TO ${m[1]?q(m[1]):'PUBLIC'};\n`;
 }
 if(r.relrowsecurity)fixture+=`ALTER TABLE public.${q(r.relname)} ENABLE ROW LEVEL SECURITY;\n`;
 if(r.relforcerowsecurity)fixture+=`ALTER TABLE public.${q(r.relname)} FORCE ROW LEVEL SECURITY;\n`;
}
for(const p of c.policies.filter(p=>p.tablename==='api_tokens'))fixture+=`CREATE POLICY ${q(p.policyname)} ON public.${q(p.tablename)} AS ${p.permissive} FOR ${p.cmd} TO ${p.roles.map(r=>r==='public'?'PUBLIC':q(r)).join(',')}${p.qual?` USING (${p.qual})`:''}${p.with_check?` WITH CHECK (${p.with_check})`:''};\n`;
for(const t of c.triggers.filter(t=>['api_tokens','audit_log'].includes(t.table))){fixture+=t.definition+';\n';if(t.enabled!=='O')throw Error('Unexpected trigger state');}
fixture+=`INSERT INTO public.audit_chain_head(singleton) VALUES(true); SET check_function_bodies=on; SELECT version();\n`;
const migration=readFileSync('supabase/migrations/20261003153000_public_reconciliation_run_read.sql','utf8');
writeFileSync(`${output}/fixture.sql`,fixture);writeFileSync(`${output}/migration.sql`,migration);
const name=`fvi-curie-recon-read-${environment.toLowerCase()}-${randomUUID().slice(0,8)}`;
const docker=(args,input)=>{const r=spawnSync('docker',args,{input,encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024});if(r.error||r.status!==0)throw Error(`${args[0]} failed: ${r.error?.message??r.stderr}`);return r.stdout;};
const psql=sql=>docker(['exec','-i',name,'psql','-X','-U','postgres','-v','ON_ERROR_STOP=1'],sql);
let receipt,created=false;const logs=[];
try{
 docker(['run','-d','--name',name,'--label','fvi.owner=curie-recon-read','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17.6-alpine']);created=true;
 for(let n=0;n<40;n++){if(spawnSync('docker',['exec',name,'pg_isready','-U','postgres'],{timeout:1000}).status===0)break;if(n===39)throw Error('Own fixture health failed');await new Promise(resolve=>setTimeout(resolve,250));}
 logs.push(psql(fixture));
 const guard=readFileSync('scripts/public-recon-read-dependency-guard-20261003.sql','utf8');
 const guardResult=psql(guard);logs.push(guardResult);if(!/\bt\b/u.test(guardResult))throw Error('Exact native preimage guard mismatch; never waived');
 const testSource=readFileSync('tests/sql/public-recon-read-regression.sql','utf8');
 const [seed,tests]=testSource.split('-- AFTER MIGRATION:');if(!tests)throw Error('Fixture seed boundary absent');
 logs.push(psql(seed));
 const catalogGuard=migration.match(/DO \$catalog_guard\$[\s\S]*?END \$catalog_guard\$;/u)?.[0];if(!catalogGuard)throw Error('Migration catalog guard missing');
 const negativeGuards=[
  "REVOKE EXECUTE ON FUNCTION public.recon_authoritative_access_decision_as(uuid,uuid,text) FROM service_role;",
  "ALTER TABLE public.api_tokens ALTER COLUMN issuer_user_id DROP EXPRESSION;",
  "ALTER TABLE public.api_tokens DISABLE TRIGGER guard_api_token_principal_metadata_before_write;",
 ];
 for(const mutation of negativeGuards)logs.push(psql(`BEGIN; ${mutation} SELECT fvi_test.denied($native_guard_sql$${catalogGuard}$native_guard_sql$,'P0001'); ROLLBACK;`));
 logs.push(psql(migration));
 writeFileSync(`${output}/regression.sql`,testSource);logs.push(psql(tests));
 // Two real sessions: committed revocation first denies; a read lock first
 // serializes the later writer until read commit, for both token and member.
 const concurrency=await import('../scripts/public-recon-read-concurrency-20261003.mjs');
 const races=await concurrency.qualifyReadRevocation({name,psql,output});
 receipt={status:'PASS',environment,at:new Date().toISOString(),container:name,metadataSha256:createHash('sha256').update(bytes).digest('hex'),migrationSha256:createHash('sha256').update(migration).digest('hex'),nativeGuard:'exact consumed dependencies PASS without replacement',negativeCatalogGuards:negativeGuards.length,cases:(tests.match(/-- CASE:/gu)??[]).length,races,scope:'PG17.6 captured helper/token/audit controls; synthetic new actors/business rows. Other table write defaults/FKs/policies omitted. No hosted Auth/MFA/business write/deployment proof.'};
}catch(error){receipt={status:'FAIL',environment,at:new Date().toISOString(),container:name,error:error.message};process.exitCode=1;}
finally{if(created)try{docker(['stop',name]);}catch(error){receipt.stopError=error.message;}}
writeFileSync(`${output}/qualification.log`,logs.join('\n'));writeFileSync(`${output}/receipt.json`,JSON.stringify(receipt,null,2));console.log(JSON.stringify({...receipt,output}));
