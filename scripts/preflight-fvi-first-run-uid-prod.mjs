import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseCanonicalVault } from "./preflight-fvi-resource-identity-release.mjs";

const projectRef = "YOUR_PROJECT_REF";
const version = "20260923090000";
const postApply = process.argv.includes("--post-apply");
const vaultPath = process.env.FVI_VAULT_PATH ?? "";
if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md") {
  throw new Error("Set FVI_VAULT_PATH to the canonical secured vault");
}
const token = parseCanonicalVault(await readFile(vaultPath, "utf8"));
const source = await readFile(`supabase/migrations/${version}_uppercase_recon_run_uid.sql`);
const sourceHash = createHash("sha256").update(source).digest("hex");

async function management(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { authorization: `Bearer ${token}`, ...options.headers },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Management read failed: HTTP ${response.status}`);
  return response.json();
}

const query = `
select jsonb_build_object(
  'latest', (select max(version::text) from supabase_migrations.schema_migrations),
  'ledgered', exists(select 1 from supabase_migrations.schema_migrations where version::text='${version}'),
  'function_def', pg_get_functiondef(p.oid),
  'function_owner', pg_get_userbyid(p.proowner),
  'function_security_definer', p.prosecdef,
  'function_volatility', p.provolatile,
  'function_config', p.proconfig,
  'function_acl', coalesce(p.proacl::text, ''),
  'trigger_name', t.tgname,
  'trigger_enabled', t.tgenabled,
  'trigger_def', pg_get_triggerdef(t.oid),
  'run_uid_type', format_type(a.atttypid,a.atttypmod),
  'index_def', pg_get_indexdef(i.indexrelid),
  'index_valid', i.indisvalid,
  'index_unique', i.indisunique,
  'index_predicate', pg_get_expr(i.indpred,i.indrelid),
  'case_duplicate_groups', (select count(*) from (
    select upper(run_uid) from public.recon_runs where run_uid is not null
    group by upper(run_uid) having count(*) > 1
  ) duplicate_groups),
  'search_path', current_setting('search_path'),
  'server_version_num', current_setting('server_version_num')
) as state
from pg_proc p
left join pg_trigger t on t.tgfoid=p.oid
  and t.tgrelid='public.recon_runs'::regclass
  and t.tgname='recon_runs_set_uid' and not t.tgisinternal
left join pg_class c on c.oid='public.recon_runs'::regclass
left join pg_attribute a on a.attrelid=c.oid and a.attname='run_uid' and not a.attisdropped
left join pg_class index_class on index_class.relname='recon_runs_run_uid_idx'
  and index_class.relnamespace='public'::regnamespace
left join pg_index i on i.indexrelid=index_class.oid and i.indrelid=c.oid
where p.oid='public.tg_recon_run_uid()'::regprocedure`;

const [queryResult, backupResult] = await Promise.all([
  management(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, read_only: true }),
  }),
  management(`https://api.supabase.com/v1/projects/${projectRef}/database/backups`),
]);
const state = Array.isArray(queryResult) ? queryResult[0]?.state : queryResult?.state;
if (!state) throw new Error("Run UID metadata response is incomplete");
const latestBackup = Array.isArray(backupResult.backups)
  ? [...backupResult.backups].filter((backup) => backup.status === "COMPLETED")
    .sort((left, right) => String(right.inserted_at).localeCompare(String(left.inserted_at)))[0]
  : undefined;
const functionDef = state.function_def ?? "";
const checks = {
  expected_source_hash: sourceHash === "e90c41f6dc2c2cb9b7df33e8384a731da85e76482973cde5696c8fff8c72e5eb",
  expected_ledger_state: postApply
    ? state.latest === version && state.ledgered === true
    : state.latest === "20260921120000" && state.ledgered === false,
  expected_generator: postApply
    ? /substr\([^;]+,\s*1,\s*16\)/u.test(functionDef)
    : /substr\([^;]+,\s*1,\s*8\)/u.test(functionDef) && !/substr\([^;]+,\s*1,\s*16\)/u.test(functionDef),
  trigger_attached: state.trigger_name === "recon_runs_set_uid" && ["O", "A"].includes(state.trigger_enabled)
    && /BEFORE INSERT ON public\.recon_runs/iu.test(state.trigger_def ?? ""),
  run_uid_text: state.run_uid_type === "text",
  unique_index: state.index_unique === true && state.index_valid === true
    && /UNIQUE INDEX recon_runs_run_uid_idx ON public\.recon_runs/iu.test(state.index_def ?? "")
    && /run_uid IS NOT NULL/iu.test(state.index_predicate ?? ""),
  no_case_duplicates: Number(state.case_duplicate_groups) === 0,
  invoker_function: state.function_security_definer === false,
  completed_backup: !!latestBackup,
};
console.log(JSON.stringify({
  ok: Object.values(checks).every(Boolean),
  mode: postApply ? "post_apply" : "pre_apply",
  project_ref: projectRef,
  version,
  source_sha256: sourceHash,
  latest_ledger: state.latest,
  function_sha256: createHash("sha256").update(functionDef).digest("hex"),
  function_owner: state.function_owner,
  function_acl: state.function_acl,
  function_config: state.function_config,
  function_volatility: state.function_volatility,
  trigger_definition: state.trigger_def,
  unique_index_definition: state.index_def,
  latest_completed_backup_at: latestBackup?.inserted_at ?? null,
  pitr_enabled: backupResult.pitr_enabled,
  checks,
  ...(process.argv.includes("--include-prior-function") ? { prior_function_definition: functionDef } : {}),
}, null, 2));
if (!Object.values(checks).every(Boolean)) process.exitCode = 2;
