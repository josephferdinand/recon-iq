// Per-action agent autonomy policy. Maps an action_key (e.g. "auto_resolve_break")
// to a ceiling (suggest|assist|auto), required_approvers, and whether the
// action is reversible. Tenant admins set per-tenant overrides; defaults
// come from rows with tenant_id IS NULL (seeded below).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const AGENT_ACTIONS = [
  { key: "suggest_match", label: "Suggest match", defaultCeiling: "suggest", defaultApprovers: 0, reversible: true },
  { key: "auto_resolve_low_risk_break", label: "Auto-resolve low-risk break", defaultCeiling: "assist", defaultApprovers: 1, reversible: true },
  { key: "modify_recon_rule", label: "Modify reconciliation rule", defaultCeiling: "auto", defaultApprovers: 2, reversible: true },
  { key: "issue_payment_correction", label: "Issue payment correction", defaultCeiling: "suggest", defaultApprovers: 0, reversible: false },
  { key: "rerun_reconciliation", label: "Re-run reconciliation", defaultCeiling: "assist", defaultApprovers: 1, reversible: true },
  { key: "change_tenant_settings", label: "Change tenant settings", defaultCeiling: "suggest", defaultApprovers: 0, reversible: false },
] as const;

export const listAgentPolicies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenantId: string }) => z.object({ tenantId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase
      .from("agent_action_policies").select("*").eq("tenant_id", data.tenantId);
    const map = new Map<string, any>();
    for (const r of rows ?? []) map.set((r as { action_key: string }).action_key, r);
    return AGENT_ACTIONS.map((a) => {
      const r = map.get(a.key);
      return {
        action_key: a.key,
        label: a.label,
        ceiling: r?.ceiling ?? a.defaultCeiling,
        required_approvers: r?.required_approvers ?? a.defaultApprovers,
        reversible: r?.reversible ?? a.reversible,
        is_override: !!r,
      };
    });
  });

export const setAgentPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: {
    tenantId: string; actionKey: string; ceiling: "suggest" | "assist" | "auto";
    requiredApprovers: number; reversible: boolean;
  }) => z.object({
    tenantId: z.string().uuid(),
    actionKey: z.string().min(1),
    ceiling: z.enum(["suggest", "assist", "auto"]),
    requiredApprovers: z.number().int().min(0).max(5),
    reversible: z.boolean(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_tenant_role", {
      _user_id: context.userId, _tenant_id: data.tenantId, _role: "tenant_admin",
    });
    if (!isAdmin) throw new Response("Forbidden: tenant_admin required to edit agent policies", { status: 403 });
    const { error } = await context.supabase.from("agent_action_policies").upsert({
      tenant_id: data.tenantId,
      action_key: data.actionKey,
      ceiling: data.ceiling,
      required_approvers: data.requiredApprovers,
      reversible: data.reversible,
      updated_by: context.userId,
      updated_at: new Date().toISOString(),
    } as never, { onConflict: "tenant_id,action_key" });
    if (error) throw new Response(error.message, { status: 500 });
    return { ok: true };
  });

// ──────────────────────────────────────────────────────────────────────────────
// Versioning: list history and roll back to a previous revision
// ──────────────────────────────────────────────────────────────────────────────

export const listAgentPolicyVersions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenantId: string; actionKey: string }) => z.object({
    tenantId: z.string().uuid(),
    actionKey: z.string().min(1),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("agent_action_policy_versions")
      .select("id, revision, ceiling, required_approvers, reversible, change_reason, changed_by, created_at")
      .eq("tenant_id", data.tenantId)
      .eq("action_key", data.actionKey)
      .order("revision", { ascending: false });
    if (error) throw new Response(error.message, { status: 500 });
    return rows ?? [];
  });

export const rollbackAgentPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenantId: string; actionKey: string; revision: number; reason?: string }) => z.object({
    tenantId: z.string().uuid(),
    actionKey: z.string().min(1),
    revision: z.number().int().min(1),
    reason: z.string().max(500).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_tenant_role", {
      _user_id: context.userId, _tenant_id: data.tenantId, _role: "tenant_admin",
    });
    if (!isAdmin) throw new Response("Forbidden", { status: 403 });

    const { data: snap, error: sErr } = await context.supabase
      .from("agent_action_policy_versions")
      .select("ceiling, required_approvers, reversible")
      .eq("tenant_id", data.tenantId)
      .eq("action_key", data.actionKey)
      .eq("revision", data.revision)
      .single();
    if (sErr || !snap) throw new Response("Revision not found", { status: 404 });

    const { error: uErr } = await context.supabase.from("agent_action_policies").upsert({
      tenant_id: data.tenantId,
      action_key: data.actionKey,
      ceiling: (snap as any).ceiling,
      required_approvers: (snap as any).required_approvers,
      reversible: (snap as any).reversible,
      updated_by: context.userId,
      updated_at: new Date().toISOString(),
    } as never, { onConflict: "tenant_id,action_key" });
    if (uErr) throw new Response(uErr.message, { status: 500 });

    // Annotate the freshly-created version with a rollback reason
    await context.supabase.from("agent_action_policy_versions")
      .update({ change_reason: `Rollback to revision ${data.revision}${data.reason ? `: ${data.reason}` : ""}` } as any)
      .eq("tenant_id", data.tenantId)
      .eq("action_key", data.actionKey)
      .order("revision", { ascending: false })
      .limit(1);

    await context.supabase.from("audit_log").insert({
      tenant_id: data.tenantId, scope: "tenant", action: "agent.policy.rollback",
      resource_type: "agent_action_policy", resource_id: data.actionKey,
      context: { revision: data.revision, reason: data.reason ?? null } as any,
    } as any);

    return { ok: true };
  });

