/**
 * Regulatory calendar server functions.
 *  - subscribeRegCalendarAlert: insert a notification for the current user for a specific deadline.
 *  - findInstallForRegulation: resolve the most recent installed pack matching a regulation code.
 *  - logRegPackGeneration: append an audit_log entry once the client has rematerialized the pack.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const subscribeRegCalendarAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z
      .object({
        tenant_id: z.string().uuid(),
        regulation: z.string().min(1).max(80),
        label: z.string().min(1).max(200),
        due_at: z.string(),
        days_before: z.number().int().min(0).max(30).default(1),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const dueDate = new Date(data.due_at);
    if (Number.isNaN(dueDate.getTime())) throw new Error("Invalid due_at");
    const { data: row, error } = await context.supabase
      .from("notifications")
      .insert({
        user_id: context.userId,
        tenant_id: data.tenant_id,
        kind: "regulatory.calendar.alert",
        severity: "info",
        title: `Reg deadline: ${data.label}`,
        body: `${data.regulation} · due ${dueDate.toLocaleDateString()} (alert ${data.days_before}d before)`,
        link_to: `/tenant/settings/verticals`,
        context: {
          regulation: data.regulation,
          label: data.label,
          due_at: data.due_at,
          days_before: data.days_before,
        },
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: data.tenant_id,
      scope: "tenant",
      action: "regulatory.calendar.alert.subscribe",
      resource_type: "notifications",
      resource_id: row.id,
      context: { regulation: data.regulation, label: data.label, due_at: data.due_at },
    } as never);
    return { id: row.id };
  });

export const findInstallForRegulation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ tenant_id: z.string().uuid(), regulation: z.string().min(1).max(80) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: installs, error } = await context.supabase
      .from("regulatory_pack_installs")
      .select(
        "id, pack_id, installed_version, status, installed_at, pack:regulatory_template_packs(code,title,regulation)",
      )
      .eq("tenant_id", data.tenant_id)
      .order("installed_at", { ascending: false });
    if (error) throw new Error(error.message);

    const upper = data.regulation.toUpperCase();
    const match = (installs ?? []).find(
      (r: { pack?: { regulation?: string | null } | null }) =>
        (r.pack?.regulation ?? "").toUpperCase().includes(upper),
    );
    if (!match) return null;
    return {
      install_id: match.id,
      pack_id: match.pack_id,
      pack_code: match.pack?.code ?? null,
      pack_title: match.pack?.title ?? null,
      installed_version: match.installed_version,
    };
  });

export const logRegPackGeneration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z
      .object({
        tenant_id: z.string().uuid(),
        install_id: z.string().uuid(),
        recon_id: z.string().uuid().optional(),
        regulation: z.string().min(1).max(80),
        label: z.string().min(1).max(200),
        due_at: z.string(),
        pack_code: z.string().optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: data.tenant_id,
      scope: "tenant",
      action: "regulatory.calendar.pack.generate",
      resource_type: "regulatory_pack_installs",
      resource_id: data.install_id,
      context: {
        regulation: data.regulation,
        label: data.label,
        due_at: data.due_at,
        pack_code: data.pack_code ?? null,
        recon_id: data.recon_id ?? null,
      },
    } as never);
    return { ok: true };
  });
