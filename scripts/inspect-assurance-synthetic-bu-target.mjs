import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseCanonicalVault, TARGETS } from "./preflight-fvi-resource-identity-release.mjs";

const target = process.argv[2];
const projectRef = TARGETS[target];
if (!projectRef) throw new Error("Specify prod or dev");
const vaultPath = process.env.FVI_VAULT_PATH ?? "";
if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md") {
  throw new Error("Set FVI_VAULT_PATH to the canonical secured vault");
}
const token = parseCanonicalVault(await readFile(vaultPath, "utf8"));
const slug = target === "prod"
  ? "reconiq-assurance-lab-prod"
  : "reconiq-assurance-lab-development";
const sql = `
with selected_tenant as (
  select id, slug::text as slug from public.tenants where slug::text = '${slug}'
), actors as (
  select m.user_id, m.role::text as role, u.email,
    coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) order by g.name)
      from public.tenant_group_members gm join public.tenant_groups g on g.id=gm.group_id
      where gm.user_id=m.user_id and g.tenant_id=m.tenant_id), '[]'::jsonb) as groups
  from public.tenant_members m join auth.users u on u.id=m.user_id
  where m.tenant_id=(select id from selected_tenant)
), group_members as (
  select g.id, g.name, count(gm.user_id) as member_count,
    coalesce(jsonb_agg(gm.user_id order by gm.user_id) filter (where gm.user_id is not null),'[]'::jsonb) as members
  from public.tenant_groups g left join public.tenant_group_members gm on gm.group_id=g.id
  where g.tenant_id=(select id from selected_tenant)
  group by g.id,g.name
)
select jsonb_build_object(
 'tenant', (select to_jsonb(t) from selected_tenant t),
 'other_tenant_count',(select count(*) from public.tenants where id<>(select id from selected_tenant)),
 'members', coalesce((select jsonb_agg(to_jsonb(a) order by a.email) from actors a),'[]'::jsonb),
 'intake_actor_candidates',coalesce((select jsonb_agg(jsonb_build_object('user_id',u.id,'email',u.email,
   'platform_role',pr.role,'tenant_role',tm.role,'tenant_active',tm.active) order by u.email)
   from auth.users u
   left join public.platform_roles pr on pr.user_id=u.id and pr.role='platform_admin'
   left join public.tenant_members tm on tm.user_id=u.id and tm.tenant_id=(select id from selected_tenant)
   where u.email ilike '%intake%' or u.email ilike '%importer%'), '[]'::jsonb),
 'groups', coalesce((select jsonb_agg(to_jsonb(g) order by g.name) from group_members g),'[]'::jsonb),
 'business_units', coalesce((select jsonb_agg(jsonb_build_object('id',id,'parent_id',parent_id,'name',name,'code',code,'description',description,'depth',depth,'is_archived',is_archived) order by depth,name)
    from public.business_units where tenant_id=(select id from selected_tenant)),'[]'::jsonb),
 'bu_assignments', (select count(*) from public.bu_user_assignments where tenant_id=(select id from selected_tenant)),
 'recon_count', (select count(*) from public.recon_definitions where tenant_id=(select id from selected_tenant)),
 'recon_legacy_unmapped', (select count(*) from public.recon_definitions where tenant_id=(select id from selected_tenant) and bu_id is null),
 'ledger_latest', (select max(version::text) from supabase_migrations.schema_migrations),
 'owner_link_table_hosted', to_regclass('public.recon_definition_business_units') is not null
) as state`;
const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ query: sql, read_only: true }),
  signal: AbortSignal.timeout(20_000),
});
if (!response.ok) throw new Error(`Management inventory failed: HTTP ${response.status}`);
const rows = await response.json();
const state = rows?.[0]?.state;
if (!state?.tenant) throw new Error("Exact Assurance tenant missing");
console.log(JSON.stringify({ target, project_ref: projectRef, ...state }, null, 2));
