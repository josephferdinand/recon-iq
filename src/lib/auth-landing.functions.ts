import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { computeLandingPath } from "./auth-landing-resolver";

/**
 * Resolve where to land a user immediately after sign-in.
 * Routing logic (in order):
 *   1. If `preferred_slug` is provided AND user is a member → go there.
 *   2. If `profiles.default_tenant_id` is set AND user is still a member → go there.
 *   3. If the user has exactly one tenant → go straight to its workspace.
 *   4. Otherwise → land on /home tenant picker.
 *
 * Returns the absolute pathname the client should navigate to.
 */
export const resolveLandingTenant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: { preferred_slug?: string } | undefined) =>
    z
      .object({ preferred_slug: z.string().trim().min(1).max(80).optional() })
      .optional()
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 1. Membership lookup (RLS-scoped to caller).
    const { data: memberships, error } = await supabase
      .from("tenant_members")
      .select("tenant:tenants(id, slug, name)")
      .eq("user_id", userId)
      .eq("active", true);
    if (error) {
      return { path: "/home", reason: "membership_lookup_failed" as const };
    }

    const tenants: Array<{ id: string; slug: string; name: string }> = (memberships ?? [])
      .map((m: any) => m.tenant)
      .filter(Boolean);

    // Profile default (only needed if neither preferred nor single match).
    const { data: profile } = await supabase
      .from("profiles")
      .select("default_tenant_id")
      .eq("id", userId)
      .maybeSingle();

    return computeLandingPath({
      tenants,
      defaultTenantId: profile?.default_tenant_id ?? null,
      preferredSlug: data?.preferred_slug ?? null,
    });
  });

/**
 * Persist a user's default tenant choice so future logins skip the picker.
 */
export const setDefaultTenant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: { tenant_id: string }) =>
    z.object({ tenant_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Verify membership before persisting.
    const { data: member, error: memberErr } = await supabase
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", userId)
      .eq("tenant_id", data.tenant_id)
      .eq("active", true)
      .maybeSingle();
    if (memberErr || !member) throw new Error("Not a member of this tenant");

    const { error } = await supabase
      .from("profiles")
      .update({ default_tenant_id: data.tenant_id })
      .eq("id", userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/**
 * Post-login path resolver with a Platform Owner chooser.
 *
 * - Platform admins → `/console` chooser (Marketing/Public Site Admin vs ReconIQ Console),
 *   unless `skip_chooser: true` (used by the chooser page itself to compute the
 *   underlying ReconIQ destination).
 * - Everyone else → normal `resolveLandingTenant` behaviour.
 */
export const postLoginLanding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: { preferred_slug?: string; skip_chooser?: boolean } | undefined) =>
    z
      .object({
        preferred_slug: z.string().trim().min(1).max(80).optional(),
        skip_chooser: z.boolean().optional(),
      })
      .optional()
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: pa, error: paError } = await supabase.rpc("is_platform_admin", { _user_id: userId });
    if (paError) return { path: "/home", reason: "platform_lookup_failed" as const };
    const { data: psa, error: psaError } = await supabase.rpc("is_platform_super_admin", { _user_id: userId });
    if (psaError) return { path: "/home", reason: "platform_lookup_failed" as const };
    const isPlatformAdmin = Boolean(pa);
    const isPlatformSuperAdmin = Boolean(psa);

    if (isPlatformAdmin && !data?.skip_chooser) {
      return {
        path: "/console",
        reason: "platform_admin_chooser" as const,
        isPlatformAdmin: true,
        isPlatformSuperAdmin,
      };
    }

    // Delegate to standard resolver for the ReconIQ leg.
    const { data: memberships, error } = await supabase
      .from("tenant_members")
      .select("tenant:tenants(id, slug, name)")
      .eq("user_id", userId)
      .eq("active", true);
    if (error) return {
      path: "/home", reason: "membership_lookup_failed" as const,
      isPlatformAdmin, isPlatformSuperAdmin,
    };

    const tenants: Array<{ id: string; slug: string; name: string }> = (memberships ?? [])
      .map((m: any) => m.tenant)
      .filter(Boolean);

    const { data: profile } = await supabase
      .from("profiles")
      .select("default_tenant_id")
      .eq("id", userId)
      .maybeSingle();

    const res = computeLandingPath({
      tenants,
      defaultTenantId: profile?.default_tenant_id ?? null,
      preferredSlug: data?.preferred_slug ?? null,
    });
    return { ...res, isPlatformAdmin, isPlatformSuperAdmin };
  });
