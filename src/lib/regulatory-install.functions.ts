/**
 * D2 — EMIR Refit preconfigured processes.
 *
 * High-level install API that wraps the existing materialization engine in
 * `regulatory.functions.ts` with the D2 lifecycle contract:
 *
 *   installRegulatoryPack(tenantId, packCode, installedByUserId, { forceReinstall })
 *     → returns { installId } immediately, queues background materialization
 *   getInstallStatus(tenantId, installId)
 *   listInstalledPacks(tenantId)
 *
 * Materialization runs out-of-band via:
 *   /api/public/cron/regulatory-install-worker
 *
 * Idempotency: a tenant with an existing install row for (tenant, pack) in
 * status `pending|installing|materializing|ready` will receive the existing
 * install id unless `forceReinstall=true` is set, in which case a new
 * pending row is created and queued.
 */

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantAdmin } from "@/lib/rbac-guards.server";
import { z } from "zod";

export type RegulatoryPackInstall = {
  id: string;
  tenant_id: string;
  pack_id: string;
  pack_code: string | null;
  installed_version: string | null;
  installed_at: string;
  installed_by: string | null;
  status: string;
  error_message: string | null;
  generated_process_count: number;
  tenant_root_process_id: string | null;
  completed_at: string | null;
};

const ACTIVE_STATUSES = ["pending", "installing", "materializing", "ready"];

async function assertTenantAdmin(ctx: any, tenantId: string) {
  await requireTenantAdmin(ctx, tenantId, { fnName: "regulatory-install" });
}

export const installRegulatoryPack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z
      .object({
        tenant_id: z.string().uuid(),
        pack_code: z.string().min(1),
        force_reinstall: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ installId: string; reused: boolean }> => {
    await assertTenantAdmin(context, data.tenant_id);

    // a. Look up pack — try pack_code, fall back to legacy `code`.
    if (!/^[A-Za-z0-9_.-]+$/.test(data.pack_code)) {
      throw new Error("Invalid pack_code");
    }
    let { data: pack, error: pErr } = await context.supabase
      .from("regulatory_template_packs")
      .select("id, pack_code, code, version, status")
      .eq("pack_code", data.pack_code)
      .eq("status", "published")
      .maybeSingle();
    if (!pack && !pErr) {
      const fallback = await context.supabase
        .from("regulatory_template_packs")
        .select("id, pack_code, code, version, status")
        .eq("code", data.pack_code)
        .eq("status", "published")
        .maybeSingle();
      pack = fallback.data as any;
      pErr = fallback.error as any;
    }
    if (pErr) throw new Error(pErr.message);
    if (!pack) throw new Error(`Pack not found or not published: ${data.pack_code}`);

    // b. Idempotency
    if (!data.force_reinstall) {
      const { data: existing } = await context.supabase
        .from("regulatory_pack_installs")
        .select("id, status")
        .eq("tenant_id", data.tenant_id)
        .eq("pack_id", pack.id)
        .in("status", ACTIVE_STATUSES)
        .order("installed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing?.id) return { installId: existing.id, reused: true };
    }

    // c. Create pending install row
    const { data: row, error: insErr } = await context.supabase
      .from("regulatory_pack_installs")
      .insert({
        tenant_id: data.tenant_id,
        pack_id: pack.id,
        installed_by: context.userId,
        installed_version: pack.version,
        status: "installing",
      })
      .select("id")
      .single();
    if (insErr) throw new Error(insErr.message);

    // d. Queue background materialization (fire-and-forget HTTP).
    // The worker route is /api/public/cron/regulatory-install-worker.
    // We do NOT await — the call is intentionally fire-and-forget and the
    // user polls getInstallStatus from the UI.
    try {
      const origin =
        process.env.PUBLIC_BASE_URL ??
        process.env.VITE_PUBLIC_BASE_URL ??
        "";
      if (origin) {
        void fetch(`${origin}/api/public/cron/regulatory-install-worker`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ install_id: row.id }),
        }).catch(() => {});
      }
    } catch {
      // ignore — cron will pick it up on its scheduled run
    }

    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: data.tenant_id,
      scope: "tenant",
      action: "regulatory.pack.install_queued",
      resource_type: "regulatory_pack_installs",
      resource_id: row.id,
      context: { pack_code: pack.pack_code ?? pack.code, version: pack.version },
    } as any);

    return { installId: row.id, reused: false };
  });

export const getInstallStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ tenant_id: z.string().uuid(), install_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<RegulatoryPackInstall | null> => {
    const { data: row, error } = await context.supabase
      .from("regulatory_pack_installs")
      .select(
        "id, tenant_id, pack_id, installed_version, installed_at, installed_by, status, error_message, generated_process_count, tenant_root_process_id, completed_at, pack:regulatory_template_packs(pack_code, code, title, regulation)",
      )
      .eq("tenant_id", data.tenant_id)
      .eq("id", data.install_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return null;
    return {
      ...(row as any),
      pack_code: (row as any).pack?.pack_code ?? (row as any).pack?.code ?? null,
    };
  });

export const listInstalledPacks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<RegulatoryPackInstall[]> => {
    const { data: rows, error } = await context.supabase
      .from("regulatory_pack_installs")
      .select(
        "id, tenant_id, pack_id, installed_version, installed_at, installed_by, status, error_message, generated_process_count, tenant_root_process_id, completed_at, pack:regulatory_template_packs(pack_code, code, title, regulation, jurisdiction)",
      )
      .eq("tenant_id", data.tenant_id)
      .order("installed_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => ({
      ...r,
      pack_code: r.pack?.pack_code ?? r.pack?.code ?? null,
    }));
  });

export const listAvailablePacks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator(() => ({}))
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("regulatory_template_packs")
      .select(
        "id, code, pack_code, title, jurisdiction, regulation, version, summary, required_data_inputs, install_runbook_url, status",
      )
      .eq("status", "published")
      .order("regulation");
    if (error) throw new Error(error.message);
    return data ?? [];
  });
