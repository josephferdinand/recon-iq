import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const DEV_URL = "https://YOUR_PROJECT_REF.supabase.co";
const email = "codex.env-checker.dev@reconiq.example";
const tenantId = process.env.FVI_ENV_CHANGE_SOURCE_TENANT_ID ?? "";
const anonFile = process.env.FVI_DEV_ANON_KEY_FILE ?? "";
const serviceFile = process.env.FVI_DEV_SERVICE_ROLE_KEY_FILE ?? "";
const vaultFile = process.env.FVI_DEV_ENV_CHECKER_VAULT_PATH ?? "";

if (process.env.FVI_ALLOW_DEV_ENV_CHECKER_PROVISION !== "YES") {
  throw new Error("Set FVI_ALLOW_DEV_ENV_CHECKER_PROVISION=YES");
}
if (!/^[0-9a-f-]{36}$/u.test(tenantId)) throw new Error("Governed DEV tenant ID is required");
for (const protectedFile of [anonFile, serviceFile, vaultFile]) {
  if (!path.isAbsolute(protectedFile)) throw new Error("Protected file paths must be absolute");
}
if (path.basename(vaultFile) !== "FVI-Codex-Environment-Checker-DEV.md") {
  throw new Error("Environment checker must use its named secured-vault file");
}
const anon = (await readFile(anonFile, "utf8")).trim();
const service = (await readFile(serviceFile, "utf8")).trim();
if (anon.length < 30 || service.length < 40) throw new Error("Protected DEV keys are unavailable");

const admin = createClient(DEV_URL, service, { auth: { persistSession: false } });
const { data: existing, error: lookupError } = await admin
  .from("profiles")
  .select("id")
  .eq("email", email)
  .maybeSingle();
if (lookupError) throw lookupError;
if (existing) throw new Error("Synthetic checker already exists; refusing to reset its password");

const password = `${randomBytes(24).toString("base64url")}!Aa9`;
const { data: created, error: createError } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: {
    role: "tenant_admin",
    synthetic_test_identity: true,
    purpose: "environment_change_source_and_target_checker",
    environment: "dev",
  },
});
if (createError || !created.user) throw createError ?? new Error("Checker creation failed");
try {
  const { error: membershipError } = await admin.from("tenant_members").upsert(
    {
      tenant_id: tenantId,
      user_id: created.user.id,
      role: "tenant_admin",
      active: true,
      added_by_platform: true,
    },
    { onConflict: "tenant_id,user_id" },
  );
  if (membershipError) throw membershipError;
  const { data: tenantAdminRole, error: roleError } = await admin
    .from("rbac_roles")
    .select("id")
    .eq("key", "tenant_admin")
    .eq("is_system", true)
    .single();
  if (roleError || !tenantAdminRole)
    throw roleError ?? new Error("Tenant Admin role is unavailable");
  const { error: grantError } = await admin.from("rbac_user_grants").insert({
    tenant_id: tenantId,
    user_id: created.user.id,
    role_id: tenantAdminRole.id,
    scope_type: "tenant",
    scope_id: null,
    granted_by: created.user.id,
    reason: "Synthetic checker for governed environment-delivery assurance",
  });
  if (grantError) throw grantError;
  const verifier = createClient(DEV_URL, anon, { auth: { persistSession: false } });
  const { data: verified, error: verifyError } = await verifier.auth.signInWithPassword({
    email,
    password,
  });
  if (verifyError || !verified.session || verified.user?.id !== created.user.id) {
    throw verifyError ?? new Error("Checker sign-in verification failed");
  }
  await verifier.auth.signOut();
  await writeFile(
    vaultFile,
    [
      "# FVI synthetic environment checker — DEV",
      "",
      `- Account: ${email}`,
      `- User ID: ${created.user.id}`,
      `- Tenant ID: ${tenantId}`,
      "- Role: tenant_admin",
      `- Created and verified: ${new Date().toISOString()}`,
      `- Temporary password: \`${password}\``,
      "",
      "> Synthetic two-stage environment delivery assurance identity.",
      "> Never copy this password into Git, logs, Graphify, Obsidian, or chat.",
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o600, flag: "wx" },
  );
  await chmod(vaultFile, 0o600).catch(() => undefined);
  console.log(
    JSON.stringify({
      ok: true,
      environment: "dev",
      role: "tenant_admin",
      sign_in_verified: true,
      membership_verified: true,
      tenant_admin_role_verified: true,
      password_saved: true,
      existing_accounts_changed: false,
    }),
  );
} catch (error) {
  await admin.auth.admin.deleteUser(created.user.id, true).catch(() => undefined);
  throw error;
}
