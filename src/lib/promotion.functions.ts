import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { createHash } from "node:crypto";

const hashJson = (o: unknown) =>
  createHash("sha256").update(JSON.stringify(o ?? {})).digest("hex");

export const listPackages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ family_id: z.string().uuid().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("promotion_packages")
      .select("id, family_id, source_tenant_id, target_tenant_id, target_environment, name, status, payload_hash, required_approvals, created_at, promoted_at")
      .order("created_at", { ascending: false }).limit(100);
    if (data.family_id) q = q.eq("family_id", data.family_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const getPackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: pkg, error } = await context.supabase
      .from("promotion_packages").select("*").eq("id", data.id).single();
    if (error) throw new Error(error.message);
    const { data: approvals } = await context.supabase
      .from("promotion_approvals").select("approver_id, decision, comment, decided_at")
      .eq("package_id", data.id);
    const { data: snaps } = await context.supabase
      .from("promotion_snapshots").select("id, target_tenant_id, snapshot_hash, created_at")
      .eq("package_id", data.id).order("created_at", { ascending: false });
    return { pkg, approvals: approvals ?? [], snapshots: snaps ?? [] };
  });

export const createPackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      source_tenant_id: z.string().uuid(),
      target_tenant_id: z.string().uuid(),
      name: z.string().min(3).max(120),
      notes: z.string().max(1000).optional(),
      payload: z.record(z.string(), z.unknown()).default({}),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: src } = await context.supabase
      .from("tenants").select("id, family_id, environment").eq("id", data.source_tenant_id).single();
    const { data: tgt } = await context.supabase
      .from("tenants").select("id, family_id, environment").eq("id", data.target_tenant_id).single();
    if (!src || !tgt) throw new Error("Tenants not found");
    if ((src as any).family_id !== (tgt as any).family_id) throw new Error("Tenants must be in the same family");

    const required = (tgt as any).environment === "prod" ? 2 : 1;
    const payload_hash = hashJson(data.payload);
    const { data: row, error } = await context.supabase
      .from("promotion_packages").insert({
        family_id: (src as any).family_id,
        source_tenant_id: data.source_tenant_id,
        target_tenant_id: data.target_tenant_id,
        target_environment: (tgt as any).environment,
        name: data.name, notes: data.notes ?? null,
        payload: data.payload as any, payload_hash,
        required_approvals: required,
        status: "pending_approval",
        created_by: context.userId,
      }).select("id, family_id, target_environment").single();
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.source_tenant_id,
      scope: "tenant", action: "promotion.create",
      resource_type: "promotion_package", resource_id: row.id,
      context: { target_env: row.target_environment, payload_hash, required },
    } as any);
    return row;
  });

export const decidePackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      package_id: z.string().uuid(),
      decision: z.enum(["approve", "reject"]),
      comment: z.string().max(500).optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: pkg } = await context.supabase
      .from("promotion_packages").select("id, status, required_approvals, source_tenant_id")
      .eq("id", data.package_id).single();
    if (!pkg) throw new Error("Not found");
    if ((pkg as any).status !== "pending_approval") throw new Error("Not pending");

    const { error } = await context.supabase.from("promotion_approvals").insert({
      package_id: data.package_id, approver_id: context.userId,
      decision: data.decision, comment: data.comment ?? null,
    });
    if (error) throw new Error(error.message);

    if (data.decision === "reject") {
      await context.supabase.from("promotion_packages")
        .update({ status: "rejected" }).eq("id", data.package_id);
    } else {
      const { count } = await context.supabase
        .from("promotion_approvals").select("id", { count: "exact", head: true })
        .eq("package_id", data.package_id).eq("decision", "approve");
      if ((count ?? 0) >= (pkg as any).required_approvals) {
        await context.supabase.from("promotion_packages")
          .update({ status: "approved" }).eq("id", data.package_id);
      }
    }
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: (pkg as any).source_tenant_id,
      scope: "tenant", action: `promotion.${data.decision}`,
      resource_type: "promotion_package", resource_id: data.package_id,
      context: { comment: data.comment ?? null },
    } as any);
    return { ok: true };
  });

export const promotePackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ package_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: pkg } = await context.supabase
      .from("promotion_packages").select("*").eq("id", data.package_id).single();
    if (!pkg) throw new Error("Not found");
    if ((pkg as any).status !== "approved") throw new Error("Package not approved");

    // Snapshot current target state (placeholder until recon definitions exist)
    const snapshot = { taken_at: new Date().toISOString(), source: (pkg as any).source_tenant_id };
    const snapshot_hash = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
    await context.supabase.from("promotion_snapshots").insert({
      package_id: data.package_id,
      target_tenant_id: (pkg as any).target_tenant_id,
      snapshot, snapshot_hash,
    });
    await context.supabase.from("promotion_packages").update({
      status: "promoted", promoted_at: new Date().toISOString(), promoted_by: context.userId,
    }).eq("id", data.package_id);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: (pkg as any).source_tenant_id,
      scope: "tenant", action: "promotion.promote",
      resource_type: "promotion_package", resource_id: data.package_id,
      context: { target_tenant: (pkg as any).target_tenant_id, snapshot_hash },
    } as any);
    return { ok: true };
  });

export const rollbackPackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ package_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: pkg } = await context.supabase
      .from("promotion_packages").select("id, status, source_tenant_id, target_tenant_id")
      .eq("id", data.package_id).single();
    if (!pkg) throw new Error("Not found");
    if ((pkg as any).status !== "promoted") throw new Error("Only promoted packages can be rolled back");
    await context.supabase.from("promotion_packages").update({
      status: "rolled_back", rolled_back_at: new Date().toISOString(),
    }).eq("id", data.package_id);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: (pkg as any).source_tenant_id,
      scope: "tenant", action: "promotion.rollback",
      resource_type: "promotion_package", resource_id: data.package_id,
      context: { target_tenant: (pkg as any).target_tenant_id },
    } as any);
    return { ok: true };
  });
