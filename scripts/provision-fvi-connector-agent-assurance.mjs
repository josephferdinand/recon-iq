import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

if (process.env.FVI_ALLOW_CONNECTOR_AGENT_ASSURANCE !== "YES")
  throw new Error("Set FVI_ALLOW_CONNECTOR_AGENT_ASSURANCE=YES");

const ref = "YOUR_PROJECT_REF";
const tenantSlug = "reconiq-assurance-lab-prod";
const agentId = "fvi-assurance-agent-prod-01";
const url = process.env.SUPABASE_URL ?? "";
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const vaultPath = process.env.FVI_CONNECTOR_AGENT_TOKEN_VAULT_PATH ?? "";
const sftpHostKey = process.env.FVI_ASSURANCE_SFTP_HOST_KEY_SHA256 ?? "SHA256:pending-live-fixture";
if (!url.includes(ref) || !serviceRole) throw new Error("Supabase PROD identity guard failed");
if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "FVI-Assurance-Lab-Connector-Agent-PROD.md")
  throw new Error("Connector-agent token output must be its exact secured-vault file");

const sb = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: tenant, error: tenantError } = await sb.from("tenants")
  .select("id,name,slug,environment").eq("slug", tenantSlug).single();
if (tenantError || !tenant || tenant.environment !== "prod")
  throw tenantError ?? new Error("Assurance Lab PROD tenant guard failed");
const { data: creator, error: creatorError } = await sb.from("tenant_members")
  .select("user_id").eq("tenant_id", tenant.id).eq("role", "tenant_admin").eq("active", true).limit(1).single();
if (creatorError || !creator?.user_id) throw creatorError ?? new Error("No active tenant administrator exists");

const definitions = [
  {
    type: "local",
    sourceName: "Assurance Agent — Local Nostro Cash",
    scheduleName: "Assurance Agent Local Folder — PROD",
    config: { agent_id: agentId, root_alias: "fvi-local-assurance", relative_path: ".", file_pattern: "nostro-cash-20260905.csv", format: "csv", max_files: 1, max_bytes: 1048576 },
  },
  {
    type: "network_drive",
    sourceName: "Assurance Agent — Network Settlements",
    scheduleName: "Assurance Agent Network Drive — PROD",
    config: { agent_id: agentId, root_alias: "fvi-network-assurance", relative_path: ".", file_pattern: "settlements-20260905.csv", format: "csv", max_files: 1, max_bytes: 1048576 },
  },
  {
    type: "sftp",
    sourceName: "Assurance Agent — SFTP Custody Positions",
    scheduleName: "Assurance Agent SFTP — PROD",
    config: { agent_id: agentId, host: "127.0.0.1", port: 2222, remote_path: "/upload", file_pattern: "custody-positions-20260905.csv", credential_ref: "fvi-assurance-sftp", host_key_sha256: sftpHostKey, format: "csv", max_files: 1, max_bytes: 1048576 },
  },
  {
    type: "ftp",
    sourceName: "Assurance Agent — FTP Fund NAV",
    scheduleName: "Assurance Agent FTP — PROD",
    config: { agent_id: agentId, host: "127.0.0.1", port: 2121, remote_path: "/", file_pattern: "fund-nav-20260905.csv", credential_ref: "fvi-assurance-ftp", secure: false, format: "csv", max_files: 1, max_bytes: 1048576 },
  },
];

const schedules = [];
for (const definition of definitions) {
  let { data: source, error: sourceError } = await sb.from("workspace_data_sources")
    .select("id,name,source_type,status").eq("tenant_id", tenant.id).eq("name", definition.sourceName).maybeSingle();
  if (sourceError) throw sourceError;
  if (!source) {
    const created = await sb.from("workspace_data_sources").insert({
      tenant_id: tenant.id,
      name: definition.sourceName,
      description: `Retained realistic synthetic ${definition.type} connector-agent assurance source`,
      source_type: "csv",
      status: "ready",
      created_by: creator.user_id,
    }).select("id,name,source_type,status").single();
    if (created.error || !created.data) throw created.error ?? new Error("Agent source creation failed");
    source = created.data;
  }
  let { data: schedule, error: scheduleError } = await sb.from("data_source_schedules")
    .select("id,name,connector_type,data_source_id,config").eq("tenant_id", tenant.id)
    .eq("name", definition.scheduleName).maybeSingle();
  if (scheduleError) throw scheduleError;
  if (schedule) {
    if (schedule.connector_type !== definition.type || schedule.data_source_id !== source.id)
      throw new Error(`Existing ${definition.type} assurance schedule differs; refusing replacement`);
    const updated = await sb.from("data_source_schedules").update({ config: definition.config })
      .eq("id", schedule.id).eq("tenant_id", tenant.id).select("id,name,connector_type,data_source_id,config").single();
    if (updated.error || !updated.data) throw updated.error ?? new Error("Agent schedule update failed");
    schedule = updated.data;
  } else {
    const created = await sb.from("data_source_schedules").insert({
      tenant_id: tenant.id,
      data_source_id: source.id,
      name: definition.scheduleName,
      connector_type: definition.type,
      config: definition.config,
      transformation: [],
      cron_expression: "0 * * * *",
      enabled: false,
      created_by: creator.user_id,
    }).select("id,name,connector_type,data_source_id,config").single();
    if (created.error || !created.data) throw created.error ?? new Error("Agent schedule creation failed");
    schedule = created.data;
  }
  schedules.push({ type: definition.type, schedule_id: schedule.id, data_source_id: source.id });
}

const tokenName = "Codex Assurance connector agent — PROD";
const scopes = ["connectors.agent"];
const { data: existing, error: tokenError } = await sb.from("api_tokens")
  .select("id,token_hash,scopes,revoked_at").eq("tenant_id", tenant.id).eq("name", tokenName).maybeSingle();
if (tokenError) throw tokenError;
let raw = "";
try {
  raw = (await readFile(vaultPath, "utf8")).match(/^- API token: `([^`]+)`$/mu)?.[1] ?? "";
} catch { /* first creation */ }
let tokenId = existing?.id ?? "";
if (existing) {
  if (existing.revoked_at) throw new Error("Existing connector-agent token is revoked; owner action required");
  if (!raw || createHash("sha256").update(raw).digest("hex") !== existing.token_hash)
    throw new Error("Existing connector-agent token does not match secured vault; refusing replacement");
  if (JSON.stringify([...(existing.scopes ?? [])].sort()) !== JSON.stringify(scopes))
    throw new Error("Existing connector-agent token scope differs; refusing rescope");
} else {
  raw = `fvi_agent_${randomBytes(24).toString("hex")}`;
  const created = await sb.from("api_tokens").insert({
    tenant_id: tenant.id,
    name: tokenName,
    prefix: raw.slice(0, 12),
    token_hash: createHash("sha256").update(raw).digest("hex"),
    scopes,
    created_by: creator.user_id,
  }).select("id").single();
  if (created.error || !created.data) throw created.error ?? new Error("Connector-agent token creation failed");
  tokenId = created.data.id;
  const audit = await sb.from("audit_log").insert({
    actor_user_id: creator.user_id,
    tenant_id: tenant.id,
    scope: "tenant",
    action: "test.connector_agent_token.provisioned",
    resource_type: "api_tokens",
    resource_id: tokenId,
    context: { synthetic: true, scopes, agent_id: agentId, schedule_ids: schedules.map((item) => item.schedule_id) },
  });
  if (audit.error) throw audit.error;
}

await writeFile(vaultPath, [
  "# ReconIQ — Assurance Lab Connector Agent",
  "",
  "- Environment: PROD synthetic assurance tenant only",
  `- Tenant: ${tenant.name}`,
  `- Tenant slug: ${tenant.slug}`,
  `- Agent ID: ${agentId}`,
  `- Token row ID: ${tokenId}`,
  `- Scopes: ${scopes.join(", ")}`,
  `- Schedule IDs: ${schedules.map((item) => `${item.type}=${item.schedule_id}`).join(", ")}`,
  "- Purpose: retained on-premises connector-agent assurance",
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
  environment: "prod",
  tenant_id: tenant.id,
  agent_id: agentId,
  token_id: tokenId,
  token_reused: Boolean(existing),
  token_saved: true,
  schedules,
}));
