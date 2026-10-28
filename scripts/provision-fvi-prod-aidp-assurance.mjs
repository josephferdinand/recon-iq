import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const targetEnvironment = process.env.FVI_AIDP_ASSURANCE_ENV ?? "prod";
const targets = {
  prod: {
    ref: "YOUR_PROJECT_REF",
    tenantSlug: "reconiq-assurance-lab-prod",
    vaultFile: "FVI-Assurance-Lab-AIDP-API.md",
  },
  dev: {
    ref: "YOUR_PROJECT_REF",
    tenantSlug: "fvi-validation-lab-20260904",
    vaultFile: "FVI-Assurance-Lab-AIDP-API-DEV.md",
  },
};
const target = targets[targetEnvironment];
if (!target) throw new Error("FVI_AIDP_ASSURANCE_ENV must be prod or dev");
const TOKEN_NAME = `Codex Assurance AIDP extraction — ${targetEnvironment.toUpperCase()}`;
const DOCUMENT_TYPE_CODE = "assurance_bank_statement";

if (process.env.FVI_ALLOW_AIDP_ASSURANCE !== "YES"
    && !(targetEnvironment === "prod" && process.env.FVI_ALLOW_PROD_AIDP_ASSURANCE === "YES")) {
  throw new Error("Set FVI_ALLOW_AIDP_ASSURANCE=YES for this synthetic fixture action");
}

const url = process.env.SUPABASE_URL ?? "";
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const vaultPath = process.env.FVI_AIDP_TOKEN_VAULT_PATH ?? "";
if (!url.includes(target.ref) || !serviceRole) throw new Error(`${targetEnvironment.toUpperCase()} Supabase identity guard failed`);
if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== target.vaultFile) {
  throw new Error("AIDP token output must be the named secured-vault file");
}

const sb = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: tenant, error: tenantError } = await sb.from("tenants")
  .select("id,name,slug,environment,ai_enabled")
  .eq("slug", target.tenantSlug).single();
if (tenantError || !tenant || tenant.environment !== targetEnvironment || !tenant.ai_enabled) {
  throw new Error(tenantError?.message ?? `Assurance Lab ${targetEnvironment.toUpperCase()} tenant guard failed`);
}

const { data: creator } = await sb.from("tenant_members")
  .select("user_id").eq("tenant_id", tenant.id).eq("role", "tenant_admin").limit(1).single();
if (!creator?.user_id) throw new Error("No tenant administrator exists for attribution");

const { data: project, error: projectError } = await sb.from("aidp_projects").upsert({
  tenant_id: tenant.id,
  slug: "assurance-bank-statements",
  name: "Assurance Lab Bank Statements",
  description: "Retained synthetic bank-statement extraction validation.",
  created_by: creator.user_id,
}, { onConflict: "tenant_id,slug" }).select("id").single();
if (projectError || !project) throw projectError ?? new Error("AIDP project provisioning failed");

const { data: documentType, error: documentTypeError } = await sb.from("aidp_document_types").upsert({
  tenant_id: tenant.id,
  project_id: project.id,
  code: DOCUMENT_TYPE_CODE,
  label: "Assurance bank statement",
  description: "Account, statement period, balances, totals, and transaction-count extraction.",
}, { onConflict: "project_id,code" }).select("id").single();
if (documentTypeError || !documentType) throw documentTypeError ?? new Error("Document type provisioning failed");

const entityTypes = [
  ["account_id", "Account identifier", "string", "text", true],
  ["currency", "Account currency", "string", "text", true],
  ["period_start", "Statement period start", "date", "date", true],
  ["period_end", "Statement period end", "date", "date", true],
  ["opening_balance", "Opening balance", "currency", "currency", true],
  ["closing_balance", "Closing balance", "currency", "currency", true],
  ["total_debits", "Total debits", "currency", "currency", true],
  ["total_credits", "Total credits", "currency", "currency", true],
  ["transaction_count", "Transaction count excluding opening balance", "number", "number", true],
];
for (const [key, label, datatype, extractor, required] of entityTypes) {
  const { error } = await sb.from("aidp_entity_types").upsert({
    tenant_id: tenant.id,
    document_type_id: documentType.id,
    key,
    label,
    datatype,
    extractor,
    required,
    confidence_threshold: 0.8,
    review_policy: "always_review",
    position: entityTypes.findIndex((entity) => entity[0] === key),
    options: {},
  }, { onConflict: "document_type_id,key" });
  if (error) throw error;
}

const { error: hostError } = await sb.from("aidp_api_host_allowlist").upsert({
  tenant_id: tenant.id,
  host: "app.reconiq.example",
  created_by: creator.user_id,
}, { onConflict: "tenant_id,host" });
if (hostError) throw hostError;

let rawToken = "";
let tokenId = "";
const { data: existingToken } = await sb.from("api_tokens")
  .select("id,token_hash,revoked_at")
  .eq("tenant_id", tenant.id).eq("name", TOKEN_NAME).maybeSingle();

try {
  const existingVault = await readFile(vaultPath, "utf8");
  rawToken = existingVault.match(/^- API token: `([^`]+)`$/mu)?.[1] ?? "";
} catch { /* first run */ }

if (existingToken) {
  if (existingToken.revoked_at) throw new Error("Existing Assurance AIDP token is revoked; owner action required");
  const digest = rawToken ? createHash("sha256").update(rawToken).digest("hex") : "";
  if (!rawToken || digest !== existingToken.token_hash) {
    throw new Error("Existing AIDP token row does not match the secured-vault copy; refusing replacement");
  }
  tokenId = existingToken.id;
} else {
  rawToken = `fvi_${randomBytes(24).toString("hex")}`;
  const digest = createHash("sha256").update(rawToken).digest("hex");
  const { data: createdToken, error: tokenError } = await sb.from("api_tokens").insert({
    tenant_id: tenant.id,
    name: TOKEN_NAME,
    prefix: rawToken.slice(0, 12),
    token_hash: digest,
    scopes: ["aidp:extract"],
    created_by: creator.user_id,
  }).select("id").single();
  if (tokenError || !createdToken) throw tokenError ?? new Error("AIDP API token creation failed");
  tokenId = createdToken.id;
  await sb.from("audit_log").insert({
    actor_user_id: creator.user_id,
    tenant_id: tenant.id,
    scope: "tenant",
    action: "test.aidp_token.provisioned",
    resource_type: "api_tokens",
    resource_id: tokenId,
    context: { synthetic: true, scopes: ["aidp:extract"] },
  });
}

const markdown = [
  "# ReconIQ — Assurance Lab AIDP API",
  "",
  `- Environment: ${targetEnvironment.toUpperCase()} synthetic assurance tenant only`,
  `- Tenant: ${tenant.name}`,
  `- Tenant slug: ${tenant.slug}`,
  `- Document type code: ${DOCUMENT_TYPE_CODE}`,
  `- Token row ID: ${tokenId}`,
  "- Scope: aidp:extract",
  "- Purpose: retained provider-backed synthetic bank-statement extraction test",
  "",
  `- API token: \`${rawToken}\``,
  "",
  "> Never copy this token into Git, logs, Graphify, Obsidian, or chat.",
  "> Do not rotate, revoke, replace, or rescope it without owner approval.",
  "",
].join("\n");
await writeFile(vaultPath, markdown, { encoding: "utf8", mode: 0o600 });
await chmod(vaultPath, 0o600).catch(() => undefined);

console.log(JSON.stringify({
  ok: true,
  tenant_id: tenant.id,
  project_id: project.id,
  document_type_id: documentType.id,
  entity_type_count: entityTypes.length,
  host_allowlisted: true,
  token_id: tokenId,
  token_saved: true,
  token_reused: Boolean(existingToken),
}));
