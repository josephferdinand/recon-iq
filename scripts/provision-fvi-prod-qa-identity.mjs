import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { chmod, writeFile } from "node:fs/promises";
import path from "node:path";

const PROD_REF = "YOUR_PROJECT_REF";
const QA_EMAIL = "codex.qa+assurance-lab@reconiq.example";
const QA_TENANT_SLUG = "reconiq-assurance-lab-prod";

if (process.env.FVI_ALLOW_PROD_QA_PROVISION !== "YES") {
  throw new Error("Set FVI_ALLOW_PROD_QA_PROVISION=YES for this explicit synthetic PROD action");
}

const url = process.env.SUPABASE_URL ?? "";
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const vaultPath = process.env.FVI_QA_PASSWORD_VAULT_PATH ?? "";
if (!url.includes(PROD_REF) || !publishableKey || !serviceRoleKey) {
  throw new Error("PROD Supabase identity guard failed");
}
if (
  !path.isAbsolute(vaultPath) ||
  path.basename(vaultPath) !== "FVI-Codex-QA-Assurance-Lab-PROD.md"
) {
  throw new Error("QA password output must be the named absolute secured-vault file");
}

const admin = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: tenant, error: tenantError } = await admin
  .from("tenants")
  .select("id, name, slug, environment, ai_enabled")
  .eq("slug", QA_TENANT_SLUG)
  .single();
if (tenantError || !tenant || tenant.environment !== "prod" || !tenant.ai_enabled) {
  throw new Error(tenantError?.message ?? "Assurance Lab PROD tenant guard failed");
}

const { data: existingUsers, error: listError } = await admin.auth.admin.listUsers({
  page: 1,
  perPage: 1000,
});
if (listError) throw listError;
if (existingUsers.users.some((user) => user.email?.toLowerCase() === QA_EMAIL)) {
  throw new Error(
    "Synthetic QA identity already exists; refusing to reset its password implicitly",
  );
}

const password = `${randomBytes(24).toString("base64url")}!Aa9`;
const { data: created, error: createError } = await admin.auth.admin.createUser({
  email: QA_EMAIL,
  password,
  email_confirm: true,
  user_metadata: {
    display_name: "Codex QA — FVI Assurance Lab",
    full_name: "Codex QA — FVI Assurance Lab",
    role: "tenant_admin",
    synthetic_test_identity: true,
  },
});
if (createError || !created.user)
  throw createError ?? new Error("QA user creation returned no user");

try {
  const { data: ownerMembership, error: ownerError } = await admin
    .from("tenant_members")
    .select("user_id")
    .eq("tenant_id", tenant.id)
    .eq("role", "tenant_admin")
    .eq("active", true)
    .limit(1)
    .single();
  if (ownerError || !ownerMembership) throw ownerError ?? new Error("Owner membership not found");

  const { error: memberError } = await admin.from("tenant_members").insert({
    tenant_id: tenant.id,
    user_id: created.user.id,
    role: "tenant_admin",
    invited_by: ownerMembership.user_id,
    added_by_platform: true,
    active: true,
  });
  if (memberError) throw memberError;

  const { data: adminRole, error: roleError } = await admin
    .from("rbac_roles")
    .select("id")
    .eq("key", "tenant_admin")
    .eq("is_system", true)
    .single();
  if (roleError || !adminRole) throw roleError ?? new Error("System tenant_admin role missing");
  const { error: grantError } = await admin.from("rbac_user_grants").insert({
    tenant_id: tenant.id,
    user_id: created.user.id,
    role_id: adminRole.id,
    scope_type: "tenant",
    scope_id: null,
    granted_by: ownerMembership.user_id,
    reason: "Synthetic Assurance Lab QA identity",
  });
  if (grantError) throw grantError;

  await admin.from("audit_log").insert({
    actor_user_id: ownerMembership.user_id,
    tenant_id: tenant.id,
    scope: "tenant",
    action: "test.identity.provisioned",
    resource_type: "tenant_member",
    resource_id: created.user.id,
    context: { synthetic: true, role: "tenant_admin", purpose: "assurance_lab" },
  });

  const verifier = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: verified, error: verifyError } = await verifier.auth.signInWithPassword({
    email: QA_EMAIL,
    password,
  });
  if (verifyError || verified.user?.id !== created.user.id || !verified.session) {
    throw verifyError ?? new Error("QA credential verification failed");
  }
  await verifier.auth.signOut();

  const generatedAt = new Date().toISOString();
  const markdown = [
    "# ReconIQ — Codex QA identity",
    "",
    "- Environment: PROD synthetic assurance tenant only",
    `- Tenant: ${tenant.name}`,
    `- Tenant slug: ${tenant.slug}`,
    `- Account: ${QA_EMAIL}`,
    `- User ID: ${created.user.id}`,
    "- Role: tenant_admin",
    `- Generated and verified: ${generatedAt}`,
    "- Purpose: Autonomous browser/API validation with synthetic data only",
    "",
    `- Temporary password: \`${password}\``,
    "",
    "> Change or remove this synthetic credential when the assurance programme is formally closed.",
    "> Never copy this password into Git, logs, Graphify, Obsidian, or chat.",
    "",
  ].join("\n");
  await writeFile(vaultPath, markdown, { encoding: "utf8", mode: 0o600 });
  await chmod(vaultPath, 0o600).catch(() => undefined);

  console.log(
    JSON.stringify({
      ok: true,
      tenant_id: tenant.id,
      tenant_slug: tenant.slug,
      user_id: created.user.id,
      role: "tenant_admin",
      password_saved: true,
      vault_file: path.basename(vaultPath),
      sign_in_verified: true,
    }),
  );
} catch (error) {
  await admin.auth.admin.deleteUser(created.user.id, true).catch(() => undefined);
  throw error;
}
