import { readFile } from "node:fs/promises";
import path from "node:path";

const targetName = process.env.FVI_CROSS_TENANT_TEST_TARGET ?? "";
const targets = {
  prod: {
    ref: "YOUR_PROJECT_REF",
    family: "c9000000-0000-4000-8000-000000000001",
    tenant: "c9000000-0000-4000-8000-000000000011",
    environment: "dev",
    slug: "fvi-cross-tenant-rejection-production-proof",
  },
  dev: {
    ref: "YOUR_PROJECT_REF",
    family: "c9000000-0000-4000-8000-000000000002",
    tenant: "c9000000-0000-4000-8000-000000000012",
    environment: "dev",
    slug: "fvi-xtenant-proof-d",
  },
};
const target = targets[targetName];
if (!target) throw new Error("FVI_CROSS_TENANT_TEST_TARGET must be prod or dev");
if (process.env.FVI_ALLOW_CROSS_TENANT_NEGATIVE_TEST !== "YES") {
  throw new Error("Set FVI_ALLOW_CROSS_TENANT_NEGATIVE_TEST=YES");
}
const vaultPath = process.env.FVI_VAULT_PATH ?? "";
if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md") {
  throw new Error("Expected the canonical FVI vault");
}
const vault = await readFile(vaultPath, "utf8");
const start = vault.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->");
const end = vault.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->");
const tokenLine = vault
  .slice(start, end)
  .split(/\r?\n/u)
  .find((line) => line.startsWith("| `SUPABASE_ACCESS_TOKEN` |"));
const accessToken = tokenLine?.split("|")[2]?.trim().replace(/^`|`$/gu, "");
if (!accessToken || !/^sbp_[A-Za-z0-9_-]{20,}$/u.test(accessToken)) {
  throw new Error("FVI Management API token is unavailable");
}

async function query(sql, readOnly) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${target.ref}/database/query`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ query: sql, read_only: readOnly }),
    },
  );
  const raw = await response.text();
  if (!response.ok) {
    let detail = "query_rejected";
    try {
      detail = String(JSON.parse(raw).message ?? detail).slice(0, 500);
    } catch {
      // Keep a stable non-sensitive fallback.
    }
    throw new Error(detail);
  }
  return JSON.parse(raw);
}
const escaped = (value) => String(value).replaceAll("'", "''");

const source = (
  await query(
    `
select r.id,r.change_request_uid,r.manifest_hash,r.source_project_ref,r.source_tenant_id,
  r.source_environment,r.target_project_ref,r.target_environment,r.direction,r.title,r.reason,
  r.manifest,r.requested_by,r.decided_by,lower(u.email) as requester_email,
  jsonb_build_object(
    'release_identity_uid',sf.release_identity_uid,
    'canonical_legal_name',sf.canonical_legal_name,
    'legal_entity_identifier',sf.legal_entity_identifier,
    'verified_organization_domain',sf.verified_organization_domain,
    'legal_identity_hash',encode(extensions.digest(convert_to(
      lower(regexp_replace(trim(sf.canonical_legal_name),'[[:space:]]+',' ','g'))||'|'||
      coalesce(upper(trim(sf.legal_entity_identifier)),''),'UTF8'),'sha256'),'hex'),
    'domain_identity_hash',encode(extensions.digest(convert_to(
      lower(trim(sf.verified_organization_domain)),'UTF8'),'sha256'),'hex')
  ) as source_identity,
  encode(extensions.digest(convert_to(lower(u.email),'UTF8'),'sha256'),'hex') as requester_hash,
  encode(extensions.digest(convert_to(lower(a.email),'UTF8'),'sha256'),'hex') as approver_hash
from public.environment_change_requests r
join auth.users u on u.id=r.requested_by
join auth.users a on a.id=r.decided_by
join public.tenants st on st.id=r.source_tenant_id
join public.tenant_families sf on sf.id=st.family_id
where r.approval_stage='source_review' and r.status='approved'
order by r.requested_at desc limit 1`,
    true,
  )
)[0];
if (!source) throw new Error("No approved source package exists for the live negative test");

await query(
  `
insert into public.tenant_families(
  id,name,release_identity_uid,canonical_legal_name,verified_organization_domain,created_by
) values (
  '${target.family}','FVI Cross-Tenant Rejection Evidence ${targetName.toUpperCase()}',
  '${target.family}','FVI Cross-Tenant Rejection Evidence ${targetName.toUpperCase()}',
  'cross-tenant-${targetName}.invalid.test','${source.requested_by}'
) on conflict (id) do nothing;
insert into public.tenants(id,family_id,slug,name,environment,created_by)
values (
  '${target.tenant}','${target.family}','${target.slug}',
  'FVI Cross-Tenant Rejection Evidence ${targetName.toUpperCase()}',
  '${target.environment}','${source.requested_by}'
) on conflict (id) do update set
  family_id=excluded.family_id,slug=excluded.slug,name=excluded.name,environment=excluded.environment;
insert into public.tenant_members(tenant_id,user_id,role,active) values
  ('${target.tenant}','${source.requested_by}','tenant_admin',true),
  ('${target.tenant}','${source.decided_by}','tenant_admin',true)
on conflict (tenant_id,user_id) do update set role='tenant_admin',active=true;`,
  false,
);
await query(
  `insert into public.rbac_user_grants(tenant_id,user_id,role_id,scope_type,scope_id,granted_by,reason)
select '${target.tenant}',principal.user_id,role.id,'tenant',null,'${source.requested_by}',
  'Retained synthetic cross-tenant package rejection evidence'
from (values ('${source.requested_by}'::uuid),('${source.decided_by}'::uuid)) principal(user_id)
cross join lateral (
  select id from public.rbac_roles where key='tenant_admin' and is_system limit 1
) role
on conflict do nothing;`,
  false,
);

const payload = {
  upstream_change_request_uid: source.change_request_uid,
  upstream_manifest_hash: source.manifest_hash,
  source_request_status: "approved",
  source_project_ref: source.source_project_ref,
  source_tenant_id: source.source_tenant_id,
  source_environment: source.source_environment,
  target_project_ref: source.target_project_ref,
  target_tenant_id: target.tenant,
  target_environment: source.target_environment,
  direction: source.direction,
  title: source.title,
  reason: source.reason,
  manifest: {
    ...source.manifest,
    settings: { ...source.manifest.settings, tenant_identity: source.source_identity },
  },
  source_requester_email: source.requester_email,
  source_requester_email_hash: source.requester_hash,
  source_approver_email_hash: source.approver_hash,
  validation_results: [{ check: "target_binding", status: "pass" }],
};
let rejection = "";
try {
  await query(
    `select * from public.receive_environment_change_for_api('${escaped(JSON.stringify(payload))}'::jsonb,'${escaped(source.requester_email)}')`,
    false,
  );
} catch (error) {
  rejection = error.message;
}
if (!rejection.includes("not the same registered organization")) {
  throw new Error(`Wrong-tenant receiver rejection was not observed: ${rejection.slice(0, 200)}`);
}

const incident = {
  reason_code: "environment_package_tenant_mismatch",
  selected_target_tenant_id: target.tenant,
  claimed_target_tenant_id: source.target_tenant_id ?? null,
  source_request_uid: source.change_request_uid,
  manifest_hash: source.manifest_hash,
  package_rejected: true,
  live_test: true,
};
const recorded = (
  await query(
    `select * from public.record_environment_package_rejection_for_api(
    '${target.tenant}','${source.requested_by}','${escaped(JSON.stringify(incident))}'::jsonb
  )`,
    false,
  )
)[0];
const evidence = (
  await query(
    `select
  (select count(*) from public.environment_change_requests where control_tenant_id='${target.tenant}') as admitted_requests,
  (select count(*) from public.security_events where tenant_id='${target.tenant}' and event_type='environment_package_tenant_mismatch') as security_events,
  (select count(*) from public.security_alert_incidents where tenant_id='${target.tenant}') as incidents,
  (select count(*) from public.audit_log where tenant_id='${target.tenant}' and action='environment_change.cross_tenant_import_rejected') as audits`,
    true,
  )
)[0];
if (Number(evidence.admitted_requests) !== 0 || Number(recorded.emails_queued) < 1) {
  throw new Error("Live cross-tenant evidence failed its release assertions");
}
console.log(
  JSON.stringify({
    ok: true,
    target: targetName,
    synthetic_tenant_id: target.tenant,
    rejected_before_intake: true,
    ...evidence,
    emails_queued: recorded.emails_queued,
    values_printed: false,
  }),
);
