/**
 * SOC 2 Type II evidence pipeline — wave 2 deliverable. Reads the control
 * catalog, lists harvested evidence runs, and provides a signed export
 * (Drata-style) bundling the latest evidence per control.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listSoc2Controls = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("soc2_controls" as any)
      .select("id,control_code,tsc,title,description,owner")
      .order("control_code");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listSoc2Runs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ since_days: z.number().int().min(1).max(365).default(90) }).parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    const since = new Date(Date.now() - data.since_days * 24 * 3600_000).toISOString();
    const { data: rows, error } = await context.supabase
      .from("soc2_evidence_runs" as any)
      .select("id,control_id,run_date,status,evidence_sha256,notes,collected_at, control:soc2_controls(control_code,title,tsc,owner)")
      .gte("collected_at", since)
      .order("collected_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const exportSoc2Bundle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    // Platform-admin only — enforced by table RLS on soc2_evidence_runs
    const { data: controls } = await context.supabase
      .from("soc2_controls" as any)
      .select("id,control_code,tsc,title,owner")
      .order("control_code");
    const { data: latest } = await context.supabase
      .from("soc2_evidence_runs" as any)
      .select("control_id,run_date,status,evidence_sha256,collected_at,evidence_payload")
      .order("collected_at", { ascending: false });
    const byControl = new Map<string, any>();
    for (const r of (latest ?? []) as any[]) {
      if (!byControl.has(r.control_id)) byControl.set(r.control_id, r);
    }
    const bundle = {
      generated_at: new Date().toISOString(),
      controls: (controls ?? []).map((c: any) => ({
        ...c,
        latest_run: byControl.get(c.id) ?? null,
      })),
    };
    const json = JSON.stringify(bundle);
    const sha256 = await sha256Hex(json);
    return { sha256, size_bytes: json.length, bundle };
  });

export const startAccessReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid().nullable(),
      quarter: z.string().regex(/^\d{4}-Q[1-4]$/),
      total_users: z.number().int().min(0),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("soc2_access_reviews" as any)
      .insert({
        tenant_id: data.tenant_id,
        quarter: data.quarter,
        reviewer_user_id: context.userId,
        status: "in_progress",
        total_users: data.total_users,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, review_id: (row as any).id };
  });

export const signOffAccessReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      review_id: z.string().uuid(),
      removed_count: z.number().int().min(0),
      notes: z.string().max(2000).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("soc2_access_reviews" as any)
      .update({
        status: "signed_off",
        signed_off_at: new Date().toISOString(),
        removed_count: data.removed_count,
        notes: data.notes ?? null,
      })
      .eq("id", data.review_id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      scope: "platform",
      action: "soc2.access_review.signoff",
      resource_type: "soc2_access_reviews",
      resource_id: data.review_id,
      context: { removed_count: data.removed_count } as any,
    } as any);
    return { ok: true };
  });

async function sha256Hex(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
