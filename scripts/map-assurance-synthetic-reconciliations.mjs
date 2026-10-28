import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseCanonicalVault } from "./preflight-fvi-resource-identity-release.mjs";

const projectRef = "YOUR_PROJECT_REF";
const tenantId = "aa5ed999-69eb-41a0-a9c6-fbb439efcffb";
const makerId = "85d57a0a-846d-4a7e-ba94-e5452b9db66c";
const checkerId = "2849df7a-f63c-4b3b-9b5f-1c01c3ae8a43";
const executorId = "35c27858-e96d-48e3-8bad-1861826a33a7";
const map = new Map([
  ["FVI-GEN-2WAY-000008", "QA-RECON"], ["FVI-GEN-2WAY-000007", "QA-RECON"],
  ["FVI-GEN-1WAY-000003", "QA-DATA"], ["FVI-GEN-2WAY-000006", "QA-TREASURY"],
  ["FVI-GEN-1WAY-000004", "QA-DATA"], ["FVI-GEN-1WAY-000002", "QA-GL"],
  ["FVI-GEN-3WAY-000006", "QA-RECON"], ["FVI-GEN-1WAY-000001", "QA-GL"],
  ["FVI-GEN-2WAY-000005", "QA-DERIV"], ["FVI-GEN-2WAY-000001", "QA-CASH"],
  ["FVI-GEN-2WAY-000002", "QA-TRADE"], ["FVI-GEN-2WAY-000003", "QA-FUND"],
  ["FVI-GEN-3WAY-000001", "QA-TRADE"], ["FVI-GEN-3WAY-000002", "QA-CORPACT"],
  ["FVI-GEN-2WAY-000004", "QA-TREASURY"], ["FVI-GEN-3WAY-000003", "QA-TRADE"],
  ["FVI-GEN-3WAY-000004", "QA-TREASURY"], ["FVI-GEN-3WAY-000005", "QA-TREASURY"],
  ["FVI-GEN-2WAY-000009", "QA-CASH"], ["FVI-GEN-2WAY-000010", "QA-CASH"],
]);
if (map.size !== 20) throw new Error("Synthetic owner map is not exactly 20 unique definitions");
const apply = process.env.FVI_APPLY_ASSURANCE_RECON_MAPPING === "YES";
const vaultPath = process.env.FVI_VAULT_PATH ?? "";
if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md") {
  throw new Error("Set FVI_VAULT_PATH to the canonical secured vault");
}
const vault = await readFile(vaultPath, "utf8");
const token = parseCanonicalVault(vault);
const begin = vault.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->");
const end = vault.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->");
const anonRow = vault.slice(begin, end).split(/\r?\n/u)
  .find((line) => line.startsWith("| `SUPABASE_PROD_ANON_KEY` |"));
const publishableKey = anonRow?.split("|")[2]?.trim().replace(/^`|`$/gu, "");
if (!publishableKey) throw new Error("PROD publishable key is unavailable in the canonical vault");
const sql = `select jsonb_build_object(
  'tenant_ok',exists(select 1 from public.tenants where id='${tenantId}' and slug::text='reconiq-assurance-lab-prod'),
  'owner_schema',to_regclass('public.recon_definition_business_units') is not null,
  'admin_rpc',to_regprocedure('public.set_recon_owners(uuid,uuid[],text)') is not null,
  'ledgered',exists(select 1 from supabase_migrations.schema_migrations where version::text='20260924170000'),
  'latest_ledger',(select max(version::text) from supabase_migrations.schema_migrations),
  'definitions',coalesce((select jsonb_agg(jsonb_build_object('id',id,'code',recon_code,'tenant_id',tenant_id,
    'status',status,'legacy_bu_id',bu_id) order by recon_code)
    from public.recon_definitions where tenant_id='${tenantId}'),'[]'::jsonb),
  'units',coalesce((select jsonb_agg(jsonb_build_object('id',id,'code',code,'is_archived',is_archived)
    order by code) from public.business_units where tenant_id='${tenantId}'),'[]'::jsonb),
  'maker_scope',exists(select 1 from public.bu_user_assignments a join public.business_units b on b.id=a.bu_id
    where a.tenant_id='${tenantId}' and a.user_id='${makerId}' and a.inherit_descendants
      and b.code='QA-ROOT' and not b.is_archived),
  'checker_scope',exists(select 1 from public.bu_user_assignments a join public.business_units b on b.id=a.bu_id
    where a.tenant_id='${tenantId}' and a.user_id='${checkerId}' and a.inherit_descendants
      and b.code='QA-ROOT' and not b.is_archived),
  'separate_executor_active_admin',exists(select 1 from public.tenant_members m
    where m.tenant_id='${tenantId}' and m.user_id='${executorId}' and m.active
      and m.role='tenant_admin')
) as state`;
const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ query: sql, read_only: true }),
  signal: AbortSignal.timeout(20_000),
});
if (!response.ok) {
  const failure = await response.json().catch(() => ({}));
  const reason = typeof failure?.message === "string" ? failure.message
    : typeof failure?.error === "string" ? failure.error : "unavailable";
  throw new Error(`Assurance mapping preflight HTTP ${response.status}; ${reason.slice(0, 250)}`);
}
const state = (await response.json())?.[0]?.state;
if (!state?.tenant_ok || !state.maker_scope || !state.checker_scope
  || !state.separate_executor_active_admin
  || state.definitions.length !== 20 || state.definitions.some((row) =>
    !map.has(row.code) || row.tenant_id !== tenantId
    || row.legacy_bu_id !== null)) {
  throw new Error("Exact Assurance tenant, actor scope, or 20-definition legacy state changed");
}
const byCode = new Map(state.units.map((unit) => [unit.code, unit]));
if (state.units.length !== 10 || [...map.values()].some((code) =>
  !byCode.has(code) || byCode.get(code).is_archived)) {
  throw new Error("Exact synthetic BU hierarchy is unavailable");
}
if (!apply) {
  console.log(JSON.stringify({ ok: true, project_ref: projectRef, tenant_id: tenantId,
    dry_run: true, definitions: state.definitions.length, business_units: state.units.length,
    separate_executor_active_admin: state.separate_executor_active_admin,
    owner_schema_hosted: state.owner_schema, admin_rpc_hosted: state.admin_rpc,
    admin_migration_ledgered: state.ledgered, latest_ledger: state.latest_ledger,
    plan: state.definitions.map((row) => ({ public_id: row.code, owner_code: map.get(row.code) })) }, null, 2));
  await new Promise((resolve) => setTimeout(resolve, 250));
  process.exit(0);
}
if (!state.owner_schema || !state.admin_rpc || !state.ledgered) {
  throw new Error("Governed owner/grant migrations are not hosted; no mapping write attempted");
}
const credentialPath = process.env.FVI_QA_CREDENTIAL_FILE ?? "";
if (!path.isAbsolute(credentialPath)
  || path.basename(credentialPath) !== "FVI-QA-Access-PROD-executor-20260925.cred") {
  throw new Error("Exact protected separate PROD QA executor credential file is required; do not reuse maker/checker credentials");
}
const credentialText = await readFile(credentialPath, "utf8");
function field(label) {
  return credentialText.match(new RegExp(`^\\s*(?:-\\s*)?${label}:\\s*(.+)$`, "mu"))?.[1]
    ?.trim().replace(/^`|`$/gu, "") ?? "";
}
const email = field("Account");
const password = field("Temporary password");
if (!email || !password) throw new Error("Protected QA maker credential is incomplete");
const { createClient } = await import("@supabase/supabase-js");
const supabase = createClient(`https://${projectRef}.supabase.co`, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
const { data: signedIn, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
if (signInError || signedIn.user?.id !== executorId) throw new Error("Exact separate QA tenant-admin executor sign-in failed");
const { data: liveDefinitions, error: liveDefinitionsError } = await supabase
  .from("recon_definitions").select("id,recon_code,access_mode,bu_id")
  .eq("tenant_id", tenantId);
if (liveDefinitionsError || liveDefinitions?.length !== 20
  || liveDefinitions.some((row) => !map.has(row.recon_code)
    || row.access_mode !== "legacy_passthrough" || row.bu_id !== null
    || state.definitions.find((definition) => definition.code === row.recon_code)?.id !== row.id)) {
  throw new Error("Hosted owner-schema legacy state changed; no mapping write attempted");
}
const reason = "Owner-authorized synthetic Assurance QA mapping, 2026-09-25";
let completed = 0;
try {
  for (const def of state.definitions) {
    const ownerId = byCode.get(map.get(def.code)).id;
    const desired = [
      ...["view", "run", "edit"].map((action) => `user:${makerId}:${action}`),
      ...["view", "approve"].map((action) => `user:${checkerId}:${action}`),
    ].sort();
    const setup = async () => {
      const { data, error } = await supabase.rpc("get_recon_access_setup", { _recon_id: def.id });
      if (error || !data) throw new Error(`Access setup readback failed for ${def.code}`);
      return data;
    };
    const before = await setup();
    const owners = before.owners ?? [];
    const grants = before.grants ?? [];
    if (owners.length > 0 && (owners.length !== 1 || owners[0].bu_id !== ownerId)) {
      throw new Error(`Unexpected prior owner mapping for ${def.code}; stop`);
    }
    const grantKeys = grants.map((grant) => `${grant.principal_type}:${grant.principal_id}:${grant.action}`).sort();
    if (grants.some((grant) => grant.bu_id !== ownerId || !desired.includes(
      `${grant.principal_type}:${grant.principal_id}:${grant.action}`))) {
      throw new Error(`Unexpected prior action grant for ${def.code}; stop`);
    }
    if (owners.length === 0) {
      const { error } = await supabase.rpc("set_recon_owners", {
        _recon_id: def.id, _bu_ids: [ownerId], _reason: reason,
      });
      if (error) throw new Error(`Governed owner write failed for ${def.code}`);
    }
    for (const [principalId, actions] of [[makerId, ["view", "run", "edit"]],
      [checkerId, ["view", "approve"]]]) {
      for (const action of actions) {
        const key = `user:${principalId}:${action}`;
        if (grantKeys.includes(key)) continue;
        const { error } = await supabase.rpc("grant_recon_bu_action", {
          _recon_id: def.id, _bu_id: ownerId, _principal_type: "user",
          _principal_id: principalId, _action: action, _reason: reason,
        });
        if (error) throw new Error(`Governed ${action} grant failed for ${def.code}`);
      }
    }
    const after = await setup();
    const afterKeys = (after.grants ?? []).map((grant) =>
      `${grant.principal_type}:${grant.principal_id}:${grant.action}`).sort();
    if ((after.owners ?? []).length !== 1 || after.owners[0].bu_id !== ownerId
      || JSON.stringify(afterKeys) !== JSON.stringify(desired)
      || after.multi_bu_governed !== false) {
      throw new Error(`Persisted owner/grant readback failed for ${def.code}`);
    }
    completed++;
    console.log(JSON.stringify({ public_id: def.code, mapped_shadow: true }));
  }
  console.log(JSON.stringify({ ok: true, project_ref: projectRef, tenant_id: tenantId,
    definitions: completed, owner_links: completed, action_grants: completed * 5,
    effective_cutover: false }));
} finally {
  await supabase.auth.signOut();
}
