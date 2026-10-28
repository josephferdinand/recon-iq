import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** List active WebAuthn credentials for the current user. */
export const listWebauthnCredentials = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("webauthn_credentials")
      .select("id, device_label, transports, backup_eligible, last_used_at, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const deleteWebauthnCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("webauthn_credentials")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** List trusted devices for current user. */
export const listTrustedDevices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("trusted_devices")
      .select("id, device_label, user_agent, ip_address, last_seen_at, expires_at, revoked_at, created_at")
      .eq("user_id", context.userId)
      .order("last_seen_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({ ...r, ip_address: r.ip_address ? String(r.ip_address) : null }));
  });

export const revokeTrustedDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("trusted_devices")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Session revocations (self or platform admin scope). */
export const listSessionRevocations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("rbac_session_revocations")
      .select("id, user_id, revoked_at, revoked_by, reason")
      .order("revoked_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const revokeAllSessions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ reason: z.string().max(200).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    // Look up any tenant membership the user has; tenant_id is required.
    const { data: mem } = await context.supabase
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", context.userId)
      .limit(1)
      .maybeSingle();
    if (!mem?.tenant_id) throw new Error("No tenant membership found");
    const { error } = await context.supabase.from("rbac_session_revocations").insert({
      tenant_id: mem.tenant_id,
      user_id: context.userId,
      revoked_by: context.userId,
      reason: data.reason ?? "user_initiated_logout_all",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Recovery codes — list (masked) and generate new set. */
export const listRecoveryCodes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("mfa_recovery_codes")
      .select("id, used_at, created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

function randomCode(): string {
  // 10-character base32-ish code; suitable one-time use.
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const arr = new Uint8Array(10);
  crypto.getRandomValues(arr);
  for (const b of arr) out += chars[b % chars.length];
  return out.slice(0, 5) + "-" + out.slice(5);
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const generateRecoveryCodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    // Revoke prior codes
    await context.supabase.from("mfa_recovery_codes").delete().eq("user_id", context.userId);
    const codes: string[] = Array.from({ length: 10 }, () => randomCode());
    const rows = await Promise.all(
      codes.map(async (c) => ({ user_id: context.userId, code_hash: await sha256Hex(c) })),
    );
    const { error } = await context.supabase.from("mfa_recovery_codes").insert(rows);
    if (error) throw new Error(error.message);
    return { codes };
  });

/** Login anomaly events for current user (or all for platform admin). */
export const listLoginAnomalies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("login_anomaly_events")
      .select("id, user_id, event_type, severity, ip_address, geo_country, resolved_at, created_at, details")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({ ...r, ip_address: r.ip_address ? String(r.ip_address) : null }));
  });
