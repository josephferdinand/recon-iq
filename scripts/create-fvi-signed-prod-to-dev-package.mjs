import { createHash, createHmac } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

if (process.env.FVI_ALLOW_SIGNED_PROD_TO_DEV_PACKAGE !== "YES") {
  throw new Error("Set FVI_ALLOW_SIGNED_PROD_TO_DEV_PACKAGE=YES");
}
const vaultPath = process.env.FVI_VAULT_PATH ?? "";
if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md") {
  throw new Error("Expected the canonical FVI vault");
}
const vault = await readFile(vaultPath, "utf8");
const start = vault.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->");
const end = vault.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->");
const section = vault.slice(start, end);
function vaultValue(key) {
  const line = section.split(/\r?\n/u).find((item) => item.startsWith(`| \`${key}\` |`));
  const value = line?.split("|")[2]?.trim().replace(/^`|`$/gu, "");
  if (!value) throw new Error(`Canonical vault field ${key} is unavailable`);
  return value;
}
const accessToken = vaultValue("SUPABASE_ACCESS_TOKEN");
const signingKey = vaultValue("ENVIRONMENT_PACKAGE_HMAC_KEY");
const projectRef = "YOUR_PROJECT_REF";

async function query(sql, readOnly) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
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
      /* stable fallback */
    }
    throw new Error(detail);
  }
  return JSON.parse(raw);
}
const escaped = (value) => String(value).replaceAll("'", "''");

const source = (
  await query(
    `select r.*,lower(m.email) maker_email,lower(c.email) checker_email,
  jsonb_build_object(
    'release_identity_uid',f.release_identity_uid,'canonical_legal_name',f.canonical_legal_name,
    'legal_entity_identifier',f.legal_entity_identifier,
    'verified_organization_domain',f.verified_organization_domain,
    'legal_identity_hash',encode(extensions.digest(convert_to(lower(regexp_replace(trim(f.canonical_legal_name),'[[:space:]]+',' ','g'))||'|'||coalesce(upper(trim(f.legal_entity_identifier)),''),'UTF8'),'sha256'),'hex'),
    'domain_identity_hash',encode(extensions.digest(convert_to(lower(trim(f.verified_organization_domain)),'UTF8'),'sha256'),'hex')
  ) tenant_identity
from public.environment_change_requests r
join auth.users m on m.id=r.requested_by join auth.users c on c.id=r.decided_by
join public.tenants t on t.id=r.source_tenant_id join public.tenant_families f on f.id=t.family_id
where r.approval_stage='source_review' and r.status='approved' and r.direction='prod_to_dev'
order by r.requested_at desc limit 1`,
    true,
  )
)[0];
if (!source) throw new Error("No prior governed PROD to DEV source package exists");
const manifest = {
  ...source.manifest,
  settings: { ...source.manifest.settings, tenant_identity: source.tenant_identity },
};
const request = {
  direction: source.direction,
  source_project_ref: source.source_project_ref,
  source_tenant_id: source.source_tenant_id,
  source_environment: source.source_environment,
  target_project_ref: source.target_project_ref,
  target_tenant_id: source.target_tenant_id,
  target_environment: source.target_environment,
  title: `Signed PROD to DEV assurance ${new Date().toISOString().slice(0, 19)}`,
  reason: "Prove correct-target signed package import after immutable tenant-family binding.",
  manifest,
  validation_results: [
    { check: "source_tenant_binding", status: "pass" },
    { check: "secret_free_manifest", status: "pass" },
    { check: "tenant_family_identity", status: "pass" },
  ],
  idempotency_key: `signed-prod-dev-${Date.now()}`,
};
const created = (
  await query(
    `select * from public.request_source_environment_change_as(
  '${escaped(JSON.stringify(request))}'::jsonb,'${source.requested_by}'::uuid)`,
    false,
  )
)[0];
if (!created?.request_id) throw new Error("Fresh source package request was not created");
await query(
  `select public.decide_environment_change_as(
  '${created.request_id}'::uuid,true,'Independent checker approved signed manual transfer',
  '${source.decided_by}'::uuid)`,
  false,
);
const payload = {
  upstream_change_request_uid: created.change_request_uid,
  upstream_manifest_hash: created.manifest_hash,
  source_request_status: "approved",
  source_project_ref: request.source_project_ref,
  source_tenant_id: request.source_tenant_id,
  source_environment: request.source_environment,
  target_project_ref: request.target_project_ref,
  target_tenant_id: request.target_tenant_id,
  target_environment: request.target_environment,
  direction: request.direction,
  title: request.title,
  reason: request.reason,
  manifest,
  source_requester_email: source.maker_email,
  source_approver_email: source.checker_email,
  source_requester_email_hash: createHash("sha256").update(source.maker_email).digest("hex"),
  source_approver_email_hash: createHash("sha256").update(source.checker_email).digest("hex"),
};
const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
const signature = createHmac("sha256", signingKey).update(`1.${encoded}`).digest("hex");
const output = path.resolve("_e2e_run/owner-session/environment-package-prod-to-dev-signed.json");
await mkdir(path.dirname(output), { recursive: true });
await writeFile(
  output,
  JSON.stringify({ schema_version: 1, payload: encoded, signature }, null, 2),
);
console.log(
  JSON.stringify({
    ok: true,
    request_uid: created.change_request_uid,
    manifest_hash: created.manifest_hash,
    output,
    values_printed: false,
  }),
);
