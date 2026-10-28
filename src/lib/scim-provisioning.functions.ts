import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { requirePrivilegedAction } from "@/lib/step-up.server";

const tid = z.string().uuid();

const AttributeMappingSchema = z.record(z.string(), z.string()).refine(
  (m) => Object.keys(m).length >= 3 && Object.keys(m).length <= 40,
  { message: "attribute_mapping must have between 3 and 40 keys" },
);

const SettingsSchema = z.object({
  tenant_id: tid,
  enabled: z.boolean(),
  auto_deprovision: z.boolean(),
  default_role: z.enum(["tenant_member", "tenant_viewer", "tenant_admin"]),
  attribute_mapping: AttributeMappingSchema,
  base_url_override: z.string().url().max(500).nullable().optional(),
});

export type ScimProvisioningSettings = z.infer<typeof SettingsSchema> & {
  updated_at?: string;
  updated_by?: string | null;
};

const DEFAULT_MAPPING: Record<string, string> = {
  userName: "userName",
  email: "emails[primary].value",
  givenName: "name.givenName",
  familyName: "name.familyName",
  displayName: "displayName",
  externalId: "externalId",
  active: "active",
  department: "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User.department",
  title: "title",
  groups: "groups[].display",
};

export const getScimSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: tid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("scim_provisioning_settings")
      .select("*")
      .eq("tenant_id", data.tenant_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (
      row ?? {
        tenant_id: data.tenant_id,
        enabled: false,
        auto_deprovision: true,
        default_role: "tenant_member",
        base_url_override: null,
        attribute_mapping: DEFAULT_MAPPING,
        updated_at: null,
        updated_by: null,
      }
    );
  });

export const upsertScimSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => SettingsSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: canWrite } = await context.supabase.rpc("has_tenant_role", {
      _user_id: context.userId,
      _tenant_id: data.tenant_id,
      _role: "tenant_admin",
    });
    const { data: isPlatform } = await context.supabase.rpc("is_platform_admin", {
      _user_id: context.userId,
    });
    if (!canWrite && !isPlatform) throw new Error("Forbidden: tenant_admin or platform_admin required");

    await requirePrivilegedAction(context, "scim.settings.write", {
      tenantId: data.tenant_id,
      resourceType: "scim_provisioning_settings",
      resourceId: data.tenant_id,
      payload: {
        enabled: data.enabled,
        auto_deprovision: data.auto_deprovision,
        default_role: data.default_role,
        base_url_override: data.base_url_override ?? null,
        mapping_keys: Object.keys(data.attribute_mapping).length,
      },
    });


    const { error } = await context.supabase
      .from("scim_provisioning_settings")
      .upsert(
        {
          tenant_id: data.tenant_id,
          enabled: data.enabled,
          auto_deprovision: data.auto_deprovision,
          default_role: data.default_role,
          base_url_override: data.base_url_override ?? null,
          attribute_mapping: data.attribute_mapping,
          updated_by: context.userId,
          updated_at: new Date().toISOString(),
        } as any,
        { onConflict: "tenant_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const toggleScimEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ tenant_id: tid, enabled: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: canWrite } = await context.supabase.rpc("has_tenant_role", {
      _user_id: context.userId, _tenant_id: data.tenant_id, _role: "tenant_admin",
    });
    const { data: isPlatform } = await context.supabase.rpc("is_platform_admin", {
      _user_id: context.userId,
    });
    if (!canWrite && !isPlatform) throw new Error("Forbidden: tenant_admin or platform_admin required");
    await requirePrivilegedAction(context, "scim.toggle", {
      tenantId: data.tenant_id,
      resourceType: "scim_provisioning_settings",
      resourceId: data.tenant_id,
      payload: { enabled: data.enabled },
    });
    const { data: existing } = await context.supabase
      .from("scim_provisioning_settings")
      .select("tenant_id, enabled, auto_deprovision, default_role, attribute_mapping, base_url_override")
      .eq("tenant_id", data.tenant_id)
      .maybeSingle();
    const payload = {
      tenant_id: data.tenant_id,
      enabled: data.enabled,
      auto_deprovision: existing?.auto_deprovision ?? true,
      default_role: existing?.default_role ?? "tenant_member",
      attribute_mapping: (existing?.attribute_mapping as Record<string, string>) ?? DEFAULT_MAPPING,
      base_url_override: existing?.base_url_override ?? null,
      updated_by: context.userId,
      updated_at: new Date().toISOString(),
    };
    const { error } = await context.supabase
      .from("scim_provisioning_settings")
      .upsert(payload as any, { onConflict: "tenant_id" });
    if (error) throw new Error(error.message);
    return { ok: true as const, enabled: data.enabled };
  });

/** Returns tenants the caller can administer, for the tenant picker. */
export const listAdministrableTenants = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data: isPlatform } = await context.supabase.rpc("is_platform_admin", {
      _user_id: context.userId,
    });
    if (isPlatform) {
      const { data, error } = await context.supabase
        .from("tenants")
        .select("id, name, slug")
        .order("name")
        .limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as { id: string; name: string; slug: string }[];
    }
    const { data: memberships, error } = await context.supabase
      .from("tenant_members")
      .select("tenant_id, role, tenants(id, name, slug)")
      .eq("user_id", context.userId)
      .eq("role", "tenant_admin");
    if (error) throw new Error(error.message);
    return (memberships ?? [])
      .map((m: any) => m.tenants)
      .filter(Boolean) as { id: string; name: string; slug: string }[];
  });
