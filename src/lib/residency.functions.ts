import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const REGIONS = [
  { id: "eu-west-1", label: "EU West (Ireland)", residency: "EU" },
  { id: "eu-central-1", label: "EU Central (Frankfurt)", residency: "EU" },
  { id: "us-east-1", label: "US East (Virginia)", residency: "US" },
  { id: "us-west-2", label: "US West (Oregon)", residency: "US" },
  { id: "ap-southeast-1", label: "Asia Pacific (Singapore)", residency: "APAC" },
  { id: "ap-south-1", label: "India (Mumbai)", residency: "India" },
  { id: "uk-south-1", label: "UK South (London)", residency: "UK" },
] as const;

export const updateTenantResidency = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string; region: string; lock?: boolean }) =>
    z.object({
      tenant_id: z.string().uuid(),
      region: z.enum(REGIONS.map((r) => r.id) as [string, ...string[]]),
      lock: z.boolean().optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_tenant_role", {
      _user_id: context.userId, _tenant_id: data.tenant_id, _role: "tenant_admin",
    });
    if (!isAdmin) {
      const { data: pa } = await context.supabase.rpc("is_platform_admin", { _user_id: context.userId });
      if (!pa) throw new Error("Forbidden");
    }
    const { data: current } = await context.supabase.from("tenants")
      .select("region, residency_locked").eq("id", data.tenant_id).single();
    if (current?.residency_locked && current.region !== data.region)
      throw new Error("Residency is locked. Contact platform admin to change region.");
    const patch: any = { region: data.region };
    if (data.lock !== undefined) patch.residency_locked = data.lock;
    const { error } = await context.supabase.from("tenants").update(patch).eq("id", data.tenant_id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      tenant_id: data.tenant_id, scope: "tenant", action: "residency.update",
      resource_type: "tenants", resource_id: data.tenant_id,
      context: { region: data.region, locked: data.lock },
    } as any);
    return { ok: true };
  });
