import { readFile } from "node:fs/promises";
const vault = await readFile("./.private/CREDENTIALS.md", "utf8");
const tok = vault.match(/sbp_[A-Za-z0-9]+/)[0];
async function q(sql) {
  const r = await fetch("https://api.supabase.com/v1/projects/YOUR_PROJECT_REF/database/query", {
    method: "POST", headers: { authorization: "Bearer " + tok, "content-type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: true })
  });
  return JSON.parse(await r.text());
}
const sql = `select
  (select count(*)::integer from supabase_migrations.schema_migrations) as ledger_count,
  to_regprocedure('public.install_recon_starter_template_atomic(uuid,uuid,text,jsonb,jsonb)') is not null as starter_install,
  pg_get_functiondef(to_regprocedure('public.install_recon_starter_template_atomic(uuid,uuid,text,jsonb,jsonb)')) like '%''date_age_days''%' as age_rule_supported,
  to_regprocedure('public.save_tenant_template_from_recon_atomic(uuid,uuid,text,text,uuid,text,text)') is not null as template_save,
  to_regprocedure('public.clone_tenant_template_atomic(uuid,uuid,text)') is not null as template_clone,
  to_regprocedure('public.transition_tenant_template_atomic(uuid,uuid,text)') is not null as template_transition,
  to_regprocedure('public.instantiate_tenant_template_atomic(uuid,uuid,text)') is not null as template_instantiate,
  exists(select 1 from pg_trigger where tgname='guard_tenant_template_lifecycle' and not tgisinternal) as lifecycle_guard,
  exists(select 1 from pg_trigger where tgname='guard_tenant_template_version_immutable' and not tgisinternal) as immutable_versions,
  pg_get_functiondef(to_regprocedure('public.mkt_is_tenant_admin(uuid)')) like '%tm.active%' as active_admin,
  (select count(*)::integer from information_schema.columns where table_schema='public' and table_name='recon_definitions' and column_name in ('starter_template_id','starter_template_code','starter_template_snapshot','tenant_template_id')) as recon_columns`;
console.log(JSON.stringify(await q(sql), null, 2));
