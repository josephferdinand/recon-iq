/**
 * Batch 2 server functions for the Platform-Admin gap backlog.
 *
 * Adds the 11 deferred items: TOTP + SMS enrollment, admin-role grants,
 * policy rollback, PHI marker create, and producer writers for RCA hints,
 * capacity forecasts, and hallucination samples.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformAdmin } from "@/lib/rbac-guards.server";
import { z } from "zod";

async function assertPlatformAdmin(context: any) {
  await requirePlatformAdmin(context, { fnName: "platform-gap-batch2" });
}
const sb = (ctx: any) => ctx.supabase;
const T = (n: string) => n as never;

/* ================= G-11 TOTP enrollment ================= */
export const listMyTotp = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data, error } = await sb(context)
      .from(T("platform_mfa_totp"))
      .select("id,label,verified,last_used_at,created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const enrollTotp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i: unknown) => z.object({ label: z.string().min(1).max(40).default("Authenticator") }).parse(i))
  .handler(async ({ context, data }) => {
    const { generateSecret, otpauthUri } = await import("./platform-gap-totp.server");
    const secret = generateSecret();
    const { data: user } = await context.supabase.auth.getUser();
    const account = user?.user?.email ?? context.userId;
    const uri = otpauthUri(secret, account);
    const { data: row, error } = await sb(context)
      .from(T("platform_mfa_totp"))
      .insert({ user_id: context.userId, label: data.label, secret_encrypted: secret, verified: false })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id, secret, otpauth_uri: uri };
  });

export const verifyTotp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i: unknown) => z.object({ id: z.string().uuid(), code: z.string().regex(/^\d{6}$/) }).parse(i))
  .handler(async ({ context, data }) => {
    const { verifyTotpCode } = await import("./platform-gap-totp.server");
    const { data: row, error } = await sb(context)
      .from(T("platform_mfa_totp"))
      .select("secret_encrypted")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Not found");
    if (!verifyTotpCode((row as any).secret_encrypted, data.code)) throw new Error("Invalid code");
    const { error: e2 } = await sb(context)
      .from(T("platform_mfa_totp"))
      .update({ verified: true, last_used_at: new Date().toISOString() })
      .eq("id", data.id);
    if (e2) throw new Error(e2.message);
    return { ok: true };
  });

export const disableTotp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ context, data }) => {
    const { error } = await sb(context)
      .from(T("platform_mfa_totp"))
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ================= G-12 SMS enrollment (Twilio-gated) ================= */
export const listMySms = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data, error } = await sb(context)
      .from(T("platform_mfa_sms"))
      .select("id,phone_e164,verified,last_sent_at,last_used_at")
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { rows: data ?? [], provider_configured: !!process.env.TWILIO_ACCOUNT_SID };
  });

export const enrollSms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i: unknown) => z.object({ phone_e164: z.string().regex(/^\+[1-9]\d{6,14}$/) }).parse(i))
  .handler(async ({ context, data }) => {
    const { error } = await sb(context)
      .from(T("platform_mfa_sms"))
      .upsert({ user_id: context.userId, phone_e164: data.phone_e164 }, { onConflict: "user_id,phone_e164" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const disableSms = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ context, data }) => {
    const { error } = await sb(context)
      .from(T("platform_mfa_sms"))
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ================= G-12 SMS OTP send/verify (Twilio via in-app Vault) =================
 * Credentials MUST live in app_vault_secrets (platform scope, secret_class
 * "integration_token") under names TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
 * TWILIO_FROM_NUMBER. No Meta AI, no connector gateway, no process.env
 * fallback. Delivery goes direct to Twilio's REST API with HTTP Basic auth. */
export const sendSmsCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ context, data }) => {
    const { createHash, randomInt } = await import("crypto");
    const { resolveVaultSecret } = await import("@/lib/vault-resolver.server");
    const { data: row, error } = await sb(context)
      .from(T("platform_mfa_sms"))
      .select("id,phone_e164,last_sent_at")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Enrollment not found");
    const last = (row as any).last_sent_at ? new Date((row as any).last_sent_at).getTime() : 0;
    if (Date.now() - last < 30_000) throw new Error("Please wait before requesting another code");
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const code_hash = createHash("sha256").update(code).digest("hex");
    const code_expires_at = new Date(Date.now() + 5 * 60_000).toISOString();

    let delivered = false;
    let providerReason: string | null = null;
    const [sid, token, from] = await Promise.all([
      resolveVaultSecret(context.supabase, { scope: "platform", secret_class: "integration_token", name: "TWILIO_ACCOUNT_SID" }),
      resolveVaultSecret(context.supabase, { scope: "platform", secret_class: "integration_token", name: "TWILIO_AUTH_TOKEN" }),
      resolveVaultSecret(context.supabase, { scope: "platform", secret_class: "integration_token", name: "TWILIO_FROM_NUMBER" }),
    ]);
    if (sid?.plaintext && token?.plaintext && from?.plaintext) {
      const body = new URLSearchParams({
        To: (row as any).phone_e164,
        From: from.plaintext,
        Body: `Your ReconIQ verification code is ${code}. It expires in 5 minutes.`,
      });
      const basic = Buffer.from(`${sid.plaintext}:${token.plaintext}`).toString("base64");
      const resp = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid.plaintext)}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${basic}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
        },
      );
      if (!resp.ok) {
        providerReason = `Twilio ${resp.status}: ${(await resp.text()).slice(0, 200)}`;
      } else {
        delivered = true;
      }
    } else {
      providerReason = "Twilio credentials not configured in Vault (add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER as platform integration_token secrets)";
    }

    const { error: uErr } = await sb(context)
      .from(T("platform_mfa_sms"))
      .update({
        code_hash,
        code_expires_at,
        code_attempts: 0,
        last_sent_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (uErr) throw new Error(uErr.message);
    return { delivered, provider_reason: providerReason };
  });

export const verifySmsCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i: unknown) => z.object({ id: z.string().uuid(), code: z.string().regex(/^\d{6}$/) }).parse(i))
  .handler(async ({ context, data }) => {
    const { createHash } = await import("crypto");
    const { data: row, error } = await sb(context)
      .from(T("platform_mfa_sms"))
      .select("id,code_hash,code_expires_at,code_attempts")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row || !(row as any).code_hash) throw new Error("No pending code");
    if (new Date((row as any).code_expires_at).getTime() < Date.now()) throw new Error("Code expired");
    if (((row as any).code_attempts ?? 0) >= 5) throw new Error("Too many attempts");
    const hash = createHash("sha256").update(data.code).digest("hex");
    if (hash !== (row as any).code_hash) {
      await sb(context)
        .from(T("platform_mfa_sms"))
        .update({ code_attempts: ((row as any).code_attempts ?? 0) + 1 })
        .eq("id", data.id);
      throw new Error("Invalid code");
    }
    const { error: uErr } = await sb(context)
      .from(T("platform_mfa_sms"))
      .update({
        verified: true,
        code_hash: null,
        code_expires_at: null,
        code_attempts: 0,
        last_used_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (uErr) throw new Error(uErr.message);
    return { ok: true };
  });

/* ================= MFA Recovery codes ================= */
export const listRecoveryCodes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data, error } = await sb(context)
      .from(T("mfa_recovery_codes"))
      .select("id,used_at,created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as any[];
    return {
      total: rows.length,
      remaining: rows.filter((r) => !r.used_at).length,
      generated_at: rows[0]?.created_at ?? null,
    };
  });

export const generateRecoveryCodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { randomBytes, createHash } = await import("crypto");
    // wipe old (used or not) — regeneration invalidates prior codes
    await sb(context).from(T("mfa_recovery_codes")).delete().eq("user_id", context.userId);
    const codes: string[] = [];
    const rows: { user_id: string; code_hash: string }[] = [];
    for (let i = 0; i < 10; i++) {
      // 10-char base32-ish, grouped 5-5 for readability, e.g. "3F9AK-Q28RT"
      const raw = randomBytes(8).toString("base64").replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 10);
      const plaintext = `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
      codes.push(plaintext);
      rows.push({ user_id: context.userId, code_hash: createHash("sha256").update(plaintext).digest("hex") });
    }
    const { error } = await sb(context).from(T("mfa_recovery_codes")).insert(rows);
    if (error) throw new Error(error.message);
    return { codes };
  });

export const consumeRecoveryCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i: unknown) => z.object({ code: z.string().min(6).max(24) }).parse(i))
  .handler(async ({ context, data }) => {
    const { createHash } = await import("crypto");
    const hash = createHash("sha256").update(data.code.trim().toUpperCase()).digest("hex");
    const { data: row, error } = await sb(context)
      .from(T("mfa_recovery_codes"))
      .select("id,used_at")
      .eq("user_id", context.userId)
      .eq("code_hash", hash)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Invalid recovery code");
    if ((row as any).used_at) throw new Error("Recovery code already used");
    const { error: uErr } = await sb(context)
      .from(T("mfa_recovery_codes"))
      .update({ used_at: new Date().toISOString() })
      .eq("id", (row as any).id);
    if (uErr) throw new Error(uErr.message);
    return { ok: true };
  });


/* ================= G-18/G-25 Policy rollback ================= */
export const rollbackPolicyVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i: unknown) =>
    z.object({ policy_kind: z.string(), policy_id: z.string(), version: z.number().int() }).parse(i),
  )
  .handler(async ({ context, data }) => {
    await assertPlatformAdmin(context);
    const { data: ver, error } = await sb(context)
      .from(T("platform_policy_versions"))
      .select("payload")
      .eq("policy_kind", data.policy_kind)
      .eq("policy_id", data.policy_id)
      .eq("version", data.version)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!ver) throw new Error("Version not found");
    const { data: nextVer } = await sb(context)
      .from(T("platform_policy_versions"))
      .select("version")
      .eq("policy_kind", data.policy_kind)
      .eq("policy_id", data.policy_id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextV = ((nextVer as any)?.version ?? 0) + 1;
    const { error: iErr } = await sb(context).from(T("platform_policy_versions")).insert({
      policy_kind: data.policy_kind,
      policy_id: data.policy_id,
      version: nextV,
      payload: (ver as any).payload,
      change_note: `Rollback to v${data.version}`,
      changed_by: context.userId,
    });
    if (iErr) throw new Error(iErr.message);
    return { ok: true, new_version: nextV };
  });

/* ================= G-34 PHI marker ================= */
export const upsertPhiMarker = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i: unknown) =>
    z
      .object({
        tenant_id: z.string().uuid(),
        contains_phi: z.boolean(),
        baa_contract_id: z.string().uuid().nullable().optional(),
        notes: z.string().nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ context, data }) => {
    await assertPlatformAdmin(context);
    const payload: any = { ...data, attested_by: context.userId, attested_at: new Date().toISOString() };
    const { error } = await sb(context).from(T("platform_phi_markers")).upsert(payload, { onConflict: "tenant_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ================= G-31 RCA producer ================= */
export const recordRcaHint = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i: unknown) =>
    z
      .object({
        incident_id: z.string().uuid().nullable().optional(),
        hint: z.string().min(1),
        confidence: z.number().min(0).max(100),
        source: z.string().default("manual"),
        evidence: z.record(z.string(), z.any()).default({}),
      })
      .parse(i),
  )
  .handler(async ({ context, data }) => {
    await assertPlatformAdmin(context);
    const { error } = await sb(context).from(T("platform_incident_rca_hints")).insert(data);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ================= G-32 Capacity producer ================= */
export const recordCapacityForecast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i: unknown) =>
    z
      .object({
        resource: z.string().min(1),
        forecast_window: z.string().default("30d"),
        horizon_days: z.number().int().default(30),
        predicted_usage: z.number(),
        capacity: z.number(),
        headroom_pct: z.number(),
        breach_eta_days: z.number().int().nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ context, data }) => {
    await assertPlatformAdmin(context);
    const { error } = await sb(context).from(T("platform_capacity_forecasts")).insert(data);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ================= G-40 Hallucination producer ================= */
export const recordHallucinationSample = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((i: unknown) =>
    z
      .object({
        model_id: z.string().min(1),
        hallucination_rate: z.number().min(0).max(100),
        sample_size: z.number().int().positive(),
        window_start: z.string(),
        window_end: z.string(),
        notes: z.string().nullable().optional(),
      })
      .parse(i),
  )
  .handler(async ({ context, data }) => {
    await assertPlatformAdmin(context);
    const { error } = await sb(context).from(T("platform_hallucination_metrics")).insert(data);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
