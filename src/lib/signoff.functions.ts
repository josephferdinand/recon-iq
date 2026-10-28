// Sign-off + balance substantiation server functions (P0 #2)
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const tenantOnly = z.object({ tenant_id: z.string().uuid() });
const periodInput = tenantOnly.extend({ period_date: z.string() });

export const listSignoffs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string; period_date?: string }) => d)
  .handler(async ({ data, context }) => {
    const q = context.supabase
      .from("eod_signoffs")
      .select("*")
      .eq("tenant_id", data.tenant_id)
      .order("period_date", { ascending: false })
      .limit(60);
    if (data.period_date) q.eq("period_date", data.period_date);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertSignoff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    periodInput
      .extend({
        id: z.string().uuid().optional(),
        scope: z.string().default("tenant"),
        definition_id: z.string().uuid().optional().nullable(),
        status: z.enum(["draft", "prepared", "approved", "rejected"]).default("draft"),
        note: z.string().optional(),
        metrics: z.record(z.any()).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const payload: any = {
      tenant_id: data.tenant_id,
      period_date: data.period_date,
      scope: data.scope,
      definition_id: data.definition_id ?? null,
      status: data.status,
      note: data.note,
      metrics: data.metrics ?? {},
    };
    if (data.status === "prepared") {
      payload.prepared_by = context.userId;
      payload.prepared_at = new Date().toISOString();
    }
    if (data.status === "approved") {
      payload.approved_by = context.userId;
      payload.approved_at = new Date().toISOString();
    }
    const q = data.id
      ? context.supabase
          .from("eod_signoffs")
          .update(payload)
          .eq("id", data.id)
          .eq("tenant_id", data.tenant_id)
          .select()
          .single()
      : context.supabase.from("eod_signoffs").insert(payload).select().single();
    const { data: row, error } = await q;
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      tenant_id: data.tenant_id,
      scope: "tenant",
      action: data.id ? `signoff.${data.status}` : "signoff.created",
      resource_type: "eod_signoff",
      resource_id: row!.id,
      context: { period_date: data.period_date },
    } as any);
    return row;
  });

export const listSubstantiations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string; signoff_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("balance_substantiations")
      .select("*")
      .eq("tenant_id", data.tenant_id)
      .eq("signoff_id", data.signoff_id)
      .order("account_code");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertSubstantiation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        tenant_id: z.string().uuid(),
        signoff_id: z.string().uuid(),
        account_code: z.string().min(1),
        account_name: z.string().optional(),
        currency: z.string().default("USD"),
        gl_balance: z.number(),
        sub_ledger_balance: z.number(),
        tolerance: z.number().default(0),
        status: z
          .enum(["open", "reconciled", "exception", "approved"])
          .default("open"),
        note: z.string().optional(),
        evidence: z.array(z.any()).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const payload: any = { ...data, evidence: data.evidence ?? [] };
    delete payload.id;
    if (data.status === "approved") {
      payload.approved_by = context.userId;
      payload.approved_at = new Date().toISOString();
    } else if (data.status === "reconciled") {
      payload.prepared_by = context.userId;
      payload.prepared_at = new Date().toISOString();
    }
    const q = data.id
      ? context.supabase
          .from("balance_substantiations")
          .update(payload)
          .eq("id", data.id)
          .eq("tenant_id", data.tenant_id)
          .select()
          .single()
      : context.supabase
          .from("balance_substantiations")
          .insert(payload)
          .select()
          .single();
    const { data: row, error } = await q;
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteSubstantiation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string; tenant_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("balance_substantiations")
      .delete()
      .eq("id", data.id)
      .eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
