import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseCanonicalVault, TARGETS } from "./preflight-fvi-resource-identity-release.mjs";

// Auth creation and SQL role grant cannot share one transaction. On partial
// failure, retain the banned Auth-generated-password orphan for manual audited repair;
// never auto-delete or silently regrant a role on rerun.

const target = process.argv[2];
const projectRef = TARGETS[target];
if (!projectRef) throw new Error("Specify exact target prod or dev");
const apply = process.env.FVI_PROVISION_INTAKE_ACTOR === "YES";
const repair = process.env.FVI_REPAIR_BANNED_INTAKE_ACTOR === "YES";
const vaultPath = process.env.FVI_VAULT_PATH ?? "";
if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md") {
  throw new Error("Set FVI_VAULT_PATH to the canonical secured vault");
}
const vault = await readFile(vaultPath, "utf8");
const token = parseCanonicalVault(vault);
const begin = vault.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->");
const end = vault.indexOf("<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->");
const field = `SUPABASE_${target.toUpperCase()}_SERVICE_ROLE_KEY`;
const row = vault.slice(begin, end).split(/\r?\n/u)
  .find((line) => line.startsWith(`| \`${field}\` |`));
const serviceKey = row?.split("|")[2]?.trim().replace(/^`|`$/gu, "");
if (!serviceKey || serviceKey.length < 30) throw new Error("Target service key is unavailable");
const email = `fvi-environment-intake-${target}@fvi.invalid`;
const seedKey = `fvi-environment-intake-${target}-20260925`;
const sql = `select jsonb_build_object(
  'ledger_latest',(select max(version::text) from supabase_migrations.schema_migrations),
  'matching_users',(select count(*) from auth.users where lower(email)=lower('${email}')),
  'actor',(select jsonb_build_object('id',u.id,'email',u.email,
    'email_unconfirmed',u.email_confirmed_at is null,
    'auth_generated_password_hash',coalesce(u.encrypted_password,'')<>'',
    'banned_for_99_years',u.banned_until > now()+interval '99 years',
    'no_sessions',not exists(select 1 from auth.sessions s where s.user_id=u.id),
    'service_marker',u.raw_app_meta_data->>'fvi_service_principal',
    'target_environment',u.raw_app_meta_data->>'target_environment',
    'non_interactive',u.raw_app_meta_data->>'non_interactive',
    'credential_issuer',u.raw_app_meta_data->>'credential_issuer',
    'platform_role_count',(select count(*) from public.platform_roles p where p.user_id=u.id),
    'platform_admin',exists(select 1 from public.platform_roles p where p.user_id=u.id and p.role='platform_admin'),
    'audit_valid',exists(select 1 from public.audit_log a
      where a.action='system.environment_intake_actor_provisioned'
        and a.context->>'seed_key'='${seedKey}' and a.scope='system'
        and a.resource_type='platform_roles' and a.resource_id=u.id::text
        and a.context->>'actor_id'=u.id::text
        and a.context->>'target_environment'='${target}'
        and a.context->>'non_interactive'='true'
        and a.context->>'banned_for_99_years'='true'
        and a.context->>'auth_generated_password_not_disclosed'='true'
        and a.row_hash=digest(
          coalesce(encode(a.prev_hash,'hex'),'')||'|'||coalesce(a.actor_user_id::text,'')||'|'||
          coalesce(a.tenant_id::text,'')||'|'||a.scope||'|'||a.action||'|'||
          coalesce(a.resource_type,'')||'|'||coalesce(a.resource_id,'')||'|'||
          coalesce(a.context::text,'{}')||'|'||a.occurred_at::text,'sha256')
        and (a.prev_hash is null or exists(select 1 from public.audit_log prior
          where prior.id<a.id and prior.row_hash=a.prev_hash))))
    from auth.users u where lower(u.email)=lower('${email}') limit 1),
  'audit_count',(select count(*) from public.audit_log where action='system.environment_intake_actor_provisioned'
    and context->>'seed_key'='${seedKey}')
) as state`;
async function management(endpoint, options = {}) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/${endpoint}`, {
    ...options,
    headers: { authorization: `Bearer ${token}`, ...options.headers },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    const reason = typeof failure?.message === "string" ? failure.message
      : typeof failure?.error === "string" ? failure.error : "unavailable";
    throw new Error(`FVI Management request failed: HTTP ${response.status}; ${reason.slice(0, 300)}`);
  }
  return response.json();
}
async function query(statement, readOnly = true) {
  return management("database/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: statement, read_only: readOnly }),
  });
}
const expectedLedger = target === "prod" ? "20260923090100" : "20260914190000";
const state = (await query(sql))?.[0]?.state;
if (state?.ledger_latest !== expectedLedger || state.matching_users > 1 || state.audit_count > 1) {
  throw new Error("Exact target ledger or intake identity precondition failed");
}
if (state.actor?.platform_admin) {
  if (state.audit_count !== 1 || !state.actor.email_unconfirmed || !state.actor.auth_generated_password_hash
    || !state.actor.banned_for_99_years || !state.actor.no_sessions
    || state.actor.service_marker !== "environment_intake"
    || state.actor.target_environment !== target || state.actor.non_interactive !== "true"
    || state.actor.credential_issuer !== "none" || state.actor.platform_role_count !== 1
    || state.actor.audit_valid !== true) {
    throw new Error("Existing intake actor is not the expected audited non-interactive principal");
  }
  console.log(JSON.stringify({ ok: true, target, project_ref: projectRef, reused: true,
    actor_id: state.actor.id, non_interactive: true, audit_rows: state.audit_count }));
  await new Promise((resolve) => setTimeout(resolve, 250));
  process.exit(0);
}
const partial = state.actor && !state.actor.platform_admin && state.actor.platform_role_count === 0
  && state.audit_count === 0;
if (state.actor && !partial || state.audit_count) {
  throw new Error("Unexpected intake actor state; no automatic privilege change");
}
if (partial && (!state.actor.email_unconfirmed || !state.actor.auth_generated_password_hash
  || !state.actor.banned_for_99_years || !state.actor.no_sessions
  || state.actor.service_marker !== "environment_intake"
  || state.actor.target_environment !== target || state.actor.non_interactive !== "true"
  || state.actor.credential_issuer !== "none")) {
  throw new Error("Existing partial intake actor fails non-interactive safety checks");
}
if (partial && repair && target !== "prod") {
  throw new Error("The current repair approval is scoped to the exact PROD actor only");
}
if (partial && !repair) {
  console.log(JSON.stringify({ target, partial: true, actor_id: state.actor.id,
    banned_for_99_years: true, no_sessions: true, role_count: 0, audit_rows: 0 }));
  throw new Error("Banned Auth actor exists; set explicit repair guard after review");
}
const backup = await management("database/backups");
const latestBackup = backup.backups?.filter((item) => item.status === "COMPLETED")
  .sort((a, b) => String(b.inserted_at).localeCompare(String(a.inserted_at)))[0];
if (!latestBackup) throw new Error("No completed target database backup confirmed");
if (!apply) {
  console.log(JSON.stringify({ ok: true, target, project_ref: projectRef, dry_run: true,
    proposed_email: email, password_not_supplied: true,
    auth_generated_password_not_disclosed: true, email_unconfirmed: true,
    ban_duration: "876000h", no_sessions: true,
    proposed_role: "platform_admin", target_ledger: state.ledger_latest,
    repair_existing_banned_actor: Boolean(partial),
    latest_completed_backup_at: latestBackup.inserted_at }));
  process.exit(0);
}
const { createClient } = await import("@supabase/supabase-js");
const supabase = createClient(`https://${projectRef}.supabase.co`, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});
let actorId = state.actor?.id;
if (!partial) {
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    email_confirm: false,
    ban_duration: "876000h",
    app_metadata: { fvi_service_principal: "environment_intake", target_environment: target,
      non_interactive: true, credential_issuer: "none" },
  });
  if (createError || !created?.user?.id) {
    throw new Error(`Target Auth admin create failed: ${createError?.name ?? "unknown"}`);
  }
  actorId = created.user.id;
  const { error: banError } = await supabase.auth.admin.updateUserById(actorId, {
    ban_duration: "876000h",
  });
  if (banError) throw new Error("Target Auth actor ban failed; no role was granted");
}
if (!actorId) throw new Error("Target actor identity is unavailable");
const roleSql = `begin;
do $provision$
begin
  perform pg_advisory_xact_lock(hashtextextended('${seedKey}',0));
  if (select max(version::text) from supabase_migrations.schema_migrations) <> '${expectedLedger}' then
    raise exception 'Target ledger changed';
  end if;
  if not exists (select 1 from auth.users u where u.id='${actorId}' and lower(u.email)=lower('${email}')
    and u.email_confirmed_at is null and coalesce(u.encrypted_password,'')<>''
    and u.banned_until > now()+interval '99 years'
    and not exists(select 1 from auth.sessions s where s.user_id=u.id)
    and u.raw_app_meta_data->>'fvi_service_principal'='environment_intake'
    and u.raw_app_meta_data->>'target_environment'='${target}'
    and u.raw_app_meta_data->>'non_interactive'='true'
    and u.raw_app_meta_data->>'credential_issuer'='none') then
    raise exception 'Non-interactive target actor metadata changed';
  end if;
  if exists(select 1 from public.platform_roles where user_id='${actorId}')
    or exists(select 1 from public.audit_log where action='system.environment_intake_actor_provisioned'
      and context->>'seed_key'='${seedKey}') then
    raise exception 'Target intake actor role or audit already exists';
  end if;
  insert into public.platform_roles(user_id,role,granted_by)
  values ('${actorId}','platform_admin',null);
  insert into public.audit_log(scope,action,resource_type,resource_id,context)
  values ('system','system.environment_intake_actor_provisioned','platform_roles','${actorId}',
    jsonb_build_object('seed_key','${seedKey}','authority','owner chat 2026-09-25',
      'purpose','environment package target importer attribution',
      'target_environment','${target}','non_interactive',true,
      'auth_generated_password_not_disclosed',true,
      'email_unconfirmed',true,'banned_for_99_years',true,'no_sessions',true,'actor_id','${actorId}',
      'runtime_credential','Worker target service-role binding; actor UUID is not a bearer token'));
end $provision$;
commit;`;
await query(roleSql, false);
const after = (await query(sql))?.[0]?.state;
if (after?.matching_users !== 1 || after.actor?.id !== actorId
  || !after.actor.platform_admin || !after.actor.auth_generated_password_hash || !after.actor.email_unconfirmed
  || !after.actor.banned_for_99_years || !after.actor.no_sessions
  || after.actor.service_marker !== "environment_intake" || after.audit_count !== 1
  || after.actor.target_environment !== target || after.actor.non_interactive !== "true"
  || after.actor.credential_issuer !== "none" || after.actor.platform_role_count !== 1
  || after.actor.audit_valid !== true) {
  throw new Error("Target intake actor persisted readback failed; do not configure Worker");
}
console.log(JSON.stringify({ ok: true, target, project_ref: projectRef, applied: true,
  actor_id: actorId, non_interactive: true, audit_rows: after.audit_count }));
