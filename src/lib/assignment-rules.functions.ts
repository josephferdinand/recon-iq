// Exception auto-assignment rules (P0 #4)
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantAdmin } from "@/lib/rbac-guards.server";
import { z } from "zod";

export const listAssignmentRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("exception_assignment_rules")
      .select("*")
      .eq("tenant_id", data.tenant_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertAssignmentRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        tenant_id: z.string().uuid(),
        recon_id: z.string().uuid().nullable().optional(),
        name: z.string().min(1),
        strategy: z.enum(["round_robin", "load_balanced", "by_tag", "by_severity"]),
        assignee_pool: z.array(z.string().uuid()).default([]),
        tag_routes: z.record(z.string().uuid()).default({}),
        severity_routes: z.record(z.string().uuid()).default({}),
        enabled: z.boolean().default(true),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireTenantAdmin(context, data.tenant_id, { fnName: "upsertAssignmentRule" });
    const payload: any = { ...data };
    delete payload.id;
    const q = data.id
      ? context.supabase
          .from("exception_assignment_rules")
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", data.id)
          .eq("tenant_id", data.tenant_id)
          .select()
          .single()
      : context.supabase
          .from("exception_assignment_rules")
          .insert({ ...payload, created_by: context.userId })
          .select()
          .single();
    const { data: row, error } = await q;
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      tenant_id: data.tenant_id,
      scope: "tenant",
      action: data.id ? "assignment_rule.updated" : "assignment_rule.created",
      resource_type: "exception_assignment_rule",
      resource_id: row!.id,
    } as any);
    return row;
  });

export const deleteAssignmentRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string; tenant_id: string }) => d)
  .handler(async ({ data, context }) => {
    await requireTenantAdmin(context, data.tenant_id, { fnName: "deleteAssignmentRule" });
    const { error } = await context.supabase
      .from("exception_assignment_rules")
      .delete()
      .eq("id", data.id)
      .eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const autoAssignExceptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator(
    (d: { tenant_id: string; rule_id: string; exception_ids: string[] }) => d,
  )
  .handler(async ({ data, context }) => {
    await requireTenantAdmin(context, data.tenant_id, { fnName: "autoAssignExceptions" });
    const { data: result, error } = await context.supabase.rpc(
      "assign_exceptions_from_rule",
      {
        _tenant_id: data.tenant_id,
        _rule_id: data.rule_id,
        _exception_ids: data.exception_ids,
      },
    );
    if (error) throw new Error(error.message);
    return result as { assigned: number; skipped: number };
  });
