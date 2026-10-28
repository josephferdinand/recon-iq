import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assessState, STATE_SQL, VERSION, NAME, SOURCE_SHA256, PROJECT_REF, TABLES }
  from "./apply-fvi-early-marketing-pii-boundary.mjs";

// One owner-confirmed identity, not a reusable arbitrary-account role editor.
export const OPERATOR_EMAIL = "Joseph.Ferdinand@reconiq.example";
export const VAULT_PATH = "./.private/CREDENTIALS.md";
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
export const IDENTITY_SQL = `select jsonb_build_object(
  'users',(select coalesce(jsonb_agg(jsonb_build_object(
    'id',u.id,'email',u.email,
    'usable',u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())
      and u.email_confirmed_at is not null,
    'platform_admin',exists(select 1 from public.platform_roles p
      where p.user_id=u.id and p.role::text='platform_admin'),
    'profiles',(select coalesce(jsonb_agg(jsonb_build_object('status',m.status)),'[]'::jsonb)
      from public.mkt_admin_users m where m.user_id=u.id),
    'roles',(select coalesce(jsonb_agg(jsonb_build_object('role',r.role::text,
      'granted_by',r.granted_by,'granted_at',r.granted_at) order by r.role::text),'[]'::jsonb)
      from public.mkt_admin_roles r where r.user_id=u.id)
    ) order by u.id),'[]'::jsonb)
    from auth.users u where lower(u.email)=lower(${literal(OPERATOR_EMAIL)}))
) as identity`;

export function assessIdentity(identity) {
  if (!Array.isArray(identity?.users) || identity.users.length!==1) {
    throw new Error("Marketing operator identity must match exactly one existing account");
  }
  const user=identity.users[0];
  if (typeof user.email!=="string" || user.email.toLowerCase()!==OPERATOR_EMAIL.toLowerCase()
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(user.id ?? "")
    || user.usable!==true || user.platform_admin!==true) {
    throw new Error("Marketing operator existing identity or platform-admin prerequisite failed");
  }
  if (!Array.isArray(user.profiles) || user.profiles.length>1
    || (user.profiles.length===1 && typeof user.profiles[0].status!=="string")
    || !Array.isArray(user.roles) || user.roles.length>1
    || user.roles.some((row)=>row.role!=="marketing_admin")) {
    throw new Error("Marketing operator unexpected existing profile or marketing role; review required");
  }
  return user.roles.length===1 && user.profiles[0]?.status==="active" ? "installed" : "ready";
}

export function assessBoundary(boundary) {
  // Empty queues are valid immediately before this owner-authorized bootstrap.
  // Reuse exact installed policy/source checks; do not waive privacy enforcement.
  if (assessState(boundary,true,true)!=="installed") {
    throw new Error("Marketing operator requires the exact installed early PII boundary");
  }
}

export function buildGrantSql(identity, boundary) {
  assessBoundary(boundary);
  if (assessIdentity(identity)!=="ready") throw new Error("Marketing operator already installed");
  const user=identity.users[0];
  const id=literal(user.id);
  return `BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE ${TABLES.map((table)=>`public.${table}`).join(",")} IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE auth.users,public.platform_roles,public.mkt_admin_users,public.mkt_admin_roles IN SHARE ROW EXCLUSIVE MODE;
DO $grant_operator$
BEGIN
  IF (SELECT state FROM (${STATE_SQL}) boundary) IS DISTINCT FROM ${literal(JSON.stringify(boundary))}::jsonb
    OR (SELECT identity FROM (${IDENTITY_SQL}) candidate) IS DISTINCT FROM ${literal(JSON.stringify(identity))}::jsonb THEN
    RAISE EXCEPTION 'Marketing operator identity or privacy boundary changed since preflight';
  END IF;
  INSERT INTO public.mkt_admin_users(user_id,status)
    VALUES (${id}::uuid,'active')
    ON CONFLICT (user_id) DO UPDATE SET status='active',updated_at=now()
      WHERE mkt_admin_users.status IS DISTINCT FROM 'active';
  INSERT INTO public.mkt_admin_roles(user_id,role,granted_by)
    VALUES (${id}::uuid,'marketing_admin'::public.mkt_admin_role,${id}::uuid)
    ON CONFLICT (user_id,role) DO NOTHING;
  INSERT INTO public.mkt_content_audit_log(entity_type,entity_key,action,actor_id,actor_email,"before","after",summary)
    VALUES ('admin_role',${id},'update',${id}::uuid,${literal(OPERATOR_EMAIL)},
      ${literal(JSON.stringify({profiles:user.profiles,roles:user.roles}))}::jsonb,
      '{"status":"active","role":"marketing_admin"}'::jsonb,
      'Owner explicitly authorized Marketing Admin lead-queue access; applied by controlled management script after early PII boundary verification.');
  IF (SELECT count(*) FROM public.mkt_admin_roles WHERE user_id=${id}::uuid)<>1
    OR NOT EXISTS(SELECT 1 FROM public.mkt_admin_roles WHERE user_id=${id}::uuid AND role::text='marketing_admin')
    OR NOT EXISTS(SELECT 1 FROM public.mkt_admin_users WHERE user_id=${id}::uuid AND status='active') THEN
    RAISE EXCEPTION 'Marketing operator final grant invariant failed';
  END IF;
END $grant_operator$;
COMMIT;`;
}

export async function runGrant({env=process.env,readText=readFile,request=fetch,emit=console.log}={}) {
  const source=await readText(`supabase/migrations/${VERSION}_${NAME}.sql`,"utf8");
  if (createHash("sha256").update(source).digest("hex")!==SOURCE_SHA256) {
    throw new Error("Marketing operator PII migration source checksum mismatch");
  }
  if (env.FVI_VAULT_PATH && path.resolve(env.FVI_VAULT_PATH)!==path.resolve(VAULT_PATH)) {
    throw new Error("Marketing operator must use the canonical FVI vault");
  }
  const vault=await readText(VAULT_PATH,"utf8");
  const beginMarker="<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->";
  const endMarker="<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->";
  const begin=vault.indexOf(beginMarker); const end=vault.indexOf(endMarker);
  if (begin<0 || end<=begin || vault.indexOf(beginMarker,begin+1)!==-1 || vault.indexOf(endMarker,end+1)!==-1) {
    throw new Error("Marketing operator canonical credential section unavailable or ambiguous");
  }
  const rows=vault.slice(begin,end).split(/\r?\n/u)
    .filter((line)=>/^\|\s*`SUPABASE_ACCESS_TOKEN`\s*\|/u.test(line));
  const token=rows.length===1 ? rows[0].split("|")[2]?.trim().replace(/^`|`$/gu,"") : null;
  if (!/^sbp_[A-Za-z0-9_-]{20,}$/u.test(token ?? "")) throw new Error("Marketing operator canonical Management access unavailable");
  async function query(statement,readOnly=true) {
    const response=await request(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,{
      method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},
      body:JSON.stringify({query:statement,read_only:readOnly}),signal:AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new Error("Marketing operator Management request failed; inspect protected diagnostics");
    return response.json();
  }
  const [identityRows,boundaryRows]=await Promise.all([query(IDENTITY_SQL),query(STATE_SQL)]);
  const identity=identityRows?.[0]?.identity; const boundary=boundaryRows?.[0]?.state;
  assessBoundary(boundary);
  const status=assessIdentity(identity);
  const result={ok:true,email:OPERATOR_EMAIL,identity_unique:true,platform_admin_verified:true,pii_boundary_verified:true};
  if (status==="installed") { emit(JSON.stringify({...result,reused:true,active:true,marketing_role_count:1})); return; }
  if (env.FVI_GRANT_MKT_LEAD_OPERATOR!=="YES") {
    emit(JSON.stringify({...result,dry_run:true,active:false,marketing_role_count:identity.users[0].roles.length})); return;
  }
  await query(buildGrantSql(identity,boundary),false);
  const [afterRows,afterBoundaryRows]=await Promise.all([query(IDENTITY_SQL),query(STATE_SQL)]);
  const after=afterRows?.[0]?.identity;
  assessBoundary(afterBoundaryRows?.[0]?.state);
  if (assessIdentity(after)!=="installed" || after.users[0].id!==identity.users[0].id) {
    throw new Error("Marketing operator write returned without exact identity and role readback");
  }
  emit(JSON.stringify({...result,applied:true,active:true,marketing_role_count:1}));
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  runGrant().catch(()=>{
    // Provider errors and request bodies can contain secrets/UUIDs. Never print them.
    console.error("Marketing operator grant failed closed; inspect guarded preflight and protected diagnostics.");
    process.exitCode=1;
  });
}
