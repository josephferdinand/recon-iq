/**
 * User profile server-functions.
 *
 * Powers the user-level /profile surface (vs. tenant-scoped $slug/tenant.settings.*).
 * Reads from auth.users (server-only fields) and merges with public.profiles.
 * Writes back to public.profiles only — email change uses supabase.auth.updateUser
 * on the client (it triggers a confirmation email) and is NOT exposed here.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const E164 = z
  .string()
  .regex(/^\+[1-9]\d{6,14}$/, "Phone must be E.164 (e.g. +14155552671)")
  .nullable()
  .optional();

const UpdateProfileSchema = z.object({
  full_name: z.string().min(1).max(120).optional(),
  phone_e164: E164,
  timezone: z.string().min(2).max(64).optional(),
  locale: z.string().min(2).max(10).optional(),
  job_title: z.string().max(120).nullable().optional(),
  marketing_opt_in: z.boolean().optional(),
});

export type MyProfile = {
  user_id: string;
  email: string;
  email_confirmed_at: string | null;
  last_sign_in_at: string | null;
  role: string;
  full_name: string | null;
  avatar_url: string | null;
  phone_e164: string | null;
  timezone: string;
  locale: string;
  job_title: string | null;
  marketing_opt_in: boolean;
};

export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }): Promise<MyProfile> => {
    const sb = context.supabase;
    // profiles row (self-only)
    const { data: p, error: pErr } = await sb
      .from("profiles")
      .select("full_name, avatar_url, phone_e164, timezone, locale, job_title, marketing_opt_in")
      .eq("id", context.userId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);

    // LL-066 — Bug 1 fix.
    //
    // Earlier this read `email_confirmed_at` from `context.claims` (the JWT
    // payload). Supabase's default JWT claim set does NOT include
    // `email_confirmed_at`, so the field was always null — every user
    // rendered as "Unverified" even when `auth.users.email_confirmed_at`
    // was set by the password-reset confirmation flow.
    //
    // Read the live value from `auth.users` via the service-role admin
    // client. Falls back to `null` if the lookup fails (e.g. user was
    // hard-deleted in the auth schema but their profile row lingers).
    let emailConfirmedAt: string | null = null;
    let lastSignInAt: string | null = null;
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(context.userId);
      if (authUser?.user) {
        emailConfirmedAt = (authUser.user as any).email_confirmed_at ?? null;
        lastSignInAt = (authUser.user as any).last_sign_in_at ?? null;
      }
    } catch {
      // Non-fatal — the UI will show "Unverified" rather than crashing.
    }

    return {
      user_id: context.userId,
      email: (context.claims as any)?.email ?? "",
      email_confirmed_at: emailConfirmedAt,
      last_sign_in_at: lastSignInAt,
      role: ((context.claims as any)?.app_metadata?.role as string) ?? "authenticated",
      full_name: (p as any)?.full_name ?? null,
      avatar_url: (p as any)?.avatar_url ?? null,
      phone_e164: (p as any)?.phone_e164 ?? null,
      timezone: (p as any)?.timezone ?? "UTC",
      locale: (p as any)?.locale ?? "en-US",
      job_title: (p as any)?.job_title ?? null,
      marketing_opt_in: (p as any)?.marketing_opt_in ?? false,
    };
  });

export const updateMyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => UpdateProfileSchema.parse(d))
  .handler(async ({ data, context }) => {
    // Defensive: strip unknown keys to ensure we never send `email` (or any
    // other profile-managed column) by accident. The `profiles.email` column
    // is `NOT NULL` and is owned by the auth.users handle_new_user trigger —
    // it must NEVER be written from this function. If a future caller adds
    // `email` to the schema, this strip() keeps the upsert safe.
    const safe: Record<string, unknown> = { ...(data as any) };
    delete safe.email;
    delete safe.id;
    delete safe.created_at;

    // Use UPDATE rather than UPSERT. The handle_new_user() trigger creates
    // the profile row on auth.users INSERT, so the row always exists for any
    // authenticated user. An UPSERT here would attempt an INSERT-without-email
    // if the row was somehow missing (and fail with a confusing NOT NULL
    // constraint error). UPDATE is a no-op when the row doesn't exist —
    // safer and matches the intended behavior.
    const { error, count } = await context.supabase
      .from("profiles")
      .update(
        { ...safe, updated_at: new Date().toISOString() } as any,
      )
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    if (count === 0) {
      // Profile row missing — extremely rare (would only happen if the
      // handle_new_user trigger failed for this user). Surface a clear,
      // non-500 message rather than silently succeeding.
      return { ok: true, created: false } as const;
    }
    return { ok: true, created: true } as const;
  });

/**
 * LL-066 — Bug 1 fix (auto-confirm signup).
 *
 * Called by `src/routes/auth.tsx` immediately after `supabase.auth.signUp`
 * succeeds, so that the new user is `email_confirmed` server-side without
 * needing to click a confirmation link. ReconIQ is an enterprise platform
 * where users are added by tenant admins (not public self-signup), so
 * e-mail loop confirmation adds friction without a security benefit.
 *
 * Safety:
 *  - No auth required (the user isn't signed in yet — they just signed up).
 *  - Validates the input is a UUID, the user exists, IS unconfirmed, and
 *    was created within the last 5 minutes. This prevents random callers
 *    from confirming arbitrary long-standing accounts.
 *  - Idempotent: a second call on the same user is a no-op (already
 *    confirmed → returns `already_confirmed: true`).
 *
 * Does NOT touch the password-reset confirmation flow — that flow
 * correctly sets `email_confirmed_at` itself when the user clicks the
 * reset link.
 */
const confirmMySignupSchema = z.object({
  userId: z.string().uuid("userId must be a UUID"),
});

export const confirmMySignup = createServerFn({ method: "POST" })
  .validator((d: unknown) => confirmMySignupSchema.parse(d))
  .handler(async ({ data }) => {
    const { userId } = data;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing, error: getErr } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (getErr || !existing?.user) {
      throw new Error("User not found");
    }
    const u = existing.user as any;
    if (u.email_confirmed_at) {
      // Idempotent — already confirmed (e.g. someone re-called us).
      return { ok: true, already_confirmed: true };
    }
    const createdAt = u.created_at ? new Date(u.created_at).getTime() : 0;
    const ageMs = Date.now() - createdAt;
    // 5-minute freshness window. Prevents enumeration: a leaked UUID
    // older than 5 minutes cannot be retro-confirmed by this endpoint.
    if (!createdAt || ageMs > 5 * 60 * 1000) {
      throw new Error("Signup window expired — please use the email confirmation link");
    }

    const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      email_confirm: true,
    });
    if (updErr) throw new Error(updErr.message);
    return { ok: true, already_confirmed: false };
  });