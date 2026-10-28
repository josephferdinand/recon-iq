// Phase 7 — Upstream Drift Alerts + Dynamic Data Masking + Red-Team Scans
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const recordDriftAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      source: z.string().min(1),
      metric: z.string().min(1),
      baseline: z.number(),
      observed: z.number(),
      severity: z.enum(["low","medium","high","critical"]).default("medium"),
      payload: z.record(z.string(), z.unknown()).default({}),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const delta_pct = data.baseline === 0
      ? null
      : ((data.observed - data.baseline) / Math.abs(data.baseline)) * 100;
    const { data: row, error } = await context.supabase
      .from("upstream_drift_alerts").insert({ ...data, delta_pct } as never).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listDriftAlerts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      openOnly: z.boolean().default(true),
      limit: z.number().int().min(1).max(500).default(100),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("upstream_drift_alerts")
      .select("*")
      .eq("tenant_id", data.tenant_id)
      .order("detected_at", { ascending: false })
      .limit(data.limit);
    if (data.openOnly) q = q.eq("status", "open");
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const MaskStrategy = z.enum(["redact","hash","last4","email_local","truncate","null"]);

export const listMaskingRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ tenant_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("data_masking_rules").select("*").eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertMaskingRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      schema_name: z.string().default("public"),
      table_name: z.string().min(1),
      column_name: z.string().min(1),
      mask_strategy: MaskStrategy.default("redact"),
      applies_to_roles: z.array(z.string()).default(["authenticated"]),
      enabled: z.boolean().default(true),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("data_masking_rules")
      .upsert(data as never, { onConflict: "tenant_id,schema_name,table_name,column_name" } as never).select().single();
    if (error) throw new Error(error.message);
    return row;
  });

/**
 * Apply a mask strategy in-process. The DB stores the rule; this helper is
 * what server routes call before returning row values to the client.
 */
export function applyMask(value: unknown, strategy: z.infer<typeof MaskStrategy>): unknown {
  if (value === null || value === undefined) return value;
  const s = String(value);
  switch (strategy) {
    case "redact": return "•".repeat(Math.min(s.length, 8));
    case "hash": {
      let h = 0;
      for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
      return `sha:${(h >>> 0).toString(16).padStart(8, "0")}`;
    }
    case "last4": return s.length <= 4 ? "****" : "****" + s.slice(-4);
    case "email_local": {
      const at = s.indexOf("@");
      return at < 0 ? "****" : "****" + s.slice(at);
    }
    case "truncate": return s.slice(0, 3) + "…";
    case "null": return null;
    default: return value;
  }
}

export const startRedTeamScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid().nullable().optional(),
      scan_type: z.enum(["rls","prompt_injection","masking","scim","bola","full"]).default("full"),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("red_team_scans")
      .insert({ tenant_id: data.tenant_id ?? null, scan_type: data.scan_type, status: "running" } as never).select().single();
    if (error) throw new Error(error.message);
    return row;
  });
