// Server functions for the Excel-grid break notes editor.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

const NoteRow = z.object({
  id: z.string().uuid().optional(),
  note_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.enum([
    "investigation",
    "counterparty",
    "fx",
    "timing",
    "fees",
    "manual_adj",
    "sign_off",
    "other",
  ]),
  comment: z.string().max(4000),
  amount: z.number().finite().optional().nullable(),
  currency: z.string().min(3).max(3).optional().nullable(),
  status: z.enum(["open", "pending", "resolved"]),
});

async function assertBreakWriter(ctx: { supabase: SupabaseClient; userId: string }, tenantId: string, breakId: string) {
  const [{ data: admin }, { data: analyst }, { data: parent, error }] = await Promise.all([
    ctx.supabase.rpc("has_tenant_role", { _user_id: ctx.userId, _tenant_id: tenantId, _role: "tenant_admin" }),
    ctx.supabase.rpc("has_tenant_role", { _user_id: ctx.userId, _tenant_id: tenantId, _role: "tenant_analyst" }),
    ctx.supabase.from("recon_exceptions").select("id").eq("id", breakId).eq("tenant_id", tenantId).maybeSingle(),
  ]);
  if (error || !parent) throw new Error("Break not found in active tenant scope");
  if (!admin && !analyst) throw new Error("Forbidden: analyst or admin role required");
}

export const listBreakNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ tenantId: z.string().uuid(), breakId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertBreakWriter(context, data.tenantId, data.breakId);
    const { data: rows, error } = await context.supabase
      .from("break_notes")
      .select("id,note_date,category,comment,amount,currency,status,author,created_at,updated_at")
      .eq("tenant_id", data.tenantId)
      .eq("break_id", data.breakId)
      .order("note_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return rows ?? [];
  });

export const upsertBreakNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z
      .object({
        tenantId: z.string().uuid(),
        breakId: z.string().uuid(),
        row: NoteRow,
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const base = {
      tenant_id: data.tenantId,
      break_id: data.breakId,
      author: context.userId,
      note_date: data.row.note_date,
      category: data.row.category,
      comment: data.row.comment,
      amount: data.row.amount ?? null,
      currency: data.row.currency ?? null,
      status: data.row.status,
    };
    if (data.row.id) {
      const { error } = await context.supabase
        .from("break_notes")
        .update(base)
        .eq("id", data.row.id)
        .eq("tenant_id", data.tenantId)
        .eq("break_id", data.breakId);
      if (error) throw error;
      await context.supabase.from("audit_log").insert({
        tenant_id: data.tenantId,
        scope: "workspace",
        action: "break.note.update",
        resource_type: "break_note",
        resource_id: data.row.id,
        context: { break_id: data.breakId, category: data.row.category, status: data.row.status },
      } as never);
      return { id: data.row.id };
    }
    const { data: ins, error } = await context.supabase
      .from("break_notes")
      .insert(base)
      .select("id")
      .single();
    if (error) throw error;
    await context.supabase.from("audit_log").insert({
      tenant_id: data.tenantId,
      scope: "workspace",
      action: "break.note.create",
      resource_type: "break_note",
      resource_id: ins.id,
      context: { break_id: data.breakId, category: data.row.category, status: data.row.status },
    } as never);
    return { id: ins.id };
  });

export const deleteBreakNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid(), tenantId: z.string().uuid(), breakId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertBreakWriter(context, data.tenantId, data.breakId);
    const { error } = await context.supabase.from("break_notes").delete()
      .eq("id", data.id).eq("tenant_id", data.tenantId).eq("break_id", data.breakId);
    if (error) throw error;
    await context.supabase.from("audit_log").insert({
      tenant_id: data.tenantId,
      scope: "workspace",
      action: "break.note.delete",
      resource_type: "break_note",
      resource_id: data.id,
      context: { break_id: data.breakId },
    } as never);
    return { ok: true };
  });
