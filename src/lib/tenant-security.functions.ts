/**
 * Tenant-scoped security surfaces: IP allowlist CRUD + DLP policy + scan review.
 * All functions require tenant_admin OR platform_admin.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantAdmin } from "@/lib/rbac-guards.server";
import { z } from "zod";

async function assertTenantAdmin(ctx: any, tenantId: string, fnName = "tenant_security") {
  await requireTenantAdmin(ctx, tenantId, { fnName });
  return true;
}

/* -------------------- IP Allowlist -------------------- */

export const listTenantIpAllowlist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context, data.tenant_id);
    const { data: rows, error } = await context.supabase
      .from("tenant_ip_allowlist")
      .select("id, cidr, label, created_at, created_by")
      .eq("tenant_id", data.tenant_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { rules: rows ?? [] };
  });

const CIDR_RE = /^(?:\d{1,3}\.){3}\d{1,3}\/(?:[0-9]|[12]\d|3[0-2])$|^[0-9a-fA-F:]+\/(?:[0-9]|[1-9]\d|1[0-1]\d|12[0-8])$/;

export const addTenantIpAllowlist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid(),
    cidr: z.string().min(3).max(64).regex(CIDR_RE, "Must be valid IPv4/IPv6 CIDR e.g. 10.0.0.0/24"),
    label: z.string().max(120).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context, data.tenant_id);
    const { error } = await context.supabase.from("tenant_ip_allowlist").insert({
      tenant_id: data.tenant_id,
      cidr: data.cidr,
      label: data.label ?? null,
      created_by: context.userId,
    });
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      tenant_id: data.tenant_id,
      actor_user_id: context.userId,
      scope: "tenant",
      action: "tenant.ip_allowlist.add",
      resource_type: "tenant_ip_allowlist",
      context: { cidr: data.cidr, label: data.label ?? null },
    } as any);
    return { ok: true };
  });

export const deleteTenantIpAllowlist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid(),
    id: z.string().uuid(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context, data.tenant_id);
    const { error } = await context.supabase
      .from("tenant_ip_allowlist")
      .delete().eq("id", data.id).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      tenant_id: data.tenant_id,
      actor_user_id: context.userId,
      scope: "tenant",
      action: "tenant.ip_allowlist.remove",
      resource_type: "tenant_ip_allowlist",
      resource_id: data.id,
    } as any);
    return { ok: true };
  });

/* -------------------- DLP -------------------- */

export const getDlpPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context, data.tenant_id);
    const { data: policy } = await context.supabase
      .from("dlp_policies").select("*").eq("tenant_id", data.tenant_id).maybeSingle();
    const { data: recent } = await context.supabase
      .from("dlp_scan_results")
      .select("id, source_kind, source_id, filename, severity, action_taken, matches, resolution, reviewed_at, created_at")
      .eq("tenant_id", data.tenant_id)
      .order("created_at", { ascending: false })
      .limit(50);
    const { count: openHigh } = await context.supabase
      .from("dlp_scan_results")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", data.tenant_id)
      .eq("severity", "high" as any)
      .is("reviewed_at", null);
    return {
      policy: policy ?? null,
      recent: recent ?? [],
      open_high: openHigh ?? 0,
    };
  });

export const updateDlpPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid(),
    enabled: z.boolean(),
    detect_pan: z.boolean(),
    detect_iban: z.boolean(),
    detect_ssn: z.boolean(),
    detect_email: z.boolean(),
    detect_aba: z.boolean(),
    detect_swift_bic: z.boolean(),
    default_action: z.enum(["allow", "redact", "block"]),
    block_on_high: z.boolean(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context, data.tenant_id);
    const { tenant_id, ...rest } = data;
    const { error } = await context.supabase
      .from("dlp_policies")
      .upsert({ tenant_id, ...rest, updated_at: new Date().toISOString() } as any, { onConflict: "tenant_id" });
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      tenant_id,
      actor_user_id: context.userId,
      scope: "tenant",
      action: "tenant.dlp_policy.update",
      resource_type: "dlp_policies",
      context: rest,
    } as any);
    return { ok: true };
  });

export const resolveDlpFinding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: z.string().uuid(),
    id: z.string().uuid(),
    resolution: z.string().max(500),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context, data.tenant_id);
    const { error } = await context.supabase
      .from("dlp_scan_results")
      .update({
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
        resolution: data.resolution,
      } as any)
      .eq("id", data.id).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
