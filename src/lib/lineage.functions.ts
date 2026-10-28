import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const tid = z.string().uuid();

export const listLineageEdges = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: tid,
      source_kind: z.string().optional(),
      target_kind: z.string().optional(),
      limit: z.number().int().min(1).max(2000).default(500),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("data_lineage_edges")
      .select("*").eq("tenant_id", data.tenant_id)
      .order("recorded_at", { ascending: false }).limit(data.limit);
    if (data.source_kind) q = q.eq("source_kind", data.source_kind);
    if (data.target_kind) q = q.eq("target_kind", data.target_kind);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const recordLineageEdge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: tid,
      source_kind: z.string().min(1).max(60),
      source_ref: z.string().min(1).max(200),
      source_label: z.string().max(200).optional().nullable(),
      target_kind: z.string().min(1).max(60),
      target_ref: z.string().min(1).max(200),
      target_label: z.string().max(200).optional().nullable(),
      transform: z.string().max(2000).optional().nullable(),
      attributes: z.record(z.string(), z.unknown()).default({}),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("data_lineage_edges")
      .insert({ ...data, attributes: data.attributes as any, recorded_by: context.userId })
      .select("id").single();
    if (error) throw new Error(error.message);
    return row;
  });

export const lineageEvidencePack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: tid,
    target_kind: z.string().min(1).max(60).optional(),
    target_ref: z.string().min(1).max(200).optional(),
  }).refine((value) => !!value.target_kind === !!value.target_ref, "Select both target kind and reference").parse(d))
  .handler(async ({ data, context }) => {
    let query = context.supabase.from("data_lineage_edges")
      .select("id,source_kind,source_ref,source_label,target_kind,target_ref,target_label,transform,recorded_at,recorded_by")
      .eq("tenant_id", data.tenant_id).order("recorded_at", { ascending: false })
      .order("id", { ascending: false }).limit(501);
    if (data.target_kind && data.target_ref) query = query.eq("target_kind", data.target_kind).eq("target_ref", data.target_ref);
    const { data: loaded, error } = await query;
    if (error) throw new Error(error.message);
    const rows = (loaded ?? []).slice(0, 500).map((row) => ({ id: row.id,
      source_kind: row.source_kind, source_ref: row.source_ref, source_label: row.source_label,
      target_kind: row.target_kind, target_ref: row.target_ref, target_label: row.target_label,
      transform: row.transform, recorded_at: row.recorded_at, recorded_by: row.recorded_by }));
    const nodes = new Map<string, { id: string; kind: string; label: string }>();
    for (const r of rows ?? []) {
      const s = JSON.stringify([r.source_kind, r.source_ref]);
      const t = JSON.stringify([r.target_kind, r.target_ref]);
      if (!nodes.has(s)) nodes.set(s, { id: s, kind: r.source_kind, label: r.source_label ?? r.source_ref });
      if (!nodes.has(t)) nodes.set(t, { id: t, kind: r.target_kind, label: r.target_label ?? r.target_ref });
    }
    return {
      framework: "Recorded data lineage",
      generated_at: new Date().toISOString(),
      scope: { tenant_id: data.tenant_id, target_kind: data.target_kind ?? null, target_ref: data.target_ref ?? null,
        row_limit: 500, returned_edges: rows.length, has_more: (loaded?.length ?? 0) > 500,
        coverage: "RLS-visible recorded links only; completeness and regulatory compliance are not asserted" },
      edges: rows ?? [],
      nodes: Array.from(nodes.values()),
    };
  });
