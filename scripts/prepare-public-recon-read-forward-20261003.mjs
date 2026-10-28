// Generates a bounded forward packet from exact parent metadata. No network/apply.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root='./LOCAL_USER/AppData/Local/FVI-QA-Private-20260925';
const environments=['PROD','DEV'];
const captures=environments.map(env=>JSON.parse(readFileSync(`${root}/FVI-RECON-READ-SUPPLEMENT-${env}-20261003.json`,'utf8')));
const request=readFileSync('scripts/public-recon-read-catalog-request-20261003.sql','utf8').replace(/;\s*$/u,'');
const literal=v=>`'${String(v).replaceAll("'","''")}'`;
const helper=name=>{
 const rows=captures.map(c=>c.helpers.find(h=>h.schema==='public'&&h.name===name));
 if(rows.some(h=>!h)||rows[0].definition.replaceAll('\r\n','\n')!==rows[1].definition.replaceAll('\r\n','\n'))throw Error(`${name} missing or environment body drift`);
 return rows[0].definition.replaceAll('\r\n','\n');
};
for(const c of captures){
 if(c.read_only!==true||c.latest!=='20261002133100'||c.engine!=='170006'||c.ledger!==(c.environment==='PROD'?448:426))throw Error('Catalog identity drift');
 if(!c.columns.some(a=>a.table==='api_tokens'&&a.name==='issuer_user_id'&&a.generated==='s'&&a.default==='created_by'))throw Error('Issuer alias drift');
}
// The release guard checks exact captured security/read bodies, their ACL/owner,
// all consumed column types, full token/audit columns, token constraints/indexes/
// policies and token/audit trigger bodies. Unconsumed write defaults/FKs on other
// tables are retained in the full parent guard, not asserted by this read slice.
const dependencyQuery=`SELECT jsonb_build_object(
 'ledger',(SELECT count(*) FROM supabase_migrations.schema_migrations),
 'latest',(SELECT max(version) FROM supabase_migrations.schema_migrations),
 'engine',current_setting('server_version_num'),
 'helpers',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'identity',pg_get_function_identity_arguments(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'md5',md5(pg_get_functiondef(p.oid))) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) IN (${captures[0].helpers.map(h=>`(${literal(h.schema)},${literal(h.name)},${literal(h.identity)})`).join(',')})),
 'relations',(SELECT jsonb_agg(jsonb_build_object('relname',c.relname,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,'relrowsecurity',c.relrowsecurity,'relforcerowsecurity',c.relforcerowsecurity) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN (${captures[0].relations.map(r=>literal(r.relname)).join(',')})),
 'types',(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'position',a.attnum) ORDER BY c.relname,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN (${captures[0].relations.map(r=>literal(r.relname)).join(',')}) AND a.attnum>0 AND NOT a.attisdropped),
 'core_columns',(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'position',a.attnum,'acl',a.attacl::text,'identity',a.attidentity,'generated',a.attgenerated,'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) ORDER BY c.relname,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relname IN ('api_tokens','audit_log','audit_chain_head') AND a.attnum>0 AND NOT a.attisdropped),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',k.conname,'type',k.contype,'validated',k.convalidated,'definition',pg_get_constraintdef(k.oid)) ORDER BY c.relname,k.conname) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('api_tokens','audit_log','audit_chain_head')),
 'indexes',(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'definition',pg_get_indexdef(i.indexrelid)) ORDER BY c.relname,pg_get_indexdef(i.indexrelid)) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname='api_tokens'),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.tablename,p.policyname) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename='api_tokens'),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid),'md5',md5(pg_get_functiondef(t.tgfoid))) ORDER BY c.relname,t.tgname) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('api_tokens','audit_log') AND NOT t.tgisinternal)
) AS actual`;
const expected=captures.map(c=>({ledger:c.ledger,latest:c.latest,engine:c.engine,
 helpers:c.helpers.map(h=>({schema:h.schema,name:h.name,identity:h.identity,owner:h.owner,acl:h.acl,md5:createHash('md5').update(h.definition).digest('hex')})),
 relations:c.relations.map(({relname,owner,acl,relrowsecurity,relforcerowsecurity})=>({relname,owner,acl,relrowsecurity,relforcerowsecurity})),
 types:c.columns.map(({table,name,type,position})=>({table,name,type,position})),
 core_columns:c.columns.filter(c=>['api_tokens','audit_log','audit_chain_head'].includes(c.table)),
 constraints:c.constraints.filter(c=>['api_tokens','audit_log','audit_chain_head'].includes(c.table)),
 indexes:c.indexes.filter(c=>c.table==='api_tokens'),
 policies:c.policies.filter(c=>c.tablename==='api_tokens'),
 triggers:c.triggers.filter(c=>['api_tokens','audit_log'].includes(c.table)).map(({table,name,enabled,definition,helper})=>({table,name,enabled,definition,md5:createHash('md5').update(helper).digest('hex')}))}));
const matches=expected.map(e=>`actual=${literal(JSON.stringify(e))}::jsonb`).join(' OR ');
const guard=`DO $catalog_guard$
DECLARE actual jsonb;
BEGIN
 SELECT captured.actual INTO actual FROM (${dependencyQuery}) captured;
 IF NOT (${matches}) THEN
   RAISE EXCEPTION 'reconciliation API dependency catalog drift; recapture and requalify';
 END IF;
 IF to_regprocedure('public.read_reconciliation_runs_for_api(uuid,uuid,text,uuid,text,uuid,integer,integer,text,uuid)') IS NOT NULL
   OR to_regprocedure('public.issue_user_delegated_api_token(uuid,text,text,text,text[],timestamp with time zone)') IS NOT NULL
   OR to_regprocedure('private.guard_qualified_api_token_identity()') IS NOT NULL THEN
   RAISE EXCEPTION 'reconciliation API forward object collision';
 END IF;
END $catalog_guard$;`;
const copyResult=(name,privateName)=>{
 let definition=helper(name).replace(`CREATE OR REPLACE FUNCTION public.${name}`,`CREATE FUNCTION private.${privateName}`);
 // Retain the exact captured query semantics; authorization lives only in the
 // enclosing purpose RPC. This helper has no role grants or JWT context changes.
 definition=definition.replace(/  IF NOT EXISTS \(SELECT 1 FROM public\.tenant_members m[\s\S]*?END IF;\n/u,'');
 definition=definition.replace(/  SELECT r\.definition_id INTO definition_id[\s\S]*?END IF;\n/u,'');
 if(/auth\.uid\(|user_can_access_recon\(/u.test(definition))throw Error('Unexpected result context dependency');
 definition=definition.replace("SET search_path TO 'public', 'pg_temp'","SET search_path TO 'pg_catalog', 'public', 'private'");
 return definition+';\n';
};
const scopesSource=readFileSync('src/lib/api-token-scopes.ts','utf8');
const scopes=[...scopesSource.matchAll(/id: "([a-z][a-z:.\-]+)"/gu)].map(m=>m[1]);
if(!scopes.includes('recons.read')||new Set(scopes).size!==scopes.length)throw Error('Explicit issuance scope catalog invalid');
const tokenSql=readFileSync('scripts/public-recon-read-token-forward.inc.sql','utf8').replace('__SUPPORTED_SCOPES__',scopes.map(literal).join(',')).replace('__SCOPE_COUNT__',String(scopes.length));
const readSql=readFileSync('scripts/public-recon-read-port-forward.inc.sql','utf8');
const sql=`-- Curie — bounded forward implementation, NOT APPLIED/DEPLOYED.
-- Exact PG17 metadata guarded; historical tokens/identities/records are not relabelled.
-- Existing unclassified/machine/delegated-other-subject tokens deny this purpose.
BEGIN;
${guard}
${tokenSql}
${copyResult('get_recon_run_result_page','recon_api_persisted_result_page')}
REVOKE ALL ON FUNCTION private.recon_api_persisted_result_page(uuid,uuid,integer,text) FROM PUBLIC,anon,authenticated,service_role;
${copyResult('get_recon_run_result_status_counts','recon_api_persisted_result_counts')}
REVOKE ALL ON FUNCTION private.recon_api_persisted_result_counts(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
${readSql}
COMMIT;
`;
writeFileSync('docs/openapi/proposed/reconciliation-run-read.forward.sql',sql);
writeFileSync('supabase/migrations/20261003153000_public_reconciliation_run_read.sql',sql);
writeFileSync('scripts/public-recon-read-dependency-guard-20261003.sql',`-- READ ONLY. Exact consumed security/read metadata from parent captures.\nSELECT ${matches} AS exact_dependencies_match FROM (${dependencyQuery}) captured;\n`);
writeFileSync('scripts/public-recon-read-current-guard-20261003.sql',`-- Read-only parent guard. A false match requires requalification, never normalization.
SELECT captured.metadata_fingerprint, captured.metadata_fingerprint IN (${captures.map(c=>literal(c.fingerprint)).join(',')}) AS exact_preimage_matches,
captured.catalog->'ledger' AS ledger,captured.catalog->>'latest' AS latest,captured.catalog->>'engine' AS engine
FROM (${request}) captured;
`);
console.log(JSON.stringify({sqlSha256:createHash('sha256').update(sql).digest('hex'),fingerprints:captures.map(c=>({environment:c.environment,fingerprint:c.fingerprint})),bytes:Buffer.byteLength(sql)}));
