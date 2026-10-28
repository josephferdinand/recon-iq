import { createHash, randomBytes } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const environment = process.env.FVI_BREAK_REPORT_ASSURANCE_ENV ?? "";
const targets = {
  prod: {
    tenantSlug: "reconiq-assurance-lab-prod",
    makerFile: "FVI-Assurance-Lab-Break-Report-API-Maker.md",
    checkerFile: "FVI-Assurance-Lab-Break-Report-API-Checker.md",
  },
  dev: {
    tenantSlug: "fvi-validation-lab-20260904",
    makerFile: "FVI-Assurance-Lab-Break-Report-API-Maker-DEV.md",
    checkerFile: "FVI-Assurance-Lab-Break-Report-API-Checker-DEV.md",
  },
};
const target = targets[environment];
if (!target) throw new Error("FVI_BREAK_REPORT_ASSURANCE_ENV must be prod or dev");
if (process.env.FVI_ALLOW_TOKEN_CANDIDATE_PREPARATION !== "YES") {
  throw new Error("Set FVI_ALLOW_TOKEN_CANDIDATE_PREPARATION=YES");
}
const makerPath = path.resolve(process.env.FVI_BREAK_REPORT_MAKER_VAULT_PATH ?? "");
const checkerPath = path.resolve(process.env.FVI_BREAK_REPORT_CHECKER_VAULT_PATH ?? "");
const sqlPath = path.resolve(process.env.FVI_BREAK_REPORT_TOKEN_SQL_PATH ?? "");
if (path.basename(makerPath) !== target.makerFile || path.basename(checkerPath) !== target.checkerFile) {
  throw new Error("Token candidates must use the environment-specific secured-vault files");
}
for (const candidate of [makerPath, checkerPath]) {
  try { await readFile(candidate, "utf8"); throw new Error(`Refusing to replace existing candidate ${path.basename(candidate)}`); }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
}

const maker = `fvi_${randomBytes(24).toString("hex")}`;
const checker = `fvi_${randomBytes(24).toString("hex")}`;
const scopes = ["breaks.write", "recons.read", "recons.run", "reports.read"];
const namePrefix = `Codex Assurance break/report API — ${environment.toUpperCase()}`;
const makerHash = createHash("sha256").update(maker).digest("hex");
const checkerHash = createHash("sha256").update(checker).digest("hex");
const sql = `begin;
do $$
declare
  target_tenant uuid;
  maker_user uuid;
  checker_user uuid;
begin
  select id into target_tenant from public.tenants where slug = '${target.tenantSlug}';
  if target_tenant is null then raise exception 'Assurance tenant not found'; end if;
  select user_id into maker_user from public.tenant_members where tenant_id=target_tenant and active and role='tenant_admin' order by joined_at asc limit 1;
  select user_id into checker_user from public.tenant_members where tenant_id=target_tenant and active and role='tenant_admin' and user_id<>maker_user order by joined_at asc limit 1;
  if maker_user is null or checker_user is null then raise exception 'Two active tenant administrators are required'; end if;
  if exists(select 1 from public.api_tokens where tenant_id=target_tenant and name in ('${namePrefix} maker','${namePrefix} checker')) then raise exception 'Assurance token already exists'; end if;
  insert into public.api_tokens(tenant_id,name,prefix,token_hash,scopes,created_by) values
    (target_tenant,'${namePrefix} maker','${maker.slice(0, 12)}','${makerHash}',array['${scopes.join("','")}'],maker_user),
    (target_tenant,'${namePrefix} checker','${checker.slice(0, 12)}','${checkerHash}',array['${scopes.join("','")}'],checker_user);
  insert into public.audit_log(actor_user_id,tenant_id,scope,action,resource_type,resource_id,context)
  select created_by,tenant_id,'tenant','test.break_report_api_token.provisioned','api_tokens',id,jsonb_build_object('synthetic',true,'role',case when name like '% maker' then 'maker' else 'checker' end,'scopes',scopes)
  from public.api_tokens where tenant_id=target_tenant and name in ('${namePrefix} maker','${namePrefix} checker');
end $$;
commit;
select name,id,created_by,scopes,revoked_at from public.api_tokens where tenant_id=(select id from public.tenants where slug='${target.tenantSlug}') and name in ('${namePrefix} maker','${namePrefix} checker') order by name;
`;

function vaultDocument(role, raw) {
  return [
    `# ReconIQ — Assurance Lab Break/Report API ${role}`,
    "",
    `- Environment: ${environment.toUpperCase()} synthetic assurance tenant only`,
    `- Tenant slug: ${target.tenantSlug}`,
    `- Role: ${role.toLowerCase()} for independent write-off proof`,
    `- Scopes: ${scopes.join(", ")}`,
    "- Status: candidate only until the reviewed hash-only SQL insert is confirmed and executed",
    "",
    `- API token: \`${raw}\``,
    "",
    "> Never copy this token into Git, logs, Graphify, Obsidian, or chat.",
    "> Do not rotate, revoke, replace, or rescope it without owner approval.",
    "",
  ].join("\n");
}

await Promise.all([
  writeFile(makerPath, vaultDocument("Maker", maker), { encoding: "utf8", mode: 0o600 }),
  writeFile(checkerPath, vaultDocument("Checker", checker), { encoding: "utf8", mode: 0o600 }),
  writeFile(sqlPath, sql, { encoding: "utf8", mode: 0o600 }),
]);
await Promise.all([chmod(makerPath, 0o600), chmod(checkerPath, 0o600), chmod(sqlPath, 0o600)]).catch(() => undefined);
console.log(JSON.stringify({ ok: true, environment, candidatesWritten: 2, sqlContainsRawTokens: sql.includes(maker) || sql.includes(checker) }));
