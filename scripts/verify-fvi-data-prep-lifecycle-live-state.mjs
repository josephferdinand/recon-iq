import { readFile } from "node:fs/promises";
import path from "node:path";

const targetName = process.env.FVI_DATA_PREP_TARGET ?? "";
const targets = { prod: "YOUR_PROJECT_REF", dev: "YOUR_PROJECT_REF" };
const projectRef = targets[targetName];
const pipelineName = process.env.FVI_DATA_PREP_PIPELINE_NAME ?? "";
const patFile = process.env.FVI_SUPABASE_PAT_FILE ?? "";

if (!projectRef) throw new Error("FVI_DATA_PREP_TARGET must be prod or dev");
if (!pipelineName || pipelineName.length > 120) {
  throw new Error("FVI_DATA_PREP_PIPELINE_NAME must identify one retained pipeline");
}
if (!path.isAbsolute(patFile)) {
  throw new Error("FVI_SUPABASE_PAT_FILE must be an absolute protected file");
}

const accessToken = (await readFile(patFile, "utf8")).trim();
if (!/^sbp_[A-Za-z0-9_-]{20,}$/u.test(accessToken)) {
  throw new Error("Protected Management API token is unavailable");
}

const escapedName = pipelineName.replaceAll("'", "''");
const sql = `
with production as (
  select id,tenant_id,created_by,approved_by,promoted_by,version,status,lifecycle_state,promoted_from_id
  from public.data_prep_pipelines where name='${escapedName}'
), staging as (
  select id,tenant_id,created_by,approved_by,promotion_requested_by,status,lifecycle_state,promotion_status,parent_pipeline_id
  from public.data_prep_pipelines where name='${escapedName.replaceAll("'", "''")} (staging)'
), actions as (
  select action,actor_user_id,row_hash from public.audit_log
  where resource_type='data_prep_pipeline'
    and resource_id in (select id::text from production union all select id::text from staging)
), approvals as (
  select a.approver_id,a.decision from public.dp_promotion_approvals a join staging s on s.id=a.staging_pipeline_id
)
select
  (select count(*) from production)::integer as production_rows,
  (select count(*) from staging)::integer as staging_rows,
  coalesce((select status='approved' and lifecycle_state='production' and version=2 from production),false) as production_final,
  coalesce((select status='archived' and lifecycle_state='archived' and promotion_status='approved' from staging),false) as staging_final,
  coalesce((select created_by is distinct from approved_by and created_by is distinct from promoted_by from production),false) as production_four_eyes,
  coalesce((select created_by is distinct from approved_by and promotion_requested_by is distinct from (select approver_id from approvals limit 1) from staging),false) as staging_four_eyes,
  coalesce((select promoted_from_id=(select id from staging) from production),false) as lineage_bound,
  coalesce((select parent_pipeline_id=(select id from production) from staging),false) as parent_bound,
  (select count(*) from approvals where decision='approve')::integer as approval_rows,
  (select count(*) from actions)::integer as audit_rows,
  (select count(*) from actions where row_hash is not null)::integer as hashed_audit_rows,
  (select count(distinct action) from actions where action in (
    'data_prep.create','data_prep.approve','data_prep.clone_as_staging',
    'data_prep.request_promotion','data_prep.promote'
  ))::integer as required_action_types`;

const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ query: sql, read_only: true }),
});
const raw = await response.text();
if (!response.ok) {
  let detail = "query_rejected";
  try {
    const parsed = JSON.parse(raw);
    detail = String(parsed.message ?? parsed.error ?? detail).slice(0, 500);
  } catch {
    // Preserve a stable non-sensitive fallback.
  }
  throw new Error(
    `Read-only lifecycle verification failed with HTTP ${response.status}: ${detail}`,
  );
}
const result = JSON.parse(raw)[0];
const checks = {
  exact_rows: result.production_rows === 1 && result.staging_rows === 1,
  production_final: result.production_final === true,
  staging_final: result.staging_final === true,
  maker_checker_distinct: result.production_four_eyes === true && result.staging_four_eyes === true,
  lineage_bound: result.lineage_bound === true && result.parent_bound === true,
  approval_retained: result.approval_rows === 1,
  audit_complete:
    result.audit_rows >= 6 &&
    result.hashed_audit_rows === result.audit_rows &&
    result.required_action_types === 5,
};

if (Object.values(checks).some((value) => !value)) {
  console.error(JSON.stringify({ ok: false, target: targetName, checks, counts: result }));
  process.exit(1);
}
console.log(
  JSON.stringify({
    ok: true,
    target: targetName,
    read_only: true,
    checks,
    audit_rows: result.audit_rows,
    required_action_types: result.required_action_types,
  }),
);
