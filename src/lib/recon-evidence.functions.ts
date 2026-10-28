// Reconciliation run evidence packs — immutable, hash-chained audit artifacts.
//
// Server fns expose:
//   - listReconEvidencePacks(tenantId)
//   - getReconEvidencePack(packId)
//   - generateReconEvidencePack(runId) (manual regeneration; auto-triggered on run completion)
//   - verifyReconEvidenceChain(tenantId)
//   - exportReconEvidencePack(packId) -> JSON string (download-ready)
//
// All access is tenant-scoped via RLS; writes happen only through the
// SECURITY DEFINER generator, which is itself audit-logged.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertTenantMember(supabase: any, userId: string, tenantId: string) {
  const { data, error } = await supabase
    .from("tenant_members")
    .select("user_id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Response(error.message, { status: 500 });
  if (!data) throw new Response("Forbidden", { status: 403 });
}

export const listReconEvidencePacks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenantId: string; runId?: string; limit?: number }) => d)
  .handler(async ({ data, context }) => {
    await assertTenantMember(context.supabase, context.userId, data.tenantId);
    let q = context.supabase
      .from("recon_run_evidence_packs")
      .select(
        "id, run_id, definition_id, definition_version, pack_version, generated_at, exception_count, match_count, closure_count, audit_anchor_id, row_hash, prev_hash",
      )
      .eq("tenant_id", data.tenantId)
      .order("generated_at", { ascending: false })
      .limit(Math.min(data.limit ?? 100, 500));
    if (data.runId) q = q.eq("run_id", data.runId);
    const { data: rows, error } = await q;
    if (error) throw new Response(error.message, { status: 500 });
    const runIds = [...new Set((rows ?? []).map((r) => r.run_id))];
    const runUidById = new Map<string, string>();
    for (let i = 0; i < runIds.length; i += 100) {
      const { data: runs, error: runsError } = await context.supabase
        .from("recon_runs")
        .select("id, run_uid")
        .eq("tenant_id", data.tenantId)
        .in("id", runIds.slice(i, i + 100));
      if (runsError) throw new Response(runsError.message, { status: 500 });
      for (const run of runs ?? []) {
        if (run.run_uid) runUidById.set(run.id, run.run_uid);
      }
    }
    return (rows ?? []).map((r: any) => ({
      ...r,
      run_uid: runUidById.get(r.run_id) ?? null,
      row_hash_hex: r.row_hash ? Buffer.from(r.row_hash).toString("hex") : null,
      prev_hash_hex: r.prev_hash ? Buffer.from(r.prev_hash).toString("hex") : null,
      row_hash: undefined,
      prev_hash: undefined,
    }));
  });

export const getReconEvidencePack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenantId: string; packId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertTenantMember(context.supabase, context.userId, data.tenantId);
    const { data: row, error } = await context.supabase
      .from("recon_run_evidence_packs")
      .select("*")
      .eq("tenant_id", data.tenantId)
      .eq("id", data.packId)
      .single();
    if (error) throw new Response(error.message, { status: 500 });
    return {
      ...row,
      row_hash_hex: row.row_hash ? Buffer.from(row.row_hash).toString("hex") : null,
      prev_hash_hex: row.prev_hash ? Buffer.from(row.prev_hash).toString("hex") : null,
    };
  });

export const generateReconEvidencePack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenantId: string; runId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertTenantMember(context.supabase, context.userId, data.tenantId);
    const { data: id, error } = await context.supabase.rpc("generate_recon_run_evidence_pack", {
      _run_id: data.runId,
    });
    if (error) throw new Response(error.message, { status: 500 });
    return { packId: id as string };
  });

export const verifyReconEvidenceChain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenantId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertTenantMember(context.supabase, context.userId, data.tenantId);
    const { data: rows, error } = await context.supabase.rpc("verify_recon_evidence_chain", {
      _tenant_id: data.tenantId,
    });
    if (error) throw new Response(error.message, { status: 500 });
    const items = (rows ?? []) as Array<{
      pack_id: string; run_id: string; pack_version: number; ok: boolean;
      expected_hash: string; actual_hash: string;
    }>;
    return {
      total: items.length,
      verified: items.filter((r) => r.ok).length,
      tampered: items.filter((r) => !r.ok),
    };
  });

export const exportReconEvidencePack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenantId: string; packId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertTenantMember(context.supabase, context.userId, data.tenantId);
    const { data: row, error } = await context.supabase
      .from("recon_run_evidence_packs")
      .select("*")
      .eq("tenant_id", data.tenantId)
      .eq("id", data.packId)
      .single();
    if (error) throw new Response(error.message, { status: 500 });
    const bundle = {
      pack_id: row.id,
      run_id: row.run_id,
      pack_version: row.pack_version,
      generated_at: row.generated_at,
      row_hash_hex: row.row_hash ? Buffer.from(row.row_hash).toString("hex") : null,
      prev_hash_hex: row.prev_hash ? Buffer.from(row.prev_hash).toString("hex") : null,
      audit_anchor_id: row.audit_anchor_id,
      payload: row.payload,
    };
    return { filename: `recon-evidence-${row.run_id}-v${row.pack_version}.json`, json: JSON.stringify(bundle, null, 2) };
  });
