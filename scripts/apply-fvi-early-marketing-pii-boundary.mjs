import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const VERSION = "20260923090200";
export const NAME = "marketing_lead_pii_read_boundary_early";
export const PROJECT_REF = "YOUR_PROJECT_REF";
export const SOURCE_SHA256 = "39b42c99de637c23470914c45fb55b3e0dce8dffb97a6caef3166049fbc3c32e";
const PREDECESSOR = "20260923090100";
const BOUNDARY = "mkt_pii_human_role_boundary";
const AUDIT_BOUNDARY = "mkt_lead_pii_audit_boundary";
export const TABLES = ["mkt_leads", "mkt_lead_files", "mkt_lead_notes", "mkt_lead_tasks",
  "mkt_lead_activity", "mkt_appointments", "mkt_chat_sessions", "mkt_chat_messages",
  "mkt_kb_queries", "mkt_llm_usage", "mkt_cta_events", "mkt_content_audit_log"];
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const tableList = TABLES.map(literal).join(",");
const rawPoliciesSql = `select coalesce(jsonb_agg(jsonb_build_object(
  'table',tablename,'name',policyname,'cmd',cmd,'roles',roles,
  'permissive',permissive,'qual',qual,'check',with_check)
  order by tablename,policyname),'[]'::jsonb)
  from pg_policies where schemaname='public' and tablename in (${tableList})`;
const restrictedPoliciesSql = `${rawPoliciesSql} and policyname in ('${BOUNDARY}','${AUDIT_BOUNDARY}')`;
export const STATE_SQL = `select jsonb_build_object(
  'latest',(select max(version::text) from supabase_migrations.schema_migrations),
  'ledger',(select jsonb_build_object('name',name,'statements',statements)
    from supabase_migrations.schema_migrations where version::text='${VERSION}'),
  'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,
    'auth_select',has_table_privilege('authenticated',c.oid,'SELECT'),
    'service_select',has_table_privilege('service_role',c.oid,'SELECT'),
    'service_insert',has_table_privilege('service_role',c.oid,'INSERT')) order by c.relname)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in (${tableList}) and c.relkind in ('r','p')),
  'policies',(${rawPoliciesSql}),
  'has_role',to_regprocedure('public.has_mkt_role(uuid,public.mkt_admin_role)') is not null,
  'helper_execute',has_function_privilege('authenticated','public.has_mkt_role(uuid,public.mkt_admin_role)','EXECUTE'),
  'profile_select',has_table_privilege('authenticated','public.mkt_admin_users','SELECT'),
  'active_human_count',(select count(distinct r.user_id) from public.mkt_admin_roles r
    join public.mkt_admin_users u on u.user_id=r.user_id and u.status='active'
    where r.role::text in ('super_admin','sales_admin','marketing_admin')),
  'blocked_human_count',(select count(distinct r.user_id) from public.mkt_admin_roles r
    left join public.mkt_admin_users u on u.user_id=r.user_id
    where r.role::text in ('super_admin','sales_admin','marketing_admin')
      and (u.user_id is null or u.status<>'active')),
  'service_bypass',(select rolbypassrls from pg_roles where rolname='service_role')
) as state`;

const anyRole = "has_any_mkt_role(auth.uid())";
const sales = "has_mkt_role(auth.uid(), 'super_admin'::mkt_admin_role) OR has_mkt_role(auth.uid(), 'sales_admin'::mkt_admin_role)";
const auditRoles = `${sales} OR has_mkt_role(auth.uid(), 'marketing_admin'::mkt_admin_role) OR has_mkt_role(auth.uid(), 'ai_admin'::mkt_admin_role)`;
export const ORIGINAL_POLICIES = [
  ["mkt_leads","mkt_leads_admin_read","SELECT",anyRole,null],
  ["mkt_leads","mkt_leads_admin_write","ALL",sales,sales],
  ...["mkt_lead_files","mkt_lead_notes","mkt_lead_tasks","mkt_appointments"].map((table) => [table,`${table}_admin`,"ALL",anyRole,anyRole]),
  ["mkt_lead_activity","mkt_lead_activity_read","SELECT",anyRole,null],
  ["mkt_lead_activity","mkt_lead_activity_insert","INSERT",null,anyRole],
  ["mkt_chat_sessions","mkt_chat_sessions_admin","SELECT",anyRole,null],
  ["mkt_chat_messages","mkt_chat_messages_admin_read","SELECT",anyRole,null],
  ["mkt_kb_queries","mkt_kb_queries_admin_read","SELECT",anyRole,null],
  ["mkt_llm_usage","mkt_llm_usage_admin_read","SELECT",anyRole,null],
  ["mkt_cta_events","mkt_cta_events_admin_read","SELECT",anyRole,null],
  ["mkt_cta_events","mkt_cta_events_admin_write","ALL",anyRole,anyRole],
  ["mkt_content_audit_log","mkt admins read audit log","SELECT",auditRoles,null],
  ["mkt_content_audit_log","no direct writes to audit log","INSERT",null,"false"],
];

// Only strip redundant enclosing parentheses, preserving expression grouping.
function normalizePredicate(value) {
  if (value == null) return null;
  let result = value.replace(/\bpublic\./gu, "").replace(/\s+/gu, "");
  while (result.startsWith("(") && result.endsWith(")")) {
    let depth=0; let encloses=true;
    for (let i=0; i<result.length-1; i++) {
      if (result[i]==="(") depth++;
      if (result[i]===")") depth--;
      if (depth===0) { encloses=false; break; }
    }
    if (!encloses) break;
    result=result.slice(1,-1);
  }
  return result;
}
function isBoundary(policy) { return [BOUNDARY,AUDIT_BOUNDARY].includes(policy.name); }
function stablePolicies(policies) {
  return [...policies].sort((a,b) => `${a.table}/${a.name}`.localeCompare(`${b.table}/${b.name}`));
}
export function assessState(state, backupFresh, allowEmptyOperator=false) {
  if (!state || !backupFresh || !state.has_role || !state.helper_execute || !state.profile_select
    || !state.service_bypass || (!allowEmptyOperator && !(state.active_human_count > 0))
    || !Array.isArray(state.tables) || state.tables.length!==12
    || !TABLES.every((table) => state.tables.some((row) => row.name===table && row.rls
      && row.auth_select && row.service_select && row.service_insert))) {
    throw new Error("Marketing PII table/RLS/role/active-profile/service/backup prerequisites failed");
  }
  const originals = state.policies.filter((policy) => !isBoundary(policy));
  if (originals.length!==ORIGINAL_POLICIES.length || !ORIGINAL_POLICIES.every(([table,name,cmd,qual,check]) => {
    const actual=originals.find((policy) => policy.table===table && policy.name===name);
    return actual && actual.cmd===cmd && actual.permissive==="PERMISSIVE"
      && JSON.stringify(actual.roles)===JSON.stringify(["authenticated"])
      && normalizePredicate(actual.qual)===normalizePredicate(qual)
      && normalizePredicate(actual.check)===normalizePredicate(check);
  })) throw new Error("Marketing PII original policy state differs from reviewed predecessor");
  if (state.latest===PREDECESSOR && !state.ledger && !state.policies.some(isBoundary)) return "ready";
  if (state.latest===VERSION && state.ledger?.name===NAME
    && state.ledger.statements?.[0]===`FVI early marketing PII boundary; sha256=${SOURCE_SHA256}`) {
    let recorded;
    try { recorded=JSON.parse(state.ledger.statements[1]); } catch { /* fail closed below */ }
    const boundaries=state.policies.filter(isBoundary);
    if (boundaries.length===12 && Array.isArray(recorded) && recorded.length===12
      && JSON.stringify(stablePolicies(boundaries))===JSON.stringify(stablePolicies(recorded))
      && TABLES.every((table) => boundaries.some((policy) => policy.table===table
        && policy.name===(table==="mkt_content_audit_log" ? AUDIT_BOUNDARY : BOUNDARY)
        && policy.cmd===(table==="mkt_content_audit_log" ? "SELECT" : "ALL")
        && policy.permissive==="RESTRICTIVE" && JSON.stringify(policy.roles)==='["authenticated"]'))) return "installed";
  }
  throw new Error("Marketing PII exact predecessor/ledger/policy checksum readback failed");
}

export function buildApplySql(source, before) {
  if ((source.match(/^BEGIN;\r?$/gmu) ?? []).length!==1 || (source.match(/^COMMIT;\r?$/gmu) ?? []).length!==1) {
    throw new Error("Expected a single source transaction envelope");
  }
  const body=source.replace(/^BEGIN;\r?\n/mu, "").replace(/^COMMIT;\s*$/mu, "");
  const marker=`FVI early marketing PII boundary; sha256=${SOURCE_SHA256}`;
  return `BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='45s';
LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE ${TABLES.map((table)=>`public.${table}`).join(",")} IN SHARE ROW EXCLUSIVE MODE;
DO $preflight$ BEGIN
  IF (SELECT max(version::text) FROM supabase_migrations.schema_migrations) IS DISTINCT FROM '${PREDECESSOR}'
    OR (${rawPoliciesSql}) IS DISTINCT FROM ${literal(JSON.stringify(before.policies))}::jsonb THEN
    RAISE EXCEPTION 'Marketing PII state changed since preflight';
  END IF;
END $preflight$;
${body}
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
VALUES ('${VERSION}','${NAME}',ARRAY[${literal(marker)},(${restrictedPoliciesSql})::text]);
COMMIT;`;
}

export async function runInstaller({ env=process.env, readText=readFile, request=fetch, emit=console.log }={}) {
  const source=await readText(`supabase/migrations/${VERSION}_${NAME}.sql`, "utf8");
  if (createHash("sha256").update(source).digest("hex")!==SOURCE_SHA256) {
    throw new Error("Marketing PII migration checksum differs from locally verified source");
  }
  const vaultPath=env.FVI_VAULT_PATH ?? "";
  if (!path.isAbsolute(vaultPath) || path.basename(vaultPath)!=="Falcon-Veritas-Keys.md") {
    throw new Error("Set FVI_VAULT_PATH to the canonical secured vault");
  }
  const vault=await readText(vaultPath,"utf8");
  const begin=vault.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->");
  const end=vault.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->");
  if (begin<0 || end<=begin) throw new Error("Canonical credential section unavailable");
  const row=vault.slice(begin,end).split(/\r?\n/u).find((line)=>/^\|\s*`SUPABASE_ACCESS_TOKEN`\s*\|/u.test(line));
  const token=row?.split("|")[2]?.trim().replace(/^`|`$/gu,"");
  if (!/^sbp_[A-Za-z0-9_-]{20,}$/u.test(token ?? "")) throw new Error("Canonical Management access unavailable");
  async function management(endpoint, options={}) {
    const response=await request(`https://api.supabase.com/v1/projects/${PROJECT_REF}/${endpoint}`,{
      ...options, headers:{authorization:`Bearer ${token}`,...options.headers}, signal:AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Marketing PII Management HTTP ${response.status}`);
    return response.json();
  }
  const query=(statement, readOnly=true)=>management("database/query",{method:"POST",
    headers:{"content-type":"application/json"},body:JSON.stringify({query:statement,read_only:readOnly})});
  const [rows,backups]=await Promise.all([query(STATE_SQL),management("database/backups")]);
  const before=rows?.[0]?.state;
  const latestBackup=backups.backups?.filter((item)=>item.status==="COMPLETED")
    .sort((a,b)=>String(b.inserted_at).localeCompare(String(a.inserted_at)))[0];
  const age=Date.now()-Date.parse(String(latestBackup?.inserted_at));
  const fresh=Number.isFinite(age) && age>=0 && age<=24*60*60*1000;
  if (env.FVI_MKT_PII_PREFLIGHT_DIAGNOSTIC==="YES") {
    emit(JSON.stringify({preflight:true,ledger_latest:before?.latest,backup_fresh:fresh,
      table_count:before?.tables?.length,missing_table_privileges:TABLES.filter((table)=>
        !before?.tables?.some((row)=>row.name===table && row.rls && row.auth_select
          && row.service_select && row.service_insert)),has_role:before?.has_role,
      policy_count:before?.policies?.length,
      missing_original_policies:ORIGINAL_POLICIES.filter(([table,name])=>
        !before?.policies?.some((policy)=>policy.table===table && policy.name===name))
        .map(([table,name])=>`${table}/${name}`),
      helper_execute:before?.helper_execute,profile_select:before?.profile_select,
      active_human_count:before?.active_human_count,blocked_human_count:before?.blocked_human_count,
      service_bypass:before?.service_bypass}));
  }
  const allowEmptyOperator=env.FVI_ALLOW_EMPTY_MKT_OPERATOR==="YES";
  const state=assessState(before,fresh,allowEmptyOperator);
  const result={ok:true,target:"prod",project_ref:PROJECT_REF,version:VERSION,source_sha256:SOURCE_SHA256,
    active_human_count:before.active_human_count,blocked_human_count:before.blocked_human_count,
    queue_operator_ready:before.active_human_count>0,
    latest_completed_backup_at:latestBackup.inserted_at,pitr_enabled:backups.pitr_enabled};
  if (state==="installed") { emit(JSON.stringify({...result,reused:true,restrictive_policy_count:12})); return; }
  if (env.FVI_APPLY_EARLY_MKT_PII!=="YES") {
    emit(JSON.stringify({...result,dry_run:true,ledger_latest:before.latest,restrictive_policy_count:0})); return;
  }
  await query(buildApplySql(source,before),false);
  const after=(await query(STATE_SQL))?.[0]?.state;
  if (assessState(after,fresh,allowEmptyOperator)!=="installed") throw new Error("Marketing PII write returned without exact verified readback");
  emit(JSON.stringify({...result,applied:true,restrictive_policy_count:12}));
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  runInstaller().catch((error)=>{
    // No request bodies, provider response payloads, credentials or stack traces.
    const safe=error instanceof Error && /^(Marketing PII|Expected a single|Set FVI_VAULT_PATH|Canonical)/u.test(error.message)
      ? error.message : "Marketing PII installer failed; no sensitive diagnostic output emitted";
    console.error(safe); process.exitCode=1;
  });
}
