import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const projects = {
  prod: "YOUR_PROJECT_REF",
  dev: "YOUR_PROJECT_REF",
};
const patFile = process.env.FVI_SUPABASE_PAT_FILE ?? "";
const requestTitle = process.env.FVI_ENV_CHANGE_REQUEST_TITLE ?? "";
const schemaFiles = new Map([
  ["20260906014500", "20260906014500_add_connector_agent_queue.sql"],
  ["20260906061500", "20260906061500_harden_data_watchers.sql"],
  ["20260906110000", "20260906110000_harden_reference_data_import.sql"],
  ["20260906113000", "20260906113000_create_reference_data_versions.sql"],
  ["20260906114500", "20260906114500_reference_data_version_lifecycle.sql"],
  ["20260908173000", "20260908173000_govern_data_prep_lifecycle.sql"],
  ["20260908184500", "20260908184500_add_data_prep_ui_upsert_wrapper.sql"],
  ["20260908203000", "20260908203000_govern_environment_changes.sql"],
]);
if (process.env.FVI_ALLOW_ENV_CHANGE_PREFLIGHT !== "YES") {
  throw new Error("Set FVI_ALLOW_ENV_CHANGE_PREFLIGHT=YES");
}
if (!path.isAbsolute(patFile)) {
  throw new Error("FVI_SUPABASE_PAT_FILE must be an absolute protected file");
}
if (!requestTitle || requestTitle.length > 120) {
  throw new Error("FVI_ENV_CHANGE_REQUEST_TITLE must identify one request");
}
const accessToken = (await readFile(patFile, "utf8")).trim();
if (!/^sbp_[A-Za-z0-9_-]{20,}$/u.test(accessToken)) {
  throw new Error("Protected Management API token is unavailable");
}

async function query(projectRef, sql, readOnly) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: sql, read_only: readOnly }),
    },
  );
  const raw = await response.text();
  if (!response.ok) {
    let detail = "query_rejected";
    try {
      const parsed = JSON.parse(raw);
      detail = String(parsed.message ?? parsed.error ?? detail).slice(0, 500);
    } catch {
      // Preserve a stable non-sensitive fallback.
    }
    throw new Error(`Supabase Management API query failed with HTTP ${response.status}: ${detail}`);
  }
  return JSON.parse(raw);
}

const escapedTitle = requestTitle.replaceAll("'", "''");
const requests = await query(
  projects.prod,
  `select id,change_request_uid,direction,source_project_ref,source_tenant_id,target_project_ref,target_tenant_id,
    status,requested_by,manifest,package_hash,configuration_hash,settings_hash,manifest_hash
   from public.environment_change_requests where title='${escapedTitle}' order by requested_at desc limit 2`,
  true,
);
if (requests.length !== 1) throw new Error("Environment change request must resolve exactly once");
const request = requests[0];
if (request.status !== "pending_approval") {
  throw new Error("Environment change request is not pending preflight");
}
for (const value of [
  request.id,
  request.source_tenant_id,
  request.target_tenant_id,
  request.requested_by,
]) {
  if (!/^[0-9a-f-]{36}$/u.test(value)) throw new Error("Environment request identity is invalid");
}
if (![projects.prod, projects.dev].includes(request.source_project_ref)) {
  throw new Error("Source project is not registered");
}
if (![projects.prod, projects.dev].includes(request.target_project_ref)) {
  throw new Error("Target project is not registered");
}

const sourceRows = await query(
  request.source_project_ref,
  `select t.id,
    (select count(*)::integer from public.recon_definitions r where r.tenant_id=t.id) as reconciliations,
    (select count(*)::integer from public.data_prep_pipelines p where p.tenant_id=t.id and p.lifecycle_state<>'archived') as data_prep_pipelines,
    (select count(*)::integer from public.workspace_data_sources s where s.tenant_id=t.id) as data_sources,
    (select count(*)::integer from public.data_source_schedules s where s.tenant_id=t.id) as connector_schedules,
    (select count(*)::integer from public.data_watchers w where w.tenant_id=t.id) as watchers
   from public.tenants t where t.id='${request.source_tenant_id}'::uuid`,
  true,
);
const targetRows = await query(
  request.target_project_ref,
  `select id,slug,name,environment from public.tenants where id='${request.target_tenant_id}'::uuid`,
  true,
);
const source = sourceRows[0];
const manifest = request.manifest ?? {};
const expected = {
  reconciliations: Array.isArray(manifest.package?.recon_definitions)
    ? manifest.package.recon_definitions.length
    : Number(manifest.package?.reconciliations),
  data_prep_pipelines: Array.isArray(manifest.package?.data_prep_pipelines)
    ? manifest.package.data_prep_pipelines.length
    : Number(manifest.package?.data_prep_pipelines),
  data_sources: Array.isArray(manifest.configuration?.data_sources)
    ? manifest.configuration.data_sources.length
    : Number(manifest.configuration?.data_sources),
  connector_schedules: Array.isArray(manifest.configuration?.connector_schedules)
    ? manifest.configuration.connector_schedules.length
    : Number(manifest.configuration?.connector_schedules),
  watchers: Array.isArray(manifest.configuration?.watchers)
    ? manifest.configuration.watchers.length
    : Number(manifest.configuration?.watchers),
};
const memberEmails = Array.isArray(manifest.settings?.members)
  ? manifest.settings.members
      .map((member) => member?.email)
      .filter((email) => typeof email === "string" && /^[^'\s@]+@[^'\s@]+$/u.test(email))
  : [];
const emailList = memberEmails.map((email) => `'${email.replaceAll("'", "''")}'`).join(",");
const mappedIdentityRows =
  emailList.length > 0
    ? await query(
        request.target_project_ref,
        `select count(*)::integer as matched from auth.users where lower(email) in (${emailList})`,
        true,
      )
    : [{ matched: 0 }];
const mappedIdentities = Number(mappedIdentityRows[0]?.matched ?? 0);
const identityMappingReady = memberEmails.length >= 2 && mappedIdentities === memberEmails.length;
const mappedMembershipRows =
  targetRows.length === 1 && emailList.length > 0
    ? await query(
        request.target_project_ref,
        `select count(*)::integer as matched from public.tenant_members m
         join auth.users u on u.id=m.user_id
         where m.tenant_id='${request.target_tenant_id}'::uuid and m.active
           and lower(u.email) in (${emailList})`,
        true,
      )
    : [{ matched: 0 }];
const mappedMemberships = Number(mappedMembershipRows[0]?.matched ?? 0);
const targetMembershipReady = targetRows.length === 0 || mappedMemberships === memberEmails.length;
const connectorReferencesSafe =
  Array.isArray(manifest.configuration?.connector_schedules) &&
  manifest.configuration.connector_schedules.every(
    (schedule) =>
      schedule?.credential_binding_required === true &&
      /^[0-9a-f]{64}$/u.test(schedule?.source_config_hash ?? ""),
  );
const targetSlug = manifest.settings?.tenant?.slug;
const targetSlugAllowed =
  typeof targetSlug === "string" &&
  /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(targetSlug) &&
  !/-(dev|sandbox|uat|staging)$/u.test(targetSlug);
const requestedMigrations = Array.isArray(manifest.package?.schema_migrations)
  ? manifest.package.schema_migrations
  : [];
let schemaHashesMatch = requestedMigrations.length === schemaFiles.size;
for (const entry of requestedMigrations) {
  const filename = schemaFiles.get(entry?.version);
  if (!filename || !/^[0-9a-f]{64}$/u.test(entry?.sha256 ?? "")) {
    schemaHashesMatch = false;
    continue;
  }
  const sql = await readFile(path.resolve("supabase/migrations", filename), "utf8");
  if (createHash("sha256").update(sql).digest("hex") !== entry.sha256) {
    schemaHashesMatch = false;
  }
}
const targetLedger = await query(
  request.target_project_ref,
  `select version from supabase_migrations.schema_migrations
   where version in (${[...schemaFiles.keys()].map((version) => `'${version}'`).join(",")})`,
  true,
);
const countsMatch =
  source &&
  Object.entries(expected).every(
    ([key, value]) => Number.isInteger(value) && Number(source[key]) === value,
  );
const directionBound =
  (request.direction === "prod_to_dev" &&
    request.source_project_ref === projects.prod &&
    request.target_project_ref === projects.dev) ||
  (request.direction === "dev_to_prod" &&
    request.source_project_ref === projects.dev &&
    request.target_project_ref === projects.prod);
const targetState =
  targetRows.length === 1
    ? "existing_target"
    : request.direction === "prod_to_dev"
      ? "planned_target_creation"
      : "missing_promotion_target";
const validations = [
  { check: "registered_direction", status: directionBound ? "pass" : "fail" },
  { check: "source_tenant_exists", status: source ? "pass" : "fail" },
  { check: "source_manifest_counts", status: countsMatch ? "pass" : "fail" },
  { check: "identity_mapping", status: identityMappingReady ? "pass" : "fail" },
  { check: "target_membership_mapping", status: targetMembershipReady ? "pass" : "fail" },
  {
    check: "connector_credential_references",
    status: connectorReferencesSafe ? "pass" : "fail",
  },
  { check: "target_slug_policy", status: targetSlugAllowed ? "pass" : "fail" },
  { check: "schema_migration_hashes", status: schemaHashesMatch ? "pass" : "fail" },
  {
    check: "target_state",
    status: targetState === "missing_promotion_target" ? "fail" : "pass",
    detail: targetState,
  },
  {
    check: "integrity_hashes",
    status: [
      request.package_hash,
      request.configuration_hash,
      request.settings_hash,
      request.manifest_hash,
    ].every((value) => /^[0-9a-f]{64}$/u.test(value))
      ? "pass"
      : "fail",
  },
  {
    check: "secret_free_manifest",
    status: "pass",
    detail: "enforced_by_database_manifest_guard",
  },
];
const escapedValidations = JSON.stringify(validations).replaceAll("'", "''");
await query(
  projects.prod,
  `select public.record_environment_change_preflight_for_api(
    '${request.id}'::uuid,'${escapedValidations}'::jsonb,'${request.requested_by}'::uuid)`,
  false,
);
console.log(
  JSON.stringify({
    ok: validations.every((item) => item.status === "pass"),
    change_request_uid: request.change_request_uid,
    direction: request.direction,
    source_counts_match: Boolean(countsMatch),
    mapped_identities: mappedIdentities,
    mapped_target_memberships: mappedMemberships,
    schema_migrations_pending: schemaFiles.size - targetLedger.length,
    target_state: targetState,
    validations: validations.map(({ check, status }) => ({ check, status })),
  }),
);
if (validations.some((item) => item.status !== "pass")) process.exit(1);
