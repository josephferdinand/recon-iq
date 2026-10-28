import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const PROD_REF = "YOUR_PROJECT_REF";
const TENANT_SLUG = "reconiq-assurance-lab-prod";
const TOKEN_NAME = "Codex Assurance workflow API";
const scopes = ["data-prep.run", "recons.run"];

if (process.env.FVI_ALLOW_PROD_WORKFLOW_API_ASSURANCE !== "YES") {
  throw new Error("Set FVI_ALLOW_PROD_WORKFLOW_API_ASSURANCE=YES for this synthetic PROD token");
}
const url = process.env.SUPABASE_URL ?? "";
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const vaultPath = process.env.FVI_WORKFLOW_API_TOKEN_VAULT_PATH ?? "";
if (!url.includes(PROD_REF) || !serviceRole) throw new Error("PROD Supabase identity guard failed");
if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "FVI-Assurance-Lab-Workflow-API.md") {
  throw new Error("Workflow token output must be the named secured-vault file");
}

const sb = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: tenant } = await sb.from("tenants").select("id,name,slug,environment").eq("slug", TENANT_SLUG).single();
if (!tenant || tenant.environment !== "prod") throw new Error("Assurance Lab PROD tenant guard failed");
const { data: creator } = await sb.from("tenant_members").select("user_id").eq("tenant_id", tenant.id).eq("role", "tenant_admin").limit(1).single();
if (!creator?.user_id) throw new Error("No tenant administrator exists for attribution");

const { data: existing } = await sb.from("api_tokens").select("id,token_hash,scopes,revoked_at").eq("tenant_id", tenant.id).eq("name", TOKEN_NAME).maybeSingle();
let raw = "";
try {
  raw = (await readFile(vaultPath, "utf8")).match(/^- API token: `([^`]+)`$/mu)?.[1] ?? "";
} catch { /* first creation */ }

let tokenId = existing?.id ?? "";
if (existing) {
  if (existing.revoked_at) throw new Error("Existing workflow token is revoked; owner action required");
  if (!raw || createHash("sha256").update(raw).digest("hex") !== existing.token_hash) {
    throw new Error("Existing workflow token does not match the secured-vault copy; refusing replacement");
  }
  if (JSON.stringify([...(existing.scopes ?? [])].sort()) !== JSON.stringify([...scopes].sort())) {
    throw new Error("Existing workflow token scope differs; refusing rescope");
  }
} else {
  raw = `fvi_${randomBytes(24).toString("hex")}`;
  const { data: created, error } = await sb.from("api_tokens").insert({
    tenant_id: tenant.id,
    name: TOKEN_NAME,
    prefix: raw.slice(0, 12),
    token_hash: createHash("sha256").update(raw).digest("hex"),
    scopes,
    created_by: creator.user_id,
  }).select("id").single();
  if (error || !created) throw error ?? new Error("Workflow API token creation failed");
  tokenId = created.id;
  await sb.from("audit_log").insert({
    actor_user_id: creator.user_id,
    tenant_id: tenant.id,
    scope: "tenant",
    action: "test.workflow_api_token.provisioned",
    resource_type: "api_tokens",
    resource_id: tokenId,
    context: { synthetic: true, scopes },
  });
}

await writeFile(vaultPath, [
  "# ReconIQ — Assurance Lab Workflow API",
  "",
  "- Environment: PROD synthetic assurance tenant only",
  `- Tenant: ${tenant.name}`,
  `- Tenant slug: ${tenant.slug}`,
  `- Token row ID: ${tokenId}`,
  `- Scopes: ${scopes.join(", ")}`,
  "- Purpose: retained queued Data Prep and reconciliation API validation",
  "",
  `- API token: \`${raw}\``,
  "",
  "> Never copy this token into Git, logs, Graphify, Obsidian, or chat.",
  "> Do not rotate, revoke, replace, or rescope it without owner approval.",
  "",
].join("\n"), { encoding: "utf8", mode: 0o600 });
await chmod(vaultPath, 0o600).catch(() => undefined);
console.log(JSON.stringify({ ok: true, tenant_id: tenant.id, token_id: tokenId, scopes, token_saved: true, token_reused: Boolean(existing) }));
