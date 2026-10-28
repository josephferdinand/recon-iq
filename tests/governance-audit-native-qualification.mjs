// Native read-policy/helper qualification using parent-captured metadata only.
// Synthetic nullable table projections omit defaults/FKs/checks/write triggers;
// this proves read SQL semantics, not native Auth login, full migrations or hosting.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const catalogRoot = process.env.FVI_GOVERNANCE_CATALOG_ROOT;
const environment = process.env.FVI_GOVERNANCE_CATALOG_ENV ?? "PROD";
if (!catalogRoot || !["PROD", "DEV"].includes(environment)) throw new Error("Set exact metadata root and PROD/DEV catalog environment");
const hashes = {}, captures = [];
for (const suffix of ["", "-EXTENDED", "-SUPPLEMENT"]) {
  const name = `FVI-GOVERNANCE-CATALOG-${environment}${suffix}-20261002.json`;
  const bytes = readFileSync(join(catalogRoot, name));
  hashes[name] = createHash("sha256").update(bytes).digest("hex");
  const document = JSON.parse(bytes);
  if (document.read_only !== true || !document.rows?.[0]?.catalog) throw new Error("Not a parent read-only metadata catalog");
  captures.push(document.rows[0].catalog);
}
const q = value => `"${String(value).replaceAll('"', '""')}"`;
const lit = value => `'${String(value).replaceAll("'", "''")}'`;
const tableNames = ["tenant_members", "profiles", "platform_roles", "rbac_user_grants", "rbac_role_permissions", "tenant_group_members", "tenant_groups", "tenant_group_roles", "bu_group_assignments", "audit_log"];
const columns = new Map();
for (const c of captures.flatMap(c => c.columns ?? [])) if (tableNames.includes(c.table)) columns.set(`${c.table}.${c.name}`, c);
const helpers = new Map();
for (const h of captures.flatMap(c => c.helpers ?? [])) helpers.set(`${h.schema}.${h.name}`, h);
const helperOrder = ["auth.uid", "auth.role", "auth.jwt", "private.has_platform_role", "private.is_platform_admin", "public.is_platform_admin", "private.has_tenant_role", "public.has_tenant_role", "private.is_tenant_member", "public.is_tenant_member", "public.effective_user_permissions", "public.user_has_permission"];
for (const key of helperOrder) if (!helpers.has(key)) throw new Error(`Missing actual helper ${key}; do not stub`);
const uncapturedOwnerOrAcl = helperOrder.filter(key => !Object.hasOwn(helpers.get(key), "owner") || !Object.hasOwn(helpers.get(key), "acl"));
const enumGroups = new Map();
for (const e of captures.flatMap(c => c.enums ?? [])) {
  const key = `${e.schema}.${e.name}`;
  const group = enumGroups.get(key) ?? new Map(); group.set(e.order, e.value); enumGroups.set(key, group);
}
const neededTypes = new Set([...columns.values()].map(c => c.type.replace(/\[\]$/u, "")));
neededTypes.add("tenant_role"); neededTypes.add("platform_role");
let sql = "CREATE SCHEMA auth; CREATE SCHEMA private; CREATE EXTENSION citext; CREATE EXTENSION ltree; CREATE EXTENSION pgcrypto;\n";
sql += "CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role BYPASSRLS; CREATE ROLE supabase_auth_admin; CREATE ROLE dashboard_user;\nGRANT USAGE ON SCHEMA public,auth,private TO authenticated,anon,service_role;\n";
for (const [key, values] of enumGroups) {
  const [schema,name] = key.split(".");
  if (neededTypes.has(name) || neededTypes.has(key)) sql += `CREATE TYPE ${q(schema)}.${q(name)} AS ENUM (${[...values].sort((a,b)=>a[0]-b[0]).map(([,v])=>lit(v)).join(",")});\n`;
}
for (const table of tableNames) {
  const cols = [...columns.values()].filter(c => c.table === table).sort((a,b)=>a.position-b.position);
  if (!cols.length) throw new Error(`Missing actual table projection ${table}`);
  sql += `CREATE TABLE public.${q(table)} (${cols.map(c=>`${q(c.name)} ${c.type}`).join(",")});\nGRANT SELECT ON public.${q(table)} TO authenticated;\n`;
}
for (const key of helperOrder) {
  const h = helpers.get(key);
  sql += h.definition + ";\n";
  const signature = `${q(h.schema)}.${q(h.name)}(${h.identity})`;
  sql += `ALTER FUNCTION ${signature} OWNER TO ${q(h.owner ?? "postgres")};\nREVOKE ALL ON FUNCTION ${signature} FROM PUBLIC,anon,authenticated,service_role;\n`;
  for (const role of ["PUBLIC", "anon", "authenticated", "service_role"]) {
    const acl = String(h.acl ?? "");
    if (role === "PUBLIC" ? /(?:\{|,)=X\//u.test(acl) : new RegExp(`(?:\\{|,)${role}=X/`, "u").test(acl)) sql += `GRANT EXECUTE ON FUNCTION ${signature} TO ${role};\n`;
  }
}
for (const table of ["audit_log", "profiles", "tenant_members"]) {
  sql += `ALTER TABLE public.${q(table)} ENABLE ROW LEVEL SECURITY;\n`;
  const policies = captures.flatMap(c=>c.policies??[]).filter(p=>p.tablename===table);
  const unique = new Map(policies.map(p=>[p.policyname,p]));
  if (!unique.size) throw new Error(`Missing actual policies ${table}`);
  for (const p of unique.values()) sql += `CREATE POLICY ${q(p.policyname)} ON public.${q(table)} AS ${p.permissive} FOR ${p.cmd} TO ${p.roles.map(r=>r==="public"?"PUBLIC":q(r)).join(",")}${p.qual?` USING (${p.qual})`:""}${p.with_check?` WITH CHECK (${p.with_check})`:""};\n`;
}

const t = "fa010000-0000-4000-8000-000000000001", tb = "fa010000-0000-4000-8000-000000000002";
const a = "fa010000-0000-4000-8000-000000000011", viewer = "fa010000-0000-4000-8000-000000000012", inactive = "fa010000-0000-4000-8000-000000000013", platform = "fa010000-0000-4000-8000-000000000014", outsider = "fa010000-0000-4000-8000-000000000015";
const role = "fa010000-0000-4000-8000-000000000021", group = "fa010000-0000-4000-8000-000000000031";
sql += `INSERT INTO public.tenant_members(tenant_id,user_id,role,active) VALUES
('${t}','${a}','tenant_admin',true),('${t}','${viewer}','tenant_viewer',true),('${t}','${inactive}','tenant_admin',false),('${tb}','${outsider}','tenant_admin',true);
INSERT INTO public.platform_roles(user_id,role) VALUES('${platform}','platform_admin');
INSERT INTO public.profiles(id,full_name) VALUES('${a}','Synthetic admin'),('${viewer}','Synthetic viewer');
INSERT INTO public.rbac_role_permissions(role_id,permission_id) VALUES('${role}','audit.log.read'),('${role}','audit.log.export');
INSERT INTO public.rbac_user_grants(user_id,tenant_id,role_id,scope_type,revoked_at,expires_at) VALUES('${a}','${t}','${role}','tenant',NULL,NULL);
INSERT INTO public.audit_log(id,tenant_id,actor_user_id,occurred_at,scope,action,context)
 SELECT n,'${t}'::uuid,CASE WHEN n%2=0 THEN '${viewer}'::uuid ELSE '${a}'::uuid END,now(),'tenant','governance.membership.approve',jsonb_build_object('outcome','grant_confirmed') FROM generate_series(1,31) n;
INSERT INTO public.audit_log(id,tenant_id,actor_user_id,occurred_at,scope,action,context) VALUES(32,'${tb}','${outsider}',now(),'tenant','governance.membership.approve','{}');
`;
let guards = 0;
function caller(actor) { return `RESET ROLE; SET ROLE authenticated; SELECT set_config('request.jwt.claim.role','authenticated',false),set_config('request.jwt.claim.sub','${actor}',false);\n`; }
function assertion(expression, label) { guards++; return `DO $assert$ BEGIN IF (${expression}) IS DISTINCT FROM true THEN RAISE EXCEPTION ${lit(label)}; END IF; END $assert$;\n`; }
const activeAdmin = `(SELECT EXISTS(SELECT 1 FROM public.tenant_members WHERE tenant_id='${t}' AND user_id=auth.uid() AND active AND role='tenant_admin'))`;
sql += caller(a);
sql += assertion(activeAdmin, "active current admin membership");
sql += assertion(`public.user_has_permission(auth.uid(),'${t}','audit.log.read',NULL)`, "actual direct audit permission");
sql += assertion(`(SELECT count(*)=31 FROM public.audit_log WHERE tenant_id='${t}' AND action='governance.membership.approve')`, "tenant filtered full audit total");
sql += assertion(`(SELECT count(*)=6 FROM (SELECT id FROM public.audit_log WHERE tenant_id='${t}' ORDER BY occurred_at DESC,id DESC OFFSET 25 LIMIT 25) r)`, "actual policy page2");
sql += assertion(`(SELECT count(*)=1 FROM public.profiles WHERE id IN ('${a}','${viewer}'))`, "ordinary admin cannot bypass profiles RLS");
sql += caller(viewer);
sql += assertion(`NOT ${activeAdmin}`, "viewer denied admin read port");
sql += assertion(`NOT public.user_has_permission(auth.uid(),'${t}','audit.log.read',NULL)`, "ungranted viewer permission false");
sql += assertion(`(SELECT count(*)=15 FROM public.audit_log WHERE tenant_id='${t}')`, "ordinary viewer native policy self-only audit");
sql += caller(inactive); sql += assertion(`NOT ${activeAdmin}`, "inactive admin denied by current active membership gate");
sql += caller(platform); sql += assertion(`NOT ${activeAdmin}`, "platform-only denied tenant read port");
sql += caller(outsider); sql += assertion(`NOT ${activeAdmin}`, "wrong tenant caller denied");
sql += assertion(`(SELECT count(*)=0 FROM public.audit_log WHERE tenant_id='${t}')`, "cross-tenant audit RLS denies");
sql += `RESET ROLE; UPDATE public.rbac_user_grants SET revoked_at=now() WHERE user_id='${a}';\n`;
sql += caller(a); sql += assertion(`NOT public.user_has_permission(auth.uid(),'${t}','audit.log.read',NULL)`, "actual revoked direct permission denied");
sql += `RESET ROLE; UPDATE public.rbac_user_grants SET revoked_at=NULL,expires_at=now()-interval '1 second' WHERE user_id='${a}';\n`;
sql += caller(a); sql += assertion(`NOT public.user_has_permission(auth.uid(),'${t}','audit.log.read',NULL)`, "actual expired direct permission denied");
sql += `RESET ROLE; INSERT INTO public.tenant_groups(id,tenant_id,name) VALUES('${group}','${t}','Synthetic group');
INSERT INTO public.tenant_group_members(group_id,user_id) VALUES('${group}','${a}');
INSERT INTO public.tenant_group_roles(group_id,role_id) VALUES('${group}','${role}');\n`;
sql += caller(a); sql += assertion(`public.user_has_permission(auth.uid(),'${t}','audit.log.read',NULL)`, "actual group permission positive");
sql += `RESET ROLE; DELETE FROM public.tenant_group_members WHERE group_id='${group}' AND user_id='${a}';\n`;
sql += caller(a); sql += assertion(`NOT public.user_has_permission(auth.uid(),'${t}','audit.log.read',NULL)`, "actual group membership revocation denied");
sql += "RESET ROLE; SELECT version();\n";

const name = `fvi-hume-audit-read-${randomUUID().slice(0,8)}`;
const output = join(tmpdir(),`${name}-20261002`); mkdirSync(output);
writeFileSync(join(output,"qualification.sql"),sql);
function docker(args, input) { const r=spawnSync("docker",args,{input,encoding:"utf8",timeout:30000,maxBuffer:2*1024*1024}); if(r.error||r.status!==0) throw new Error(`${args[0]} failed: ${r.error?.message??r.stderr}`); return r.stdout; }
let created=false, receipt;
try {
  docker(["run","-d","--name",name,"--label","fvi.owner=hume-audit-read","-e","POSTGRES_HOST_AUTH_METHOD=trust","postgres:17.6-alpine"]); created=true;
  for(let n=0;n<30;n++){ const r=spawnSync("docker",["exec",name,"pg_isready","-U","postgres"],{encoding:"utf8",timeout:1000}); if(r.status===0)break; if(n===29)throw new Error("Own disposable PG health unavailable"); await new Promise(resolve=>setTimeout(resolve,250)); }
  const result=docker(["exec","-i",name,"psql","-U","postgres","-v","ON_ERROR_STOP=1"],sql);
  writeFileSync(join(output,"qualification.log"),result);
  if (!/PostgreSQL 17\.6 /u.test(result)) throw new Error("Fixture engine differs from captured PG17.6");
  receipt={status:"PASS",guards,environment,container:name,fixture_engine:result.match(/PostgreSQL[^\r\n]+/u)?.[0]??null,uncaptured_owner_or_acl:uncapturedOwnerOrAcl,metadata_sha256:hashes,sql_sha256:createHash("sha256").update(sql).digest("hex"),scope:"Captured helper bodies/read policies, synthetic nullable projections; omitted metadata uses fixture owner postgres, not a hosted owner/ACL claim; not native Auth login/full migrations/hosting",output};
} catch(error) { receipt={status:"FAIL",environment,container:name,error:error.message,metadata_sha256:hashes,output}; process.exitCode=1; }
finally { if(created)try{docker(["stop",name]);}catch(error){receipt.stop_error=error.message;} }
writeFileSync(join(output,"receipt.json"),JSON.stringify(receipt,null,2)); console.log(JSON.stringify(receipt));
