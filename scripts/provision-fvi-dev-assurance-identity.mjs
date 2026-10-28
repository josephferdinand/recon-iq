import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const PROD_REF = "YOUR_PROJECT_REF";
const DEV_REF = "YOUR_PROJECT_REF";
const sourceTenantId = process.env.FVI_ENV_CHANGE_SOURCE_TENANT_ID ?? "";
const patFile = process.env.FVI_SUPABASE_PAT_FILE ?? "";
const devAnonFile = process.env.FVI_DEV_ANON_KEY_FILE ?? "";
const devServiceFile = process.env.FVI_DEV_SERVICE_ROLE_KEY_FILE ?? "";
const vaultFile = process.env.FVI_DEV_QA_PASSWORD_VAULT_PATH ?? "";

if (process.env.FVI_ALLOW_DEV_QA_PROVISION !== "YES") {
  throw new Error("Set FVI_ALLOW_DEV_QA_PROVISION=YES for this synthetic DEV identity");
}
for (const protectedFile of [patFile, devAnonFile, devServiceFile, vaultFile]) {
  if (!path.isAbsolute(protectedFile)) throw new Error("All protected file paths must be absolute");
}
if (path.basename(vaultFile) !== "FVI-Codex-QA-Assurance-Lab-DEV.md") {
  throw new Error("DEV QA password must use the named secured-vault file");
}
if (!/^[0-9a-f-]{36}$/u.test(sourceTenantId)) {
  throw new Error("Source Assurance tenant ID is required");
}

const accessToken = (await readFile(patFile, "utf8")).trim();
const devAnon = (await readFile(devAnonFile, "utf8")).trim();
const devService = (await readFile(devServiceFile, "utf8")).trim();
if (
  !/^sbp_[A-Za-z0-9_-]{20,}$/u.test(accessToken) ||
  devAnon.length < 30 ||
  devService.length < 40
) {
  throw new Error("Protected FVI credentials are unavailable");
}

async function managementQuery(projectRef, sql) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: sql, read_only: true }),
    },
  );
  if (!response.ok)
    throw new Error(`Read-only identity lookup failed with HTTP ${response.status}`);
  return response.json();
}

const sourceUsers = await managementQuery(
  PROD_REF,
  `select lower(u.email) as email,u.raw_user_meta_data,m.role::text as role
   from public.tenant_members m join auth.users u on u.id=m.user_id
   where m.tenant_id='${sourceTenantId}'::uuid and m.active
     and coalesce((u.raw_user_meta_data->>'synthetic_test_identity')::boolean,false)`,
);
if (sourceUsers.length !== 1 || sourceUsers[0].role !== "tenant_admin") {
  throw new Error("Exactly one synthetic source tenant administrator is required");
}
const sourceUser = sourceUsers[0];
if (typeof sourceUser.email !== "string" || !/^[^\s@]+@[^\s@]+$/u.test(sourceUser.email)) {
  throw new Error("Synthetic source email is invalid");
}

const devUrl = `https://${DEV_REF}.supabase.co`;
const admin = createClient(devUrl, devService, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const escapedEmail = sourceUser.email.replaceAll("'", "''");
const existing = await managementQuery(
  DEV_REF,
  `select id from auth.users where lower(email)='${escapedEmail}' limit 1`,
);
if (existing.length > 0) {
  throw new Error("Synthetic DEV identity already exists; refusing to reset its password");
}

const password = `${randomBytes(24).toString("base64url")}!Aa9`;
const { data: created, error: createError } = await admin.auth.admin.createUser({
  email: sourceUser.email,
  password,
  email_confirm: true,
  user_metadata: {
    ...(sourceUser.raw_user_meta_data ?? {}),
    role: "tenant_admin",
    synthetic_test_identity: true,
    environment: "dev",
  },
});
if (createError || !created.user) {
  throw createError ?? new Error("DEV synthetic identity creation returned no user");
}

try {
  const verifier = createClient(devUrl, devAnon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: verified, error: verifyError } = await verifier.auth.signInWithPassword({
    email: sourceUser.email,
    password,
  });
  if (verifyError || verified.user?.id !== created.user.id || !verified.session) {
    throw verifyError ?? new Error("DEV synthetic credential verification failed");
  }
  await verifier.auth.signOut();

  const markdown = [
    "# ReconIQ — Codex QA identity",
    "",
    "- Environment: DEV synthetic assurance tenant only",
    "- Planned tenant: ReconIQ Assurance Lab — DEV",
    `- Account: ${sourceUser.email}`,
    `- User ID: ${created.user.id}`,
    "- Role: tenant_admin",
    `- Generated and verified: ${new Date().toISOString()}`,
    "- Purpose: Governed DEV browser/API and environment-promotion validation",
    "",
    `- Temporary password: \`${password}\``,
    "",
    "> Never copy this password into Git, logs, Graphify, Obsidian, or chat.",
    "> Remove the synthetic identity only after the owner closes the assurance programme.",
    "",
  ].join("\n");
  await writeFile(vaultFile, markdown, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await chmod(vaultFile, 0o600).catch(() => undefined);
  console.log(
    JSON.stringify({
      ok: true,
      environment: "dev",
      user_id: created.user.id,
      role: "tenant_admin",
      synthetic: true,
      password_saved: true,
      vault_file: path.basename(vaultFile),
      sign_in_verified: true,
      existing_accounts_changed: false,
    }),
  );
} catch (error) {
  await admin.auth.admin.deleteUser(created.user.id, true).catch(() => undefined);
  throw error;
}
