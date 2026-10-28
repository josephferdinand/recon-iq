import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseCanonicalVault, TARGETS } from "./preflight-fvi-resource-identity-release.mjs";

const target = process.argv[2];
const projectRef = TARGETS[target];
if (!projectRef) throw new Error("Specify prod or dev");
const apply = process.env.FVI_APPLY_ASSURANCE_SYNTHETIC_BU === "YES";
const vaultPath = process.env.FVI_VAULT_PATH ?? "";
if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md") {
  throw new Error("Set FVI_VAULT_PATH to the canonical secured vault");
}
const token = parseCanonicalVault(await readFile(vaultPath, "utf8"));
const config = {
  prod: {
    tenant: "aa5ed999-69eb-41a0-a9c6-fbb439efcffb",
    slug: "reconiq-assurance-lab-prod",
    maker: ["85d57a0a-846d-4a7e-ba94-e5452b9db66c", "codex.qa+assurance-lab@reconiq.example"],
    checker: ["2849df7a-f63c-4b3b-9b5f-1c01c3ae8a43", "codex.qa+assurance-checker@reconiq.example"],
    expectedReconCount: 20,
    latestLedger: "20260923090000",
  },
  dev: {
    tenant: "aa5ed999-69eb-41a0-a9c6-fbb439efcffe",
    slug: "reconiq-assurance-lab-development",
    maker: ["f60d3faf-5054-4438-8449-00d659024a3a", "codex.qa+fvi-access-dev-maker-20260925@reconiq.example"],
    checker: ["d32d7db7-1550-4405-a1f3-9dd2c661711e", "codex.qa+fvi-access-dev-checker-20260925@reconiq.example"],
    expectedReconCount: 18,
    latestLedger: "20260914190000",
  },
}[target];
const units = [
  ["QA-DATA", "Data & Ingestion Controls"],
  ["QA-GL", "General Ledger"],
  ["QA-CASH", "Cash & Nostro"],
  ["QA-TRADE", "Trading & Custody"],
  ["QA-DERIV", "Listed Derivatives"],
  ["QA-FUND", "Fund Accounting"],
  ["QA-CORPACT", "Corporate Actions"],
  ["QA-TREASURY", "Treasury & FX"],
  ["QA-RECON", "Reconciliation QA Engineering"],
];
const seedKey = `fvi-assurance-synthetic-bu-20260925-${target}`;
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;

async function management(endpoint, options = {}) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/${endpoint}`, {
    ...options,
    headers: { authorization: `Bearer ${token}`, ...options.headers },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`FVI Management request failed: HTTP ${response.status}`);
  return response.json();
}
async function query(sql, readOnly = true) {
  return management("database/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: sql, read_only: readOnly }),
  });
}

const stateSql = `select jsonb_build_object(
  'tenant_ok',exists(select 1 from public.tenants where id='${config.tenant}' and slug::text='${config.slug}'),
  'actors_ok',(
    select count(*)=2 from public.tenant_members m join auth.users u on u.id=m.user_id
    where m.tenant_id='${config.tenant}' and m.active and m.role='tenant_admin'
      and ((m.user_id='${config.maker[0]}' and u.email=${quote(config.maker[1])})
        or (m.user_id='${config.checker[0]}' and u.email=${quote(config.checker[1])}))
  ),
  'recon_count',(select count(*) from public.recon_definitions where tenant_id='${config.tenant}'),
  'legacy_unmapped',(select count(*) from public.recon_definitions where tenant_id='${config.tenant}' and bu_id is null),
  'latest_ledger',(select max(version::text) from supabase_migrations.schema_migrations),
  'units',coalesce((select jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'parent_id',parent_id,'depth',depth,'is_archived',is_archived) order by depth,code)
    from public.business_units where tenant_id='${config.tenant}'),'[]'::jsonb),
  'assignments',coalesce((select jsonb_agg(jsonb_build_object('bu_id',bu_id,'user_id',user_id,'role',role,'inherit_descendants',inherit_descendants) order by user_id)
    from public.bu_user_assignments where tenant_id='${config.tenant}'),'[]'::jsonb),
  'seed_audits',(select count(*) from public.audit_log where tenant_id='${config.tenant}' and action='bu.synthetic_seed' and context->>'seed_key'=${quote(seedKey)})
) as state`;
const state = (await query(stateSql))?.[0]?.state;
if (!state?.tenant_ok || !state.actors_ok || state.recon_count !== config.expectedReconCount
  || state.legacy_unmapped !== config.expectedReconCount || state.latest_ledger !== config.latestLedger) {
  throw new Error(`Exact ${target.toUpperCase()} tenant, actor, reconciliation, or ledger precondition failed`);
}
const expectedCodes = ["QA-ROOT", ...units.map(([code]) => code)];
async function auditProof() {
  const row = (await query(`select jsonb_build_object(
    'seed_row_count',count(*),
    'seed_hash_valid',bool_and(row_hash=digest(
      coalesce(encode(prev_hash,'hex'),'')||'|'||coalesce(actor_user_id::text,'')||'|'||
      coalesce(tenant_id::text,'')||'|'||scope||'|'||action||'|'||
      coalesce(resource_type,'')||'|'||coalesce(resource_id,'')||'|'||
      coalesce(context::text,'{}')||'|'||occurred_at::text,'sha256')),
    'seed_parent_resolves',bool_and(prev_hash is null or exists(
      select 1 from public.audit_log prior where prior.id<a.id and prior.row_hash=a.prev_hash)),
    'head_matches_latest',(select h.last_audit_id=l.id and h.last_hash=l.row_hash
      from public.audit_chain_head h cross join lateral
        (select id,row_hash from public.audit_log order by id desc limit 1) l
      where h.singleton=true)
  ) as proof from public.audit_log a
  where tenant_id='${config.tenant}' and action='bu.synthetic_seed'
    and context->>'seed_key'=${quote(seedKey)}`))?.[0]?.proof;
  if (row?.seed_row_count !== 1 || row.seed_hash_valid !== true
    || row.seed_parent_resolves !== true || row.head_matches_latest !== true) {
    throw new Error("Synthetic BU audit chain proof failed; stop further writes");
  }
  return row;
}
function matchesSeed(candidate) {
  const root = candidate?.units?.find((unit) => unit.code === "QA-ROOT");
  return candidate?.units?.length === expectedCodes.length
    && root?.name === "Assurance Lab — Synthetic QA" && root.parent_id === null
    && root.depth === 0 && root.is_archived === false
    && units.every(([code, name]) => candidate.units.some((unit) => unit.code === code
      && unit.name === `${name} — Synthetic QA` && unit.parent_id === root.id
      && unit.depth === 1 && unit.is_archived === false))
    && candidate.assignments.length === 2
    && [config.maker[0], config.checker[0]].every((userId) => candidate.assignments.some((assignment) =>
      assignment.bu_id === root.id && assignment.user_id === userId
      && assignment.role === "bu_member" && assignment.inherit_descendants === true))
    && candidate.seed_audits === 1;
}
const alreadySeeded = matchesSeed(state);
if (alreadySeeded) {
  await auditProof();
  console.log(JSON.stringify({ ok: true, target, project_ref: projectRef, reused: true,
    tenant_id: config.tenant, units: state.units.length, assignments: state.assignments.length, audit_rows: state.seed_audits }));
  process.exit(0);
}
if (state.units.length || state.assignments.length || state.seed_audits) {
  throw new Error("Unexpected partial or pre-existing Assurance BU setup; no write attempted");
}
const backup = await management("database/backups");
const latestBackup = backup.backups?.filter((item) => item.status === "COMPLETED")
  .sort((a, b) => String(b.inserted_at).localeCompare(String(a.inserted_at)))[0];
if (!latestBackup) throw new Error("No completed database backup confirmed");
if (!apply) {
  console.log(JSON.stringify({ ok: true, target, project_ref: projectRef, dry_run: true,
    tenant_id: config.tenant, recon_count: state.recon_count,
    units_to_create: expectedCodes, assignments_to_create: 2,
    latest_ledger: state.latest_ledger, latest_completed_backup_at: latestBackup.inserted_at,
    pitr_enabled: backup.pitr_enabled }));
  process.exit(0);
}
const childInserts = units.map(([code, name]) => `
  insert into public.business_units (tenant_id,parent_id,name,code,description,created_by)
  values (v_tenant,v_root,${quote(`${name} — Synthetic QA`)},${quote(code)},
    'Synthetic Assurance Lab QA fixture; not an operating legal-entity ownership claim',null);`).join("");
const sql = `begin;
do $seed$
declare v_tenant uuid := '${config.tenant}'; v_root uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(${quote(seedKey)},0));
  if not exists (select 1 from public.tenants where id=v_tenant and slug::text=${quote(config.slug)} for update) then
    raise exception 'Exact tenant changed';
  end if;
  if (select max(version::text) from supabase_migrations.schema_migrations) <> '${config.latestLedger}'
     or (select count(*) from public.recon_definitions where tenant_id=v_tenant) <> ${config.expectedReconCount}
     or (select count(*) from public.recon_definitions where tenant_id=v_tenant and bu_id is null) <> ${config.expectedReconCount}
     or exists(select 1 from public.business_units where tenant_id=v_tenant)
     or exists(select 1 from public.bu_user_assignments where tenant_id=v_tenant) then
    raise exception 'Assurance seed state changed';
  end if;
  if (select count(*) from public.tenant_members m join auth.users u on u.id=m.user_id
    where m.tenant_id=v_tenant and m.active and m.role='tenant_admin'
      and ((m.user_id='${config.maker[0]}' and u.email=${quote(config.maker[1])})
        or (m.user_id='${config.checker[0]}' and u.email=${quote(config.checker[1])}))) <> 2 then
    raise exception 'Synthetic actor state changed';
  end if;
  insert into public.business_units (tenant_id,parent_id,name,code,description,created_by)
  values (v_tenant,null,'Assurance Lab — Synthetic QA','QA-ROOT',
    'Synthetic QA hierarchy approved by owner on 2026-09-25; no legal or real-customer ownership claim',null)
  returning id into v_root;${childInserts}
  insert into public.bu_user_assignments (tenant_id,bu_id,user_id,role,inherit_descendants,created_by)
  values (v_tenant,v_root,'${config.maker[0]}','bu_member',true,null),
         (v_tenant,v_root,'${config.checker[0]}','bu_member',true,null);
  insert into public.audit_log (tenant_id,scope,action,resource_type,resource_id,context)
  values (v_tenant,'system','bu.synthetic_seed','business_units',v_root::text,
    jsonb_build_object('seed_key',${quote(seedKey)},'authority','owner chat 2026-09-25',
      'executor','Codex controlled Management API transaction','synthetic',true,
      'unit_count',10,'assignment_count',2,'maker_user_id','${config.maker[0]}',
      'checker_user_id','${config.checker[0]}',
      'mapping_status','approved intent; recon owner/grant rows pending ordered migrations'));
end $seed$;
commit;`;
await query(sql, false);
const after = (await query(stateSql))?.[0]?.state;
const newRoot = after?.units?.find((unit) => unit.code === "QA-ROOT");
if (!matchesSeed(after)) throw new Error("Assurance BU persisted readback failed; inspect before any further writes");
await auditProof();
console.log(JSON.stringify({ ok: true, target, project_ref: projectRef, applied: true,
  tenant_id: config.tenant, root_id: newRoot.id, units: after.units.length,
  assignments: after.assignments.length, audit_rows: after.seed_audits }));
