/**
 * "Why blocked?" — access decision explainer.
 *
 * Given a target action (fn_name, optional tenant, optional feature/resource),
 * evaluate every entitlement layer the app enforces and return a structured
 * decision tree the UI can render in a WhyBlockedPanel.
 *
 * Layers, in evaluation order:
 *   1. platform_grant   — is caller a platform_admin?
 *   2. tenant_scope     — is caller a member/tenant_admin of tenant_id?
 *   3. group_override   — group memberships that grant/deny in that tenant
 *   4. feature_dependency — feature_flags gate for feature_key (if given)
 *   5. recent_denies    — recent `rbac.denied` audit rows for this caller/fn
 *
 * Never leaks other users' data — all reads run through the caller's
 * RLS-bound supabase client.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type LayerStatus = "allow" | "deny" | "skipped" | "unknown";

export type AccessLayer = {
  key:
    | "platform_grant"
    | "tenant_scope"
    | "group_override"
    | "feature_dependency"
    | "recent_denies";
  label: string;
  status: LayerStatus;
  summary: string;
  detail: any;
};

export type AccessExplanation = {
  decision: "allow" | "deny" | "unknown";
  summary: string;
  fn_name: string;
  tenant_id: string | null;
  feature_key: string | null;
  layers: AccessLayer[];
  evaluated_at: string;
};

const Input = z.object({
  fn_name: z.string().min(1).max(120),
  tenant_id: z.string().uuid().nullable().optional(),
  feature_key: z.string().max(120).nullable().optional(),
  resource_type: z.string().max(80).nullable().optional(),
  resource_id: z.string().max(200).nullable().optional(),
});

async function safeRpc(
  supabase: any,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; value: unknown; error?: string }> {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return { ok: false, value: null, error: error.message };
    return { ok: true, value: data };
  } catch (e: any) {
    return { ok: false, value: null, error: String(e?.message ?? e) };
  }
}

export const explainAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }): Promise<AccessExplanation> => {
    const { supabase, userId } = context;
    const layers: AccessLayer[] = [];

    // ── 1. Platform grant ──────────────────────────────────────────────
    const plat = await safeRpc(supabase, "is_platform_admin", {
      _user_id: userId,
    });
    const isPlat = Boolean(plat.value);
    layers.push({
      key: "platform_grant",
      label: "Platform grant",
      status: plat.ok ? (isPlat ? "allow" : "deny") : "unknown",
      summary: isPlat
        ? "You hold platform_admin — bypasses tenant scope."
        : "No platform_admin role; decision falls through to tenant scope.",
      detail: { is_platform_admin: isPlat, error: plat.error ?? null },
    });

    // ── 2. Tenant scope ────────────────────────────────────────────────
    if (!data.tenant_id) {
      layers.push({
        key: "tenant_scope",
        label: "Tenant scope",
        status: "skipped",
        summary: "No tenant_id supplied — not a tenant-scoped action.",
        detail: {},
      });
    } else {
      const [member, tAdmin, tAnalyst, tViewer] = await Promise.all([
        safeRpc(supabase, "is_tenant_member", {
          _user_id: userId,
          _tenant_id: data.tenant_id,
        }),
        safeRpc(supabase, "has_tenant_role", {
          _user_id: userId,
          _tenant_id: data.tenant_id,
          _role: "tenant_admin",
        }),
        safeRpc(supabase, "has_tenant_role", {
          _user_id: userId,
          _tenant_id: data.tenant_id,
          _role: "tenant_analyst",
        }),
        safeRpc(supabase, "has_tenant_role", {
          _user_id: userId,
          _tenant_id: data.tenant_id,
          _role: "tenant_viewer",
        }),
      ]);
      const roles: string[] = [];
      if (tAdmin.value) roles.push("tenant_admin");
      if (tAnalyst.value) roles.push("tenant_analyst");
      if (tViewer.value) roles.push("tenant_viewer");
      const isMember = Boolean(member.value) || roles.length > 0;
      layers.push({
        key: "tenant_scope",
        label: "Tenant scope",
        status: isMember ? (roles.length ? "allow" : "unknown") : "deny",
        summary: isMember
          ? `You are a member of this tenant${roles.length ? ` with role(s): ${roles.join(", ")}` : ""}.`
          : "You are not a member of this tenant.",
        detail: {
          is_tenant_member: Boolean(member.value),
          roles,
          tenant_id: data.tenant_id,
        },
      });
    }

    // ── 3. Group override ──────────────────────────────────────────────
    if (data.tenant_id) {
      try {
        const { data: gRows } = await supabase
          .from("tenant_group_members")
          .select("group_id, tenant_groups!inner(id, name, tenant_id, preset_key)")
          .eq("user_id", userId)
          .eq("tenant_groups.tenant_id", data.tenant_id);
        const groups = (gRows ?? []).map((r: any) => ({
          id: r.tenant_groups?.id ?? r.group_id,
          name: r.tenant_groups?.name,
          preset_key: r.tenant_groups?.preset_key ?? null,
        }));
        layers.push({
          key: "group_override",
          label: "Group override",
          status: groups.length ? "allow" : "skipped",
          summary: groups.length
            ? `Member of ${groups.length} group(s) in this tenant.`
            : "Not a member of any tenant groups.",
          detail: { groups },
        });
      } catch (e: any) {
        layers.push({
          key: "group_override",
          label: "Group override",
          status: "unknown",
          summary: "Could not read group memberships.",
          detail: { error: String(e?.message ?? e) },
        });
      }
    } else {
      layers.push({
        key: "group_override",
        label: "Group override",
        status: "skipped",
        summary: "No tenant context — group overrides not evaluated.",
        detail: {},
      });
    }

    // ── 4. Feature dependency ──────────────────────────────────────────
    if (data.feature_key && data.tenant_id) {
      try {
        const { data: flag } = await (supabase as any)
          .from("feature_flags")
          .select("key, enabled, tenant_id, scope")
          .eq("tenant_id", data.tenant_id)
          .eq("key", data.feature_key)
          .maybeSingle();
        const enabled = flag ? Boolean((flag as any).enabled) : true;
        layers.push({
          key: "feature_dependency",
          label: "Feature dependency",
          status: enabled ? "allow" : "deny",
          summary: flag
            ? `feature_flag '${data.feature_key}' is ${enabled ? "enabled" : "disabled"} for this tenant.`
            : `No explicit flag for '${data.feature_key}'; treated as enabled by default.`,
          detail: { flag: flag ?? null, feature_key: data.feature_key },
        });
      } catch (e: any) {
        layers.push({
          key: "feature_dependency",
          label: "Feature dependency",
          status: "unknown",
          summary: "Could not read feature_flags.",
          detail: { error: String(e?.message ?? e) },
        });
      }
    } else {
      layers.push({
        key: "feature_dependency",
        label: "Feature dependency",
        status: "skipped",
        summary: data.feature_key
          ? "Tenant context required to evaluate feature flag."
          : "No feature_key supplied.",
        detail: {},
      });
    }

    // ── 5. Recent denies (audit_log rbac.denied) ───────────────────────
    try {
      let q = supabase
        .from("audit_log")
        .select("created_at, action, resource_type, resource_id, context, tenant_id")
        .eq("actor_user_id", userId)
        .eq("action", "rbac.denied")
        .order("created_at", { ascending: false })
        .limit(5);
      if (data.tenant_id) q = q.eq("tenant_id", data.tenant_id);
      const { data: rows } = await q;
      const matching = (rows ?? []).filter((r: any) =>
        String(r.resource_id ?? "").includes(data.fn_name) ||
        String((r.context as any)?.fn ?? "").includes(data.fn_name),
      );
      layers.push({
        key: "recent_denies",
        label: "Recent denies",
        status: matching.length ? "deny" : "skipped",
        summary: matching.length
          ? `${matching.length} recent rbac.denied event(s) for this action.`
          : "No recent rbac.denied events for this action.",
        detail: { events: matching.slice(0, 5), all_recent: rows ?? [] },
      });
    } catch (e: any) {
      layers.push({
        key: "recent_denies",
        label: "Recent denies",
        status: "unknown",
        summary: "Could not read audit_log.",
        detail: { error: String(e?.message ?? e) },
      });
    }

    // ── Aggregate decision ─────────────────────────────────────────────
    // Precedence:
    //   platform_grant=allow  → allow
    //   tenant_scope=deny     → deny
    //   feature_dependency=deny → deny
    //   otherwise use tenant_scope status
    const l = Object.fromEntries(layers.map((x) => [x.key, x.status])) as Record<
      AccessLayer["key"],
      LayerStatus
    >;
    let decision: AccessExplanation["decision"] = "unknown";
    let summary = "";
    if (l.platform_grant === "allow") {
      decision = "allow";
      summary = "Allowed via platform_admin grant.";
    } else if (l.tenant_scope === "deny") {
      decision = "deny";
      summary = "Denied: not a member of the target tenant.";
    } else if (l.feature_dependency === "deny") {
      decision = "deny";
      summary = "Denied: required feature flag is disabled for this tenant.";
    } else if (l.tenant_scope === "allow") {
      decision = "allow";
      summary = "Allowed via tenant membership/role.";
    } else if (l.tenant_scope === "skipped" && l.platform_grant === "deny") {
      decision = "deny";
      summary = "Denied: no platform_admin and no tenant context.";
    }

    return {
      decision,
      summary,
      fn_name: data.fn_name,
      tenant_id: data.tenant_id ?? null,
      feature_key: data.feature_key ?? null,
      layers,
      evaluated_at: new Date().toISOString(),
    };
  });
