import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const tid = z.string().uuid();

export const listReportingMappings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: tid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("reporting_field_mappings").select("*")
      .eq("tenant_id", data.tenant_id)
      .order("canonical_field", { ascending: true })
      .order("version", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertReportingMapping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      tenant_id: tid,
      canonical_field: z.string().min(1).max(120),
      display_label: z.string().min(1).max(160),
      data_type: z.enum(["string","number","date","boolean","currency"]).default("string"),
      description: z.string().max(500).optional().nullable(),
      source_mappings: z.array(z.object({
        recon_definition_id: z.string().uuid().optional(),
        side_id: z.string().optional(),
        source_field: z.string(),
        transform: z.string().optional(),
      })).default([]),
      ai_suggested: z.boolean().default(false),
      ai_confidence: z.number().min(0).max(1).optional().nullable(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const payload: any = { ...data, created_by: context.userId, status: "draft" };
    if (!data.id) delete payload.id;
    const { data: row, error } = await context.supabase
      .from("reporting_field_mappings").upsert(payload).select("id").single();
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: data.id ? "reporting.mapping.update" : "reporting.mapping.create",
      resource_type: "reporting_field_mappings", resource_id: row.id,
      context: { canonical_field: data.canonical_field },
    } as any);
    return row;
  });

export const approveReportingMapping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), tenant_id: tid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: existing } = await context.supabase
      .from("reporting_field_mappings").select("created_by, status")
      .eq("id", data.id).single();
    if (existing?.created_by === context.userId) {
      throw new Error("Maker cannot approve their own mapping (4-eyes).");
    }
    const { error } = await context.supabase
      .from("reporting_field_mappings")
      .update({ status: "approved", approved_by: context.userId, approved_at: new Date().toISOString() })
      .eq("id", data.id).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: "reporting.mapping.approve",
      resource_type: "reporting_field_mappings", resource_id: data.id, context: {},
    } as any);
    return { ok: true };
  });

export const suggestReportingMappings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: tid }).parse(d))
  .handler(async ({ data, context }) => {
    // Lightweight AI-suggest: gather distinct field names from recent uploads, propose canonical names.
    const { data: defs } = await context.supabase
      .from("recon_definitions").select("id, name, sides")
      .eq("tenant_id", data.tenant_id).limit(50);
    const seen = new Map<string, { hits: number; samples: string[] }>();
    for (const d of defs ?? []) {
      for (const s of (d.sides as any[]) ?? []) {
        for (const k of (s.key_fields ?? []) as string[]) {
          const cur = seen.get(k) ?? { hits: 0, samples: [] };
          cur.hits += 1;
          if (!cur.samples.includes(d.name)) cur.samples.push(d.name);
          seen.set(k, cur);
        }
      }
    }
    return Array.from(seen.entries()).map(([field, v]) => ({
      canonical_field: field.toLowerCase().replace(/[^a-z0-9_]+/g, "_"),
      display_label: field,
      ai_confidence: Math.min(0.5 + v.hits * 0.1, 0.95),
      sample_sources: v.samples.slice(0, 5),
    }));
  });
