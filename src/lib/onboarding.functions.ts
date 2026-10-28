import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Tenant onboarding flow.
 *
 * Invite-only: a platform admin provisions the tenant + a tenant_admin invitation.
 * The accepting user lands in /$slug/onboarding and walks a 3-step checklist:
 *   1) workspace     — verify membership + correct role under strict tenancy
 *   2) data_source   — connect at least one data source
 *   3) access_verified — run a roundtrip read against tenant-scoped data
 *
 * Each step writes to `tenants.onboarding_state` and the hash-chained audit_log.
 * Tenancy isolation is enforced via `is_tenant_member` + role checks; no cross-tenant reads.
 */

async function assertTenantMember(ctx: any, tenantId: string) {
  const { data: isMem } = await ctx.supabase.rpc("is_tenant_member", {
    _user_id: ctx.userId, _tenant_id: tenantId,
  });
  if (!isMem) {
    const { data: isAdmin } = await ctx.supabase.rpc("is_platform_admin", { _user_id: ctx.userId });
    if (!isAdmin) throw new Error("Forbidden");
  }
}

export const getOnboardingStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantMember(context, data.tenant_id);

    const { data: t, error } = await context.supabase
      .from("tenants")
      .select("id, name, slug, region, onboarding_state, onboarding_completed_at, residency_locked")
      .eq("id", data.tenant_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!t) throw new Error("Tenant not found");

    // Step 1 — workspace verification: the caller is a member with a real role.
    const { data: role } = await context.supabase
      .from("tenant_members")
      .select("role, joined_at")
      .eq("tenant_id", data.tenant_id)
      .eq("user_id", context.userId)
      .maybeSingle();

    // Step 2 — data source check: at least one configured data_source for this tenant.
    const { count: dsCount } = await context.supabase
      .from("workspace_data_sources")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", data.tenant_id);

    const state = ((t as any).onboarding_state ?? {}) as Record<string, boolean>;
    const computed = {
      workspace: !!role,
      data_source: (dsCount ?? 0) > 0,
      access_verified: !!state.access_verified,
    };
    const allDone = computed.workspace && computed.data_source && computed.access_verified;

    return {
      tenant: { id: t.id, name: t.name, slug: t.slug, region: t.region, residency_locked: !!t.residency_locked },
      member_role: role?.role ?? null,
      data_source_count: dsCount ?? 0,
      checklist: computed,
      completed_at: t.onboarding_completed_at,
      ready_for_completion: allDone && !t.onboarding_completed_at,
    };
  });

/** Step 3 — perform a tenant-isolated read to prove RLS works end to end. */
export const verifyTenantAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantMember(context, data.tenant_id);

    // Sanity probe: read a tenant-scoped table under the caller's session.
    // The select MUST return only this tenant's row(s); any cross-tenant leak would surface here.
    const { data: probe, error } = await context.supabase
      .from("tenants")
      .select("id, slug")
      .eq("id", data.tenant_id);
    if (error) throw new Error(`Access probe failed: ${error.message}`);
    if (!probe?.length) throw new Error("Access probe returned no rows (RLS blocked your own tenant — contact support).");
    if (probe.length !== 1 || probe[0].id !== data.tenant_id) {
      throw new Error("Access probe returned unexpected rows — possible tenancy issue, aborting.");
    }

    // Reverse probe: confirm we cannot read any *other* tenant.
    const { data: others } = await context.supabase
      .from("tenants")
      .select("id")
      .neq("id", data.tenant_id)
      .limit(1);
    if ((others ?? []).length > 0) {
      throw new Error("Tenancy isolation check failed: caller can read another tenant. Aborting onboarding.");
    }

    // Persist the verified state.
    const { data: existing } = await context.supabase
      .from("tenants").select("onboarding_state").eq("id", data.tenant_id).single();
    const newState = { ...(((existing as any)?.onboarding_state ?? {}) as object), access_verified: true };

    const { error: upErr } = await context.supabase
      .from("tenants").update({ onboarding_state: newState }).eq("id", data.tenant_id);
    if (upErr) throw new Error(upErr.message);

    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id,
      scope: "tenant", action: "onboarding.access_verified",
      resource_type: "tenant", resource_id: data.tenant_id, context: { probe: "ok" },
    } as any);

    return { ok: true };
  });

export const completeOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantMember(context, data.tenant_id);

    // Re-derive checklist server-side, never trust the client.
    const { data: role } = await context.supabase
      .from("tenant_members").select("role")
      .eq("tenant_id", data.tenant_id).eq("user_id", context.userId).maybeSingle();
    const { count: dsCount } = await context.supabase
      .from("workspace_data_sources").select("id", { count: "exact", head: true }).eq("tenant_id", data.tenant_id);
    const { data: t } = await context.supabase
      .from("tenants").select("onboarding_state").eq("id", data.tenant_id).single();
    const state = ((t as any)?.onboarding_state ?? {}) as Record<string, boolean>;

    if (!role || (dsCount ?? 0) === 0 || !state.access_verified) {
      throw new Error("Onboarding steps incomplete.");
    }

    const { error } = await context.supabase
      .from("tenants").update({ onboarding_completed_at: new Date().toISOString() }).eq("id", data.tenant_id);
    if (error) throw new Error(error.message);

    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id,
      scope: "tenant", action: "onboarding.completed",
      resource_type: "tenant", resource_id: data.tenant_id, context: {},
    } as any);
    return { ok: true };
  });
