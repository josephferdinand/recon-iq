import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const TABLES = [
  "audit_log", "ai_usage_events", "security_events",
  "recon_runs", "recon_exceptions", "recon_matches",
  "email_send_log", "aidp_pages", "aidp_output_recon_invalidations",
] as const;

const PUBLISHED_RETENTION_DEFAULTS = [
  { table_name: "audit_log", retention_days: 2557, regulatory_basis: "SOX / SOC2 / 7-year regulatory minimum" },
  { table_name: "ai_usage_events", retention_days: 730, regulatory_basis: "AI governance audit trail (2 years)" },
  { table_name: "security_events", retention_days: 730, regulatory_basis: "SOC2 CC7.2 incident detection (2 years)" },
  { table_name: "recon_runs", retention_days: 395, regulatory_basis: "Tenant default 13 months; overridable per tenant" },
  { table_name: "recon_exceptions", retention_days: 395, regulatory_basis: "Break management evidence (13 months)" },
  { table_name: "recon_matches", retention_days: 395, regulatory_basis: "Match audit trail (13 months)" },
  { table_name: "email_send_log", retention_days: 365, regulatory_basis: "CAN-SPAM / deliverability investigation window" },
  { table_name: "aidp_pages", retention_days: 90, regulatory_basis: "AIDP page binaries — short-lived working set" },
  { table_name: "aidp_output_recon_invalidations", retention_days: 90, regulatory_basis: "AIDP to Recon invalidation index — short-lived" },
] as const;


export const listRetentionPolicies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id?: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: defaults, error: e1 } = await supabase
      .from("retention_policies")
      .select("table_name, retention_days, regulatory_basis, floor_days, configurable, archive_to, updated_at" as any)
      .order("table_name");
    if (e1) throw new Error(e1.message);
    let overrides: any[] = [];
    if (data.tenant_id) {
      const { data: ov } = await supabase
        .from("tenant_retention_overrides" as any)
        .select("table_name, retention_days, reason, updated_at")
        .eq("tenant_id", data.tenant_id);
      overrides = (ov as any) ?? [];
    }
    return {
      tables: TABLES.map((t) => {
        const d = (defaults ?? []).find((x: any) => x.table_name === t) as any;
        const o = overrides.find((x: any) => x.table_name === t);
        return {
          table_name: t,
          default_days: d?.retention_days ?? null,
          floor_days: d?.floor_days ?? null,
          configurable: d?.configurable ?? true,
          archive_to: d?.archive_to ?? null,
          basis: d?.regulatory_basis ?? null,
          override_days: o?.retention_days ?? null,
          override_reason: o?.reason ?? null,
          override_updated_at: o?.updated_at ?? null,
          effective_days: o?.retention_days ?? d?.retention_days ?? null,
          purgeable: t !== "audit_log",
        };
      }),
    };
  });


export const setRetentionOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string; table_name: string; retention_days: number | null; reason?: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (!TABLES.includes(data.table_name as any)) throw new Error("Invalid table");
    if (data.table_name === "audit_log") throw new Error("audit_log retention is regulatory-fixed");
    if (data.retention_days === null) {
      const { error } = await supabase
        .from("tenant_retention_overrides" as any)
        .delete()
        .eq("tenant_id", data.tenant_id)
        .eq("table_name", data.table_name);
      if (error) throw new Error(error.message);
      return { ok: true, cleared: true };
    }
    if (data.retention_days < 1 || data.retention_days > 3650) throw new Error("retention_days 1..3650");
    const { error } = await supabase
      .from("tenant_retention_overrides" as any)
      .upsert({
        tenant_id: data.tenant_id,
        table_name: data.table_name,
        retention_days: data.retention_days,
        reason: data.reason ?? null,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      } as any);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listArchiveLedger = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string; limit?: number }) => d)
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("retention_archive_ledger" as any)
      .select("id, table_name, archive_uri, row_count, earliest_ts, latest_ts, status, sha256_hex, created_at")
      .eq("tenant_id", data.tenant_id)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 100);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listPublicRetentionPolicies = createServerFn({ method: "GET" })
  .handler(async () => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data, error } = await supabaseAdmin
        .from("retention_policies")
        .select("table_name, retention_days, regulatory_basis")
        .order("table_name");
      if (error || !data?.length) throw new Error("live retention policy unavailable");
      return data;
    } catch {
      console.warn("[retention] live policy unavailable; using published version-controlled defaults");
      return PUBLISHED_RETENTION_DEFAULTS.map((policy) => ({ ...policy }));
    }
  });
