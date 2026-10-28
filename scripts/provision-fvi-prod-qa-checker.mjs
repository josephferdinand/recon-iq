import { createClient } from "@supabase/supabase-js";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import path from "node:path";

const PROD_REF = "YOUR_PROJECT_REF";
const PROD_URL = `https://${PROD_REF}.supabase.co`;
const TENANT_ID = "aa5ed999-69eb-41a0-a9c6-fbb439efcffb";
const TENANT_SLUG = "reconiq-assurance-lab-prod";
const INITIATOR_USER_ID = "85d57a0a-846d-4a7e-ba94-e5452b9db66c";
const CHECKER_EMAIL = "codex.qa+assurance-checker@reconiq.example";
const CHECKER_DISPLAY = "Codex QA Checker — FVI Assurance Lab";
const SNAPSHOT_BEGIN = "FVI_QA_CHECKER_PROD_SNAPSHOT_BEGIN";
const SNAPSHOT_END = "FVI_QA_CHECKER_PROD_SNAPSHOT_END";
const PHASES = [
  "prepared",
  "auth_created",
  "auth_audited",
  "membership_granted",
  "rbac_granted",
  "access_audited",
  "mfa_enrolled",
  "mfa_verified",
  "ready",
];

let runtimeState = null;
let runtimeVaultPath = "";

class ProvisionError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function fail(code) {
  throw new ProvisionError(code);
}

function phaseAtLeast(state, phase) {
  return PHASES.indexOf(state.phase) >= PHASES.indexOf(phase);
}

function unwrapKnownMarkdown(value) {
  let normalized = value.trim();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (normalized.startsWith("`") && normalized.endsWith("`")) {
      normalized = normalized.slice(1, -1).trim();
      continue;
    }
    if (normalized.startsWith("<") && normalized.endsWith(">")) {
      normalized = normalized.slice(1, -1).trim();
      continue;
    }
    break;
  }
  return normalized;
}

function operationalValue(markdown, key) {
  const beginMarker = "<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_BEGIN -->";
  const endMarker = "<!-- FVI_CANONICAL_OPERATIONAL_CREDENTIALS_END -->";
  const begin = markdown.indexOf(beginMarker);
  const end = markdown.indexOf(endMarker);
  if (begin < 0 || end <= begin) fail("canonical_credentials_section_missing");
  const row = markdown
    .slice(begin + beginMarker.length, end)
    .split(/\r?\n/u)
    .find((line) => line.startsWith(`| \`${key}\` |`));
  const value = unwrapKnownMarkdown(row?.split("|")[2] ?? "");
  if (!value) fail(`canonical_${key.toLowerCase()}_missing`);
  return value;
}

function latestSnapshot(markdown) {
  const expression = new RegExp(
    `<!-- ${SNAPSHOT_BEGIN} ([0-9a-f-]{36}) -->([\\s\\S]*?)<!-- ${SNAPSHOT_END} \\1 -->`,
    "gu",
  );
  let latest = null;
  for (const match of markdown.matchAll(expression)) {
    try {
      const parsed = JSON.parse(match[2].trim());
      if (parsed.snapshot_id === match[1]) latest = parsed;
    } catch {
      // Ignore incomplete/corrupt blocks; only the latest complete JSON block is resumable.
    }
  }
  return latest;
}

function validateSnapshot(snapshot) {
  if (
    snapshot.schema_version !== 1 ||
    snapshot.target?.project_ref !== PROD_REF ||
    snapshot.target?.supabase_url !== PROD_URL ||
    snapshot.target?.tenant_id !== TENANT_ID ||
    snapshot.target?.tenant_slug !== TENANT_SLUG ||
    snapshot.target?.environment !== "prod" ||
    snapshot.target?.email !== CHECKER_EMAIL ||
    snapshot.target?.display_name !== CHECKER_DISPLAY ||
    !PHASES.includes(snapshot.phase) ||
    !/^[0-9a-f-]{36}$/u.test(snapshot.provisioning_id ?? "") ||
    typeof snapshot.initial_password !== "string" ||
    snapshot.initial_password.length < 32 ||
    typeof snapshot.audit_event_ids !== "object" ||
    snapshot.audit_event_ids === null ||
    (phaseAtLeast(snapshot, "auth_created") && !/^[0-9a-f-]{36}$/u.test(snapshot.user_id ?? "")) ||
    (snapshot.factor_id && !snapshot.totp_secret) ||
    (phaseAtLeast(snapshot, "mfa_enrolled") && (!snapshot.factor_id || !snapshot.totp_secret))
  ) {
    fail("saved_snapshot_identity_mismatch");
  }
}

async function appendSnapshot(vaultPath, state) {
  const snapshotId = randomUUID();
  const snapshot = {
    ...state,
    schema_version: 1,
    snapshot_id: snapshotId,
    previous_snapshot_id: state.snapshot_id ?? null,
    written_at: new Date().toISOString(),
  };
  const block = [
    "",
    `<!-- ${SNAPSHOT_BEGIN} ${snapshotId} -->`,
    JSON.stringify(snapshot),
    `<!-- ${SNAPSHOT_END} ${snapshotId} -->`,
    "",
  ].join("\n");
  const handle = await open(vaultPath, "a", 0o600);
  try {
    await handle.write(block);
    await handle.sync();
  } finally {
    await handle.close();
  }
  runtimeState = snapshot;
  return snapshot;
}

function decodeBase32(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of value.toUpperCase().replace(/=+$/u, "")) {
    const index = alphabet.indexOf(character);
    if (index < 0) fail("saved_totp_secret_invalid");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secret, now = Date.now()) {
  const counter = Math.floor(now / 30_000);
  const value = Buffer.alloc(8);
  value.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(value).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

async function findUserByEmail(admin) {
  for (let page = 1; page <= 100; page += 1) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) fail("auth_user_preflight_failed");
    const match = result.data.users.find(
      (user) => user.email?.toLowerCase() === CHECKER_EMAIL.toLowerCase(),
    );
    if (match) return match;
    if (result.data.users.length < 1000) return null;
  }
  fail("auth_user_preflight_bound_exceeded");
}

function assertUserIdentity(user, provisioningId) {
  const metadata = user.user_metadata ?? {};
  if (
    user.email?.toLowerCase() !== CHECKER_EMAIL.toLowerCase() ||
    metadata.display_name !== CHECKER_DISPLAY ||
    metadata.full_name !== CHECKER_DISPLAY ||
    metadata.role !== "tenant_admin" ||
    metadata.synthetic_test_identity !== true ||
    metadata.qa_checker_provisioning_id !== provisioningId
  ) {
    fail("existing_auth_identity_conflict");
  }
}

async function assertNoPlatformRole(admin, userId) {
  const platformRoles = await admin.from("platform_roles").select("id").eq("user_id", userId);
  if (platformRoles.error) fail("platform_role_readback_failed");
  if ((platformRoles.data ?? []).length > 0) fail("unexpected_platform_role_conflict");
  const platformAdmin = await admin.rpc("is_platform_admin", { _user_id: userId });
  if (platformAdmin.error) fail("platform_admin_readback_failed");
  if (platformAdmin.data === true) fail("unexpected_platform_admin_conflict");
}

async function ensureAudit(admin, action, resourceId, safeContext) {
  const existing = await admin
    .from("audit_log")
    .select("id,actor_user_id,tenant_id,action,resource_type,resource_id")
    .eq("tenant_id", TENANT_ID)
    .eq("action", action)
    .eq("resource_type", "synthetic_test_identity")
    .eq("resource_id", resourceId)
    .limit(2);
  if (existing.error) fail("provisioning_audit_readback_failed");
  if ((existing.data ?? []).length > 1) fail("duplicate_provisioning_audit_conflict");
  if (existing.data?.length === 1) {
    const row = existing.data[0];
    if (row.actor_user_id !== INITIATOR_USER_ID || row.tenant_id !== TENANT_ID) {
      fail("provisioning_audit_identity_conflict");
    }
    return String(row.id);
  }
  const inserted = await admin
    .from("audit_log")
    .insert({
      actor_user_id: INITIATOR_USER_ID,
      tenant_id: TENANT_ID,
      scope: "tenant",
      action,
      resource_type: "synthetic_test_identity",
      resource_id: resourceId,
      context: safeContext,
    })
    .select("id")
    .single();
  if (inserted.error || !inserted.data) fail("provisioning_audit_insert_failed");
  return String(inserted.data.id);
}

async function main() {
  if (process.env.FVI_ALLOW_PROD_QA_CHECKER !== "YES") fail("prod_checker_confirmation_required");
  const vaultPath = process.env.FVI_VAULT_PATH ?? "";
  if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md") {
    fail("canonical_vault_path_required");
  }
  runtimeVaultPath = vaultPath;

  const vault = await readFile(vaultPath, "utf8").catch(() => fail("canonical_vault_read_failed"));
  const publishableKey = operationalValue(vault, "SUPABASE_PROD_ANON_KEY");
  const serviceRoleKey = operationalValue(vault, "SUPABASE_PROD_SERVICE_ROLE_KEY");
  if (publishableKey.length < 30 || serviceRoleKey.length < 30) fail("canonical_prod_key_invalid");

  const admin = createClient(PROD_URL, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const tenantResult = await admin
    .from("tenants")
    .select("id,slug,environment")
    .eq("id", TENANT_ID)
    .eq("slug", TENANT_SLUG)
    .eq("environment", "prod")
    .maybeSingle();
  if (tenantResult.error || !tenantResult.data) fail("prod_tenant_guard_failed");

  const initiatorResult = await admin
    .from("tenant_members")
    .select("id,user_id,tenant_id,role,active")
    .eq("tenant_id", TENANT_ID)
    .eq("user_id", INITIATOR_USER_ID)
    .eq("role", "tenant_admin")
    .eq("active", true)
    .maybeSingle();
  if (initiatorResult.error || !initiatorResult.data) fail("initiating_admin_guard_failed");

  const roleResult = await admin
    .from("rbac_roles")
    .select("id,key,is_system,tenant_id")
    .eq("key", "tenant_admin")
    .eq("is_system", true)
    .is("tenant_id", null)
    .maybeSingle();
  if (roleResult.error || !roleResult.data) fail("system_tenant_admin_role_missing");

  let state = latestSnapshot(vault);
  if (state) {
    validateSnapshot(state);
    runtimeState = state;
  }

  let existingUser = await findUserByEmail(admin);
  if (!state) {
    if (existingUser) fail("preexisting_checker_email_without_snapshot");
    state = await appendSnapshot(vaultPath, {
      schema_version: 1,
      provisioning_id: randomUUID(),
      phase: "prepared",
      target: {
        project_ref: PROD_REF,
        supabase_url: PROD_URL,
        tenant_id: TENANT_ID,
        tenant_slug: TENANT_SLUG,
        environment: "prod",
        email: CHECKER_EMAIL,
        display_name: CHECKER_DISPLAY,
      },
      initial_password: `${randomBytes(32).toString("base64url")}!Aa9`,
      user_id: null,
      membership_id: null,
      tenant_admin_role_id: roleResult.data.id,
      rbac_grant_id: null,
      factor_id: null,
      totp_secret: null,
      verified_factor_count: 0,
      aal_current: null,
      aal_next: null,
      audit_event_ids: {},
      created_at: new Date().toISOString(),
      last_failure: null,
    });
  }

  if (state.tenant_admin_role_id !== roleResult.data.id) fail("saved_system_role_mismatch");
  if (existingUser) {
    assertUserIdentity(existingUser, state.provisioning_id);
    if (state.user_id && existingUser.id !== state.user_id) fail("saved_auth_user_id_mismatch");
  }

  if (!state.user_id) {
    if (!existingUser) {
      const created = await admin.auth.admin.createUser({
        email: CHECKER_EMAIL,
        password: state.initial_password,
        email_confirm: true,
        user_metadata: {
          display_name: CHECKER_DISPLAY,
          full_name: CHECKER_DISPLAY,
          role: "tenant_admin",
          synthetic_test_identity: true,
          qa_checker_provisioning_id: state.provisioning_id,
        },
      });
      if (created.error || !created.data.user) fail("checker_auth_create_failed");
      existingUser = created.data.user;
      assertUserIdentity(existingUser, state.provisioning_id);
    }
    state = await appendSnapshot(vaultPath, {
      ...state,
      phase: "auth_created",
      user_id: existingUser.id,
      last_failure: null,
    });
  } else {
    const userResult = await admin.auth.admin.getUserById(state.user_id);
    if (userResult.error || !userResult.data.user) fail("saved_auth_user_missing");
    assertUserIdentity(userResult.data.user, state.provisioning_id);
    if (!existingUser || existingUser.id !== state.user_id) fail("saved_email_binding_missing");
  }

  await assertNoPlatformRole(admin, state.user_id);

  const authAuditId = await ensureAudit(
    admin,
    "test.identity.checker.auth_created",
    state.user_id,
    {
      synthetic_test_identity: true,
      service_assisted: true,
      phase: "auth_created",
    },
  );
  if (!phaseAtLeast(state, "auth_audited") || state.audit_event_ids.auth_created !== authAuditId) {
    state = await appendSnapshot(vaultPath, {
      ...state,
      phase: "auth_audited",
      audit_event_ids: { ...state.audit_event_ids, auth_created: authAuditId },
      last_failure: null,
    });
  }

  const memberships = await admin
    .from("tenant_members")
    .select("id,tenant_id,user_id,role,active,invited_by,added_by_platform")
    .eq("user_id", state.user_id);
  if (memberships.error) fail("checker_membership_readback_failed");
  let membership = memberships.data?.[0] ?? null;
  if ((memberships.data ?? []).length > 1) fail("unexpected_checker_membership_conflict");
  if (membership) {
    if (
      membership.tenant_id !== TENANT_ID ||
      membership.user_id !== state.user_id ||
      membership.role !== "tenant_admin" ||
      membership.active !== true ||
      membership.invited_by !== INITIATOR_USER_ID ||
      membership.added_by_platform !== true
    ) {
      fail("unexpected_checker_membership_conflict");
    }
  } else {
    const inserted = await admin
      .from("tenant_members")
      .insert({
        tenant_id: TENANT_ID,
        user_id: state.user_id,
        role: "tenant_admin",
        active: true,
        invited_by: INITIATOR_USER_ID,
        added_by_platform: true,
      })
      .select("id,tenant_id,user_id,role,active,invited_by,added_by_platform")
      .single();
    if (inserted.error || !inserted.data) fail("checker_membership_insert_failed");
    membership = inserted.data;
  }
  if (!phaseAtLeast(state, "membership_granted") || state.membership_id !== membership.id) {
    state = await appendSnapshot(vaultPath, {
      ...state,
      phase: "membership_granted",
      membership_id: membership.id,
      last_failure: null,
    });
  }

  const grants = await admin
    .from("rbac_user_grants")
    .select("id,tenant_id,user_id,role_id,scope_type,scope_id,granted_by,revoked_at")
    .eq("user_id", state.user_id);
  if (grants.error) fail("checker_rbac_grant_readback_failed");
  let grant = grants.data?.[0] ?? null;
  if ((grants.data ?? []).length > 1) fail("unexpected_checker_rbac_grant_conflict");
  if (grant) {
    if (
      grant.tenant_id !== TENANT_ID ||
      grant.user_id !== state.user_id ||
      grant.role_id !== roleResult.data.id ||
      grant.scope_type !== "tenant" ||
      grant.scope_id !== null ||
      grant.granted_by !== INITIATOR_USER_ID ||
      grant.revoked_at !== null
    ) {
      fail("unexpected_checker_rbac_grant_conflict");
    }
  } else {
    const inserted = await admin
      .from("rbac_user_grants")
      .insert({
        tenant_id: TENANT_ID,
        user_id: state.user_id,
        role_id: roleResult.data.id,
        scope_type: "tenant",
        scope_id: null,
        granted_by: INITIATOR_USER_ID,
        reason: "Synthetic Assurance Lab checker identity",
      })
      .select("id,tenant_id,user_id,role_id,scope_type,scope_id,granted_by,revoked_at")
      .single();
    if (inserted.error || !inserted.data) fail("checker_rbac_grant_insert_failed");
    grant = inserted.data;
  }
  if (!phaseAtLeast(state, "rbac_granted") || state.rbac_grant_id !== grant.id) {
    state = await appendSnapshot(vaultPath, {
      ...state,
      phase: "rbac_granted",
      rbac_grant_id: grant.id,
      last_failure: null,
    });
  }

  const accessAuditId = await ensureAudit(
    admin,
    "test.identity.checker.access_granted",
    state.user_id,
    {
      synthetic_test_identity: true,
      service_assisted: true,
      role: "tenant_admin",
      membership_id: state.membership_id,
      rbac_grant_id: state.rbac_grant_id,
    },
  );
  if (
    !phaseAtLeast(state, "access_audited") ||
    state.audit_event_ids.access_granted !== accessAuditId
  ) {
    state = await appendSnapshot(vaultPath, {
      ...state,
      phase: "access_audited",
      audit_event_ids: { ...state.audit_event_ids, access_granted: accessAuditId },
      last_failure: null,
    });
  }

  await assertNoPlatformRole(admin, state.user_id);
  const verifier = createClient(PROD_URL, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  try {
    const signedIn = await verifier.auth.signInWithPassword({
      email: CHECKER_EMAIL,
      password: state.initial_password,
    });
    if (signedIn.error || signedIn.data.user?.id !== state.user_id || !signedIn.data.session) {
      fail("checker_sign_in_failed_without_password_reset");
    }

    let factors = await verifier.auth.mfa.listFactors();
    if (factors.error) fail("checker_mfa_factor_readback_failed");
    let allFactors = factors.data?.all ?? [];
    if (state.factor_id) {
      if (!state.totp_secret || allFactors.length !== 1 || allFactors[0].id !== state.factor_id) {
        fail("unexpected_checker_mfa_factor_conflict");
      }
    } else {
      if (allFactors.length !== 0) fail("unexpected_checker_mfa_factor_without_snapshot");
      const enrolled = await verifier.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "FVI PROD Assurance checker",
      });
      if (enrolled.error || !enrolled.data.id || !enrolled.data.totp?.secret) {
        fail("checker_mfa_enrollment_failed");
      }
      state = await appendSnapshot(vaultPath, {
        ...state,
        phase: "mfa_enrolled",
        factor_id: enrolled.data.id,
        totp_secret: enrolled.data.totp.secret,
        last_failure: null,
      });
      factors = await verifier.auth.mfa.listFactors();
      if (factors.error) fail("checker_mfa_factor_readback_failed");
      allFactors = factors.data?.all ?? [];
      if (allFactors.length !== 1 || allFactors[0].id !== state.factor_id) {
        fail("checker_mfa_enrollment_readback_conflict");
      }
    }

    const verified = await verifier.auth.mfa.challengeAndVerify({
      factorId: state.factor_id,
      code: totp(state.totp_secret),
    });
    if (verified.error) fail("checker_mfa_verification_failed");
    const assurance = await verifier.auth.mfa.getAuthenticatorAssuranceLevel();
    if (
      assurance.error ||
      assurance.data.currentLevel !== "aal2" ||
      assurance.data.nextLevel !== "aal2"
    ) {
      fail("checker_aal2_verification_failed");
    }
    factors = await verifier.auth.mfa.listFactors();
    if (factors.error) fail("checker_mfa_factor_readback_failed");
    allFactors = factors.data?.all ?? [];
    const verifiedFactors = allFactors.filter((factor) => factor.status === "verified");
    if (
      allFactors.length !== 1 ||
      verifiedFactors.length !== 1 ||
      verifiedFactors[0].id !== state.factor_id
    ) {
      fail("checker_verified_factor_conflict");
    }
    if (
      !phaseAtLeast(state, "mfa_verified") ||
      state.verified_factor_count !== 1 ||
      state.aal_current !== "aal2" ||
      state.aal_next !== "aal2"
    ) {
      state = await appendSnapshot(vaultPath, {
        ...state,
        phase: "mfa_verified",
        verified_factor_count: 1,
        aal_current: assurance.data.currentLevel,
        aal_next: assurance.data.nextLevel,
        last_failure: null,
      });
    }
  } finally {
    await verifier.auth.signOut({ scope: "local" }).catch(() => undefined);
  }

  const mfaAuditId = await ensureAudit(admin, "test.identity.checker.mfa_verified", state.user_id, {
    synthetic_test_identity: true,
    service_assisted: true,
    verified_factor_count: 1,
    assurance_level: "aal2",
  });
  const finalUser = await admin.auth.admin.getUserById(state.user_id);
  if (finalUser.error || !finalUser.data.user) fail("final_auth_user_readback_failed");
  assertUserIdentity(finalUser.data.user, state.provisioning_id);
  const finalMembership = await admin
    .from("tenant_members")
    .select("id,tenant_id,user_id,role,active,invited_by,added_by_platform")
    .eq("id", state.membership_id)
    .eq("tenant_id", TENANT_ID)
    .eq("user_id", state.user_id)
    .maybeSingle();
  if (
    finalMembership.error ||
    !finalMembership.data ||
    finalMembership.data.role !== "tenant_admin" ||
    finalMembership.data.active !== true ||
    finalMembership.data.invited_by !== INITIATOR_USER_ID ||
    finalMembership.data.added_by_platform !== true
  ) {
    fail("final_membership_readback_failed");
  }
  const finalGrant = await admin
    .from("rbac_user_grants")
    .select("id,tenant_id,user_id,role_id,scope_type,scope_id,granted_by,revoked_at")
    .eq("id", state.rbac_grant_id)
    .eq("tenant_id", TENANT_ID)
    .eq("user_id", state.user_id)
    .maybeSingle();
  if (
    finalGrant.error ||
    !finalGrant.data ||
    finalGrant.data.role_id !== roleResult.data.id ||
    finalGrant.data.scope_type !== "tenant" ||
    finalGrant.data.scope_id !== null ||
    finalGrant.data.granted_by !== INITIATOR_USER_ID ||
    finalGrant.data.revoked_at !== null
  ) {
    fail("final_rbac_grant_readback_failed");
  }
  await assertNoPlatformRole(admin, state.user_id);
  if (
    !phaseAtLeast(state, "ready") ||
    state.audit_event_ids.mfa_verified !== mfaAuditId ||
    state.last_failure !== null
  ) {
    state = await appendSnapshot(vaultPath, {
      ...state,
      phase: "ready",
      audit_event_ids: { ...state.audit_event_ids, mfa_verified: mfaAuditId },
      last_failure: null,
    });
  }

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      phase: state.phase,
      ready: state.phase === "ready",
      project_ref: PROD_REF,
      tenant_id: TENANT_ID,
      tenant_slug: TENANT_SLUG,
      user_id: state.user_id,
      membership_id: state.membership_id,
      role: "tenant_admin",
      active: true,
      rbac_grant_id: state.rbac_grant_id,
      tenant_admin_role_id: state.tenant_admin_role_id,
      is_platform_admin: false,
      synthetic_test_identity: true,
      factor_id: state.factor_id,
      verified_factor_count: state.verified_factor_count,
      aal_current: state.aal_current,
      aal_next: state.aal_next,
      audit_event_ids: state.audit_event_ids,
      snapshot_saved: true,
      credential_value_exposed: false,
    })}\n`,
  );
}

try {
  await main();
} catch (error) {
  const code = error instanceof ProvisionError ? error.code : "unexpected_failure";
  if (runtimeState && runtimeVaultPath) {
    try {
      await appendSnapshot(runtimeVaultPath, {
        ...runtimeState,
        last_failure: { code, occurred_at: new Date().toISOString() },
      });
    } catch {
      // The last complete snapshot remains the resume authority.
    }
  }
  process.stderr.write(
    `${JSON.stringify({
      ok: false,
      phase: runtimeState?.phase ?? "startup",
      ready: false,
      error_code: code,
      partial_state_preserved: Boolean(runtimeState),
      resume_instruction:
        "Set FVI_ALLOW_PROD_QA_CHECKER=YES and the same absolute FVI_VAULT_PATH, then rerun node scripts/provision-fvi-prod-qa-checker.mjs",
      credential_value_exposed: false,
    })}\n`,
  );
  process.exitCode = 1;
}
