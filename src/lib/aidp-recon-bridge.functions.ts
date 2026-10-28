/**
 * AIDP Slice 4 — Rekon hand-off bridge.
 * Lets tenant_admin link an entity type to a recon rule so accepted AIDP outputs
 * flow into the recon's reference data, and re-runs are enqueued when outputs
 * are superseded.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const LinkInput = z.object({
  tenant_id: z.string().uuid(),
  entity_type_id: z.string().uuid(),
  recon_rule_id: z.string().uuid(),
});

export const linkEntityTypeToReconRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => LinkInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Verify tenant_admin
    const { data: isAdmin } = await supabase
      .rpc("has_tenant_role", { _user_id: userId, _tenant_id: data.tenant_id, _role: "tenant_admin" });
    if (!isAdmin) {
      const { data: isPlat } = await supabase.rpc("is_platform_admin", { _user_id: userId });
      if (!isPlat) throw new Error("Forbidden: tenant_admin required");
    }

    // Validate the entity type belongs to this tenant
    const { data: et, error: etErr } = await supabase.from("aidp_entity_types")
      .select("id, tenant_id").eq("id", data.entity_type_id)
      .eq("tenant_id", data.tenant_id).maybeSingle();
    if (etErr || !et) throw new Error("Entity type not found in tenant");

    // Validate the recon rule belongs to this tenant (recon_nrl_rules is tenant-scoped)
    const { data: rule, error: rErr } = await supabase.from("recon_nrl_rules")
      .select("id, tenant_id").eq("id", data.recon_rule_id)
      .eq("tenant_id", data.tenant_id).maybeSingle();
    if (rErr || !rule) throw new Error("Recon rule not found in tenant");

    // Persist link
    const { error: upErr } = await supabase.from("aidp_entity_types")
      .update({ auto_publish_rule_id: data.recon_rule_id }).eq("id", data.entity_type_id);
    if (upErr) throw new Error(upErr.message);

    // Audit
    await supabase.from("audit_log").insert({
      actor_user_id: userId, tenant_id: data.tenant_id, scope: "tenant",
      action: "aidp.entity_type.link_recon",
      resource_type: "aidp_entity_types", resource_id: data.entity_type_id,
      context: { recon_rule_id: data.recon_rule_id },
    } as any);

    return { ok: true };
  });

const UnlinkInput = z.object({
  tenant_id: z.string().uuid(),
  entity_type_id: z.string().uuid(),
});

export const unlinkEntityTypeFromReconRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => UnlinkInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await context.supabase.from("aidp_entity_types")
      .update({ auto_publish_rule_id: null })
      .eq("id", data.entity_type_id).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    await supabase.from("audit_log").insert({
      actor_user_id: userId, tenant_id: data.tenant_id, scope: "tenant",
      action: "aidp.entity_type.unlink_recon",
      resource_type: "aidp_entity_types", resource_id: data.entity_type_id,
      context: {},
    } as any);
    return { ok: true };
  });
