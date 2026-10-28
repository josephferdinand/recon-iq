import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const environment = process.env.FVI_CONNECTOR_ASSURANCE_ENV ?? "prod";
const targets = {
  prod: {
    ref: "YOUR_PROJECT_REF",
    tenantSlug: "reconiq-assurance-lab-prod",
    vaultFile: "FVI-Assurance-Lab-Connector-API.md",
  },
  dev: {
    ref: "YOUR_PROJECT_REF",
    tenantSlug: "fvi-validation-lab-20260904",
    vaultFile: "FVI-Assurance-Lab-Connector-API-DEV.md",
  },
};
const target = targets[environment];
if (!target) throw new Error("FVI_CONNECTOR_ASSURANCE_ENV must be prod or dev");
if (process.env.FVI_ALLOW_CONNECTOR_API_ASSURANCE !== "YES") {
  throw new Error("Set FVI_ALLOW_CONNECTOR_API_ASSURANCE=YES for this synthetic fixture action");
}

const url = process.env.SUPABASE_URL ?? "";
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const vaultPath = process.env.FVI_CONNECTOR_API_TOKEN_VAULT_PATH ?? "";
if (!url.includes(target.ref) || !serviceRole) throw new Error("Supabase environment identity guard failed");
if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== target.vaultFile) {
  throw new Error("Connector token output must be the environment-specific secured-vault file");
}

const sb = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: tenant, error: tenantError } = await sb.from("tenants")
  .select("id,name,slug,environment").eq("slug", target.tenantSlug).single();
if (tenantError || !tenant || tenant.environment !== environment) {
  throw tenantError ?? new Error("Assurance tenant identity guard failed");
}
const { data: creator, error: creatorError } = await sb.from("tenant_members")
  .select("user_id").eq("tenant_id", tenant.id).eq("role", "tenant_admin").limit(1).single();
if (creatorError || !creator?.user_id) throw creatorError ?? new Error("No tenant administrator exists");
const { data: source, error: sourceError } = await sb.from("workspace_data_sources")
  .select("id,name,status").eq("tenant_id", tenant.id).eq("status", "ready")
  .order("updated_at", { ascending: false }).limit(1).single();
if (sourceError || !source) throw sourceError ?? new Error("No ready Assurance data source exists");

const scheduleName = `Assurance HTTPS Direct Connector — ${environment.toUpperCase()}`;
let { data: schedule, error: scheduleError } = await sb.from("data_source_schedules")
  .select("id,connector_type,data_source_id").eq("tenant_id", tenant.id)
  .eq("name", scheduleName).maybeSingle();
if (scheduleError) throw scheduleError;
if (schedule) {
  if (schedule.connector_type !== "https" || schedule.data_source_id !== source.id) {
    throw new Error("Existing Assurance connector schedule differs; refusing replacement");
  }
} else {
  const created = await sb.from("data_source_schedules").insert({
    tenant_id: tenant.id,
    data_source_id: source.id,
    name: scheduleName,
    connector_type: "https",
    config: { url: "https://jsonplaceholder.typicode.com/users", method: "GET", headers: {} },
    transformation: [],
    cron_expression: "0 * * * *",
    enabled: false,
    created_by: creator.user_id,
  }).select("id,connector_type,data_source_id").single();
  if (created.error || !created.data) throw created.error ?? new Error("Connector schedule creation failed");
  schedule = created.data;
}

const tokenName = `Codex Assurance connector API — ${environment.toUpperCase()}`;
const scopes = ["connectors.run"];
const { data: existing, error: tokenLookupError } = await sb.from("api_tokens")
  .select("id,token_hash,scopes,revoked_at").eq("tenant_id", tenant.id)
  .eq("name", tokenName).maybeSingle();
if (tokenLookupError) throw tokenLookupError;
let raw = "";
try {
  raw = (await readFile(vaultPath, "utf8")).match(/^- API token: `([^`]+)`$/mu)?.[1] ?? "";
} catch { /* first creation */ }

let tokenId = existing?.id ?? "";
if (existing) {
  if (existing.revoked_at) throw new Error("Existing connector token is revoked; owner action required");
  if (!raw || createHash("sha256").update(raw).digest("hex") !== existing.token_hash) {
    throw new Error("Existing connector token does not match secured vault; refusing replacement");
  }
  if (JSON.stringify([...(existing.scopes ?? [])].sort()) !== JSON.stringify(scopes)) {
    throw new Error("Existing connector token scope differs; refusing rescope");
  }
} else {
  raw = `fvi_${randomBytes(24).toString("hex")}`;
  const created = await sb.from("api_tokens").insert({
    tenant_id: tenant.id,
    name: tokenName,
    prefix: raw.slice(0, 12),
    token_hash: createHash("sha256").update(raw).digest("hex"),
    scopes,
    created_by: creator.user_id,
  }).select("id").single();
  if (created.error || !created.data) throw created.error ?? new Error("Connector token creation failed");
  tokenId = created.data.id;
  await sb.from("audit_log").insert({
    actor_user_id: creator.user_id,
    tenant_id: tenant.id,
    scope: "tenant",
    action: "test.connector_api_token.provisioned",
    resource_type: "api_tokens",
    resource_id: tokenId,
    context: { synthetic: true, scopes, schedule_id: schedule.id },
  });
}

await writeFile(vaultPath, [
  "# ReconIQ — Assurance Lab Connector API",
  "",
  `- Environment: ${environment.toUpperCase()} synthetic assurance tenant only`,
  `- Tenant: ${tenant.name}`,
  `- Tenant slug: ${tenant.slug}`,
  `- Schedule: ${scheduleName}`,
  `- Schedule ID: ${schedule.id}`,
  `- Token row ID: ${tokenId}`,
  `- Scopes: ${scopes.join(", ")}`,
  "- Purpose: retained queued direct-connector API validation",
  "",
  `- API token: \`${raw}\``,
  "",
  "> Never copy this token into Git, logs, Graphify, Obsidian, or chat.",
  "> Do not rotate, revoke, replace, or rescope it without owner approval.",
  "",
].join("\n"), { encoding: "utf8", mode: 0o600 });
await chmod(vaultPath, 0o600).catch(() => undefined);

console.log(JSON.stringify({
  ok: true,
  environment,
  tenant_id: tenant.id,
  data_source_id: source.id,
  schedule_id: schedule.id,
  token_id: tokenId,
  token_reused: Boolean(existing),
  token_saved: true,
}));
