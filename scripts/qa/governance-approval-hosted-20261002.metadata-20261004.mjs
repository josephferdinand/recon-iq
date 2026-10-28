// Metadata only. No caller-claim injection, SET ROLE, grants or SQL apply.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { credential, own } from "./governance-approval-hosted-20261002.release-20261004.mjs";
const query = `SELECT jsonb_build_object('captured_at',clock_timestamp(),'settings',jsonb_build_object('statement_timeout',current_setting('statement_timeout'),'lock_timeout',current_setting('lock_timeout')),
'functions',(SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'identity',pg_get_function_identity_arguments(p.oid),'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl,'body',p.prosrc,'definition',pg_get_functiondef(p.oid))) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='public' AND p.proname IN ('withdraw_governance_membership_request','decide_governance_membership_request','get_governance_membership_request','governance_access_review_decide','governance_access_review_campaign_create','governance_access_review_get')) OR (n.nspname='private' AND p.proname IN ('governance_membership_lock_scope','governance_membership_active','governance_review_snapshot'))),
'roles',(SELECT jsonb_agg(jsonb_build_object('role',rolname,'config',rolconfig)) FROM pg_roles WHERE rolname IN ('authenticator','authenticated','postgres')),
'activity',(SELECT jsonb_agg(jsonb_build_object('pid',pid,'user',usename,'application',application_name,'state',state,'wait_type',wait_event_type,'wait_event',wait_event,'query_age',clock_timestamp()-query_start,'blocking_pids',pg_blocking_pids(pid))) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND (query ILIKE '%withdraw_governance_membership_request%' OR query ILIKE '%get_governance_membership_request%'))) AS metadata;`;
const token = await credential("SUPABASE_ACCESS_TOKEN");
const env=process.env.FVI_GOVERNANCE_CATALOG_ENV??"PROD";
const ref=env==="PROD"?"YOUR_PROJECT_REF":env==="DEV"?"YOUR_PROJECT_REF":null;if(!ref)throw new Error("Metadata target invalid");
const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query, read_only: true }), signal: AbortSignal.timeout(20000) });
if (!response.ok) throw new Error(`Read-only governance metadata refused HTTP${response.status}`);
const result = await response.json();
const file = path.join(own, `${env}-REFUSAL-METADATA-${new Date().toISOString().replaceAll(/[:.]/gu,"-")}.json`);
await writeFile(file, JSON.stringify({ at: new Date().toISOString(), read_only: true, query, result }, null, 2), { flag: "wx" });
console.log(JSON.stringify({ read_only: true, http: response.status, evidence: file, returned_shape: Array.isArray(result) ? { rows: result.length, keys: Object.keys(result[0] ?? {}) } : { keys: Object.keys(result) } }));
