import { readFile } from "node:fs/promises";
import path from "node:path";

const PROD_REF = "YOUR_PROJECT_REF";
const TENANT_SLUG = "reconiq-assurance-lab-prod";
const SOURCE_NAMES = [
  "Assurance S2A — Internal cash ledger",
  "Assurance S2B — Bank nostro statement",
];
const REQUIRED_COLUMNS = ["amount", "currency", "reference", "value_date"];

const vaultPath = process.env.FVI_VAULT_PATH ?? "";
if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md") {
  throw new Error("FVI_VAULT_PATH must be the absolute canonical Falcon-Veritas-Keys.md path");
}

function unwrapKnownMarkdown(value) {
  let normalized = value.trim();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (normalized.startsWith("`") && normalized.endsWith("`")) {
      normalized = normalized.slice(1, -1).trim();
      continue;
    }
    if (normalized.startsWith("<") && normalized.endsWith(">")) {
      normalized = normalized.slice(1, -1).trim();
      continue;
    }
    break;
  }
  return normalized;
}

const vault = await readFile(vaultPath, "utf8");
const beginMarker = "<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->";
const endMarker = "<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->";
const begin = vault.indexOf(beginMarker);
const end = vault.indexOf(endMarker);
if (begin < 0 || end <= begin) throw new Error("Canonical FVI credential section is unavailable");

const tokenRow = vault
  .slice(begin + beginMarker.length, end)
  .split(/\r?\n/u)
  .find((line) => /^\|\s*`SUPABASE_ACCESS_TOKEN`\s*\|/u.test(line));
const accessToken = unwrapKnownMarkdown(tokenRow?.split("|")[2] ?? "");
if (!accessToken) throw new Error("FVI Supabase Management credential is unavailable");

const sql = `WITH target_tenant AS MATERIALIZED (
  SELECT tenant.id, tenant.slug, tenant.environment::text AS environment
  FROM public.tenants tenant
  WHERE tenant.slug = '${TENANT_SLUG}'
  LIMIT 1
), active_admins AS MATERIALIZED (
  SELECT
    membership.user_id,
    COALESCE(lower(identity.raw_user_meta_data->>'synthetic_test_identity') = 'true', false)
      AS synthetic_test_identity,
    (
      SELECT count(*)::integer
      FROM auth.mfa_factors factor
      WHERE factor.user_id = membership.user_id
        AND factor.status = 'verified'
    ) AS verified_mfa_factor_count
  FROM target_tenant tenant
  JOIN public.tenant_members membership
    ON membership.tenant_id = tenant.id
   AND membership.active
   AND membership.role = 'tenant_admin'
  JOIN auth.users identity ON identity.id = membership.user_id
), wanted_sources(source_name, ordinal) AS (
  VALUES
    ('Assurance S2A — Internal cash ledger', 1),
    ('Assurance S2B — Bank nostro statement', 2)
), source_prerequisites AS MATERIALIZED (
  SELECT
    wanted.source_name AS name,
    source.id,
    source.row_count AS source_row_count,
    upload.id AS latest_upload_id,
    upload.row_count AS latest_upload_row_count,
    CASE
      WHEN jsonb_typeof(upload.rows) = 'array' THEN jsonb_array_length(upload.rows)
      ELSE NULL
    END AS latest_upload_array_row_count,
    CASE
      WHEN jsonb_typeof(upload.columns) = 'array' THEN COALESCE((
        SELECT jsonb_agg(normalized.column_name ORDER BY normalized.ordinal)
        FROM (
          SELECT
            column_value.ordinal,
            CASE jsonb_typeof(column_value.value)
              WHEN 'string' THEN column_value.value #>> '{}'
              WHEN 'object' THEN COALESCE(
                column_value.value->>'name',
                column_value.value->>'column_name'
              )
              ELSE NULL
            END AS column_name
          FROM jsonb_array_elements(upload.columns) WITH ORDINALITY
            AS column_value(value, ordinal)
        ) normalized
        WHERE NULLIF(normalized.column_name, '') IS NOT NULL
      ), '[]'::jsonb)
      WHEN jsonb_typeof(upload.columns) = 'object' THEN COALESCE((
        SELECT jsonb_agg(column_name ORDER BY column_name)
        FROM jsonb_object_keys(upload.columns) column_name
      ), '[]'::jsonb)
      ELSE '[]'::jsonb
    END AS column_names
  FROM target_tenant tenant
  CROSS JOIN wanted_sources wanted
  LEFT JOIN LATERAL (
    SELECT candidate.id, candidate.row_count
    FROM public.workspace_data_sources candidate
    WHERE candidate.tenant_id = tenant.id
      AND candidate.name = wanted.source_name
    ORDER BY candidate.updated_at DESC, candidate.id
    LIMIT 1
  ) source ON true
  LEFT JOIN LATERAL (
    SELECT candidate.id, candidate.row_count, candidate.rows, candidate.columns
    FROM public.workspace_data_source_uploads candidate
    WHERE candidate.tenant_id = tenant.id
      AND candidate.data_source_id = source.id
    ORDER BY candidate.created_at DESC, candidate.id DESC
    LIMIT 1
  ) upload ON true
)
SELECT jsonb_build_object(
  'tenant', jsonb_build_object(
    'id', tenant.id,
    'slug', tenant.slug,
    'environment', tenant.environment
  ),
  'active_tenant_admins', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'user_id', admin.user_id,
      'synthetic_test_identity', admin.synthetic_test_identity,
      'verified_mfa_factor_count', admin.verified_mfa_factor_count
    ) ORDER BY admin.user_id)
    FROM active_admins admin
  ), '[]'::jsonb),
  'sources', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'name', source.name,
      'id', source.id,
      'source_row_count', source.source_row_count,
      'latest_upload_id', source.latest_upload_id,
      'latest_upload_row_count', source.latest_upload_row_count,
      'latest_upload_array_row_count', source.latest_upload_array_row_count,
      'column_names', source.column_names
    ) ORDER BY source.name)
    FROM source_prerequisites source
  ), '[]'::jsonb),
  'rate_limit_hit_execute', jsonb_build_object(
    'service_role', has_function_privilege(
      'service_role', 'public.rate_limit_hit(text,integer,integer)', 'EXECUTE'
    ),
    'authenticated', has_function_privilege(
      'authenticated', 'public.rate_limit_hit(text,integer,integer)', 'EXECUTE'
    ),
    'anon', has_function_privilege(
      'anon', 'public.rate_limit_hit(text,integer,integer)', 'EXECUTE'
    )
  ),
  'native_workflow_dispatch_schedule_count', (
    SELECT count(*)::integer FROM cron.job
    WHERE active AND command LIKE '%/cron/workflow-jobs%'
  ),
  'workflow_queue_counts', (
    SELECT jsonb_build_object(
      'queued_total', count(*) FILTER (WHERE status = 'queued'),
      'queued_outside_assurance', count(*) FILTER (WHERE status = 'queued' AND tenant_id <> tenant.id),
      'running_total', count(*) FILTER (WHERE status = 'running')
    ) FROM public.workflow_api_jobs
  ),
  'pre_activation_job_statuses', (
    SELECT COALESCE(jsonb_object_agg(disposition.status, disposition.jobs), '{}'::jsonb)
    FROM (
      SELECT job.status, count(*)::integer AS jobs
      FROM public.workflow_api_jobs job
      WHERE job.tenant_id = tenant.id
        AND job.created_at < '2026-09-14T20:46:00Z'::timestamptz
        AND job.updated_at >= '2026-09-14T20:46:00Z'::timestamptz
      GROUP BY job.status
    ) disposition
  )
) AS prerequisites
FROM target_tenant tenant`;

const response = await fetch(
  `https://api.supabase.com/v1/projects/${PROD_REF}/database/query`,
  {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query: sql, read_only: true }),
    signal: AbortSignal.timeout(30_000),
  },
);
if (!response.ok) {
  throw new Error(`FVI template prerequisite query failed with HTTP ${response.status}`);
}

const rows = await response.json();
const raw = Array.isArray(rows) ? rows[0]?.prerequisites : null;
if (!raw || raw.tenant?.slug !== TENANT_SLUG || raw.tenant?.environment !== "prod") {
  throw new Error("Expected PROD Assurance tenant was not returned");
}

const activeTenantAdmins = Array.isArray(raw.active_tenant_admins)
  ? raw.active_tenant_admins.map((admin) => ({
      user_id: String(admin.user_id),
      synthetic_test_identity: admin.synthetic_test_identity === true,
      verified_mfa_factor_count: Number(admin.verified_mfa_factor_count ?? 0),
    }))
  : [];
const sources = Array.isArray(raw.sources)
  ? raw.sources.map((source) => ({
      name: String(source.name),
      id: source.id == null ? null : String(source.id),
      source_row_count: source.source_row_count == null ? null : Number(source.source_row_count),
      latest_upload_id: source.latest_upload_id == null ? null : String(source.latest_upload_id),
      latest_upload_row_count:
        source.latest_upload_row_count == null ? null : Number(source.latest_upload_row_count),
      latest_upload_array_row_count:
        source.latest_upload_array_row_count == null
          ? null
          : Number(source.latest_upload_array_row_count),
      column_names: Array.isArray(source.column_names)
        ? source.column_names.map((column) => String(column))
        : [],
    }))
  : [];
const privileges = {
  service_role: raw.rate_limit_hit_execute?.service_role === true,
  authenticated: raw.rate_limit_hit_execute?.authenticated === true,
  anon: raw.rate_limit_hit_execute?.anon === true,
};

const twoAdminsWithVerifiedMfa =
  activeTenantAdmins.filter((admin) => admin.verified_mfa_factor_count > 0).length >= 2;
const sourceIds = sources.map((source) => source.id).filter(Boolean);
const sourcesReady =
  sources.length === SOURCE_NAMES.length &&
  sources.every(
    (source) =>
      SOURCE_NAMES.includes(source.name) &&
      source.id &&
      source.latest_upload_id &&
      Number(source.source_row_count) > 0 &&
      Number(source.latest_upload_row_count) > 0 &&
      source.latest_upload_row_count === source.latest_upload_array_row_count &&
      REQUIRED_COLUMNS.every((column) => source.column_names.includes(column)),
  ) &&
  new Set(sourceIds).size === SOURCE_NAMES.length;
const rateLimitPrivilegesExpected =
  privileges.service_role && !privileges.authenticated && !privileges.anon;

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      read_only: true,
      project_ref: PROD_REF,
      tenant: {
        id: String(raw.tenant.id),
        slug: String(raw.tenant.slug),
        environment: String(raw.tenant.environment),
      },
      active_tenant_admins: activeTenantAdmins,
      sources,
      rate_limit_hit_execute: privileges,
      native_workflow_dispatch_schedule_count: Number(raw.native_workflow_dispatch_schedule_count),
      workflow_queue_counts: {
        queued_total: Number(raw.workflow_queue_counts?.queued_total),
        queued_outside_assurance: Number(raw.workflow_queue_counts?.queued_outside_assurance),
        running_total: Number(raw.workflow_queue_counts?.running_total),
      },
      pre_activation_job_statuses: Object.fromEntries(
        Object.entries(raw.pre_activation_job_statuses ?? {})
          .filter(([status]) => /^[a-z_]+$/iu.test(status))
          .map(([status, count]) => [status, Number(count)]),
      ),
      prerequisites: {
        two_active_tenant_admins_with_verified_mfa: twoAdminsWithVerifiedMfa,
        retained_sources_ready: sourcesReady,
        rate_limit_privileges_expected: rateLimitPrivilegesExpected,
        ready_for_retained_template_workflow:
          twoAdminsWithVerifiedMfa && sourcesReady && rateLimitPrivilegesExpected,
      },
      credential_value_exposed: false,
    },
    null,
    2,
  )}\n`,
);
