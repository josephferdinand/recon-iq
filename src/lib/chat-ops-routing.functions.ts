/**
 * Chat-Ops routing rules — per-channel routing by severity/BU/recon, plus
 * a helper to pick the matching channel for a break event.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const tenantId = z.string().uuid();

export const listRoutingRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: tenantId }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("chat_ops_routing_rules" as any)
      .select("id,name,enabled,match_severity,match_bu_id,match_recon_id,channel,channel_kind,priority")
      .eq("tenant_id", data.tenant_id)
      .order("priority", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertRoutingRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      tenant_id: tenantId,
      name: z.string().min(1).max(120),
      enabled: z.boolean().default(true),
      match_severity: z.enum(["low", "medium", "high", "critical"]).nullable().optional(),
      match_bu_id: z.string().uuid().nullable().optional(),
      match_recon_id: z.string().uuid().nullable().optional(),
      channel: z.string().min(1).max(200),
      channel_kind: z.enum(["slack", "email", "teams", "webhook"]),
      priority: z.number().int().min(0).max(10_000).default(100),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const payload: any = { ...data, created_by: context.userId, updated_at: new Date().toISOString() };
    if (!data.id) delete payload.id;
    const { data: row, error } = await context.supabase
      .from("chat_ops_routing_rules" as any)
      .upsert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: (row as any).id };
  });

export const deleteRoutingRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("chat_ops_routing_rules" as any)
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Pick the highest-priority matching routing rule for a break event. Used
 * by the chat-ops dispatcher and by the slack outbound sync.
 */
export const matchRoutingRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: tenantId,
      severity: z.enum(["low", "medium", "high", "critical"]).optional(),
      bu_id: z.string().uuid().optional(),
      recon_id: z.string().uuid().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("chat_ops_routing_rules" as any)
      .select("id,name,channel,channel_kind,priority,match_severity,match_bu_id,match_recon_id")
      .eq("tenant_id", data.tenant_id)
      .eq("enabled", true)
      .order("priority", { ascending: true });
    if (error) throw new Error(error.message);
    const matches = (rows ?? []).filter((r: any) => {
      if (r.match_severity && data.severity && r.match_severity !== data.severity) return false;
      if (r.match_bu_id && r.match_bu_id !== data.bu_id) return false;
      if (r.match_recon_id && r.match_recon_id !== data.recon_id) return false;
      return true;
    });
    return matches[0] ?? null;
  });
