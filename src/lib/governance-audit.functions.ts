import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const uuid = z.string().uuid();
const outcomes = ["success", "denied", "failed", "pending"] as const;
const recordedOutcomes = {
  success: ["success", "grant_confirmed", "retained", "revoked"],
  denied: ["denied"], failed: ["failed"], pending: ["pending", "change_requested"],
};
const allowedOutcomes = [...Object.values(recordedOutcomes).flat(), "no_access_granted"];
export const GOVERNANCE_AUDIT_ACTIONS = [
  "governance.membership.request", "governance.membership.approve", "governance.membership.reject", "governance.membership.withdraw",
  "governance.access_review.campaign.create", "governance.access_review.retain", "governance.access_review.change_requested", "governance.access_review.revoke",
] as const;
export const governanceAuditListSchema = z.object({
  tenant_id: uuid,
  page: z.number().int().min(1).max(10000).default(1),
  page_size: z.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).max(120).regex(/^[\p{L}\p{N}_.: -]+$/u).optional(),
  action: z.enum(GOVERNANCE_AUDIT_ACTIONS).optional(),
  actor_id: uuid.optional(), // Filter only; never the requesting actor.
  resource_type: z.string().regex(/^[a-zA-Z0-9_.:-]+$/u).max(80).optional(),
  outcome: z.enum(outcomes).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
}).strict().refine(d => !d.from || !d.to || Date.parse(d.from) <= Date.parse(d.to), "Invalid date window");
export const governanceAuditEventSchema = z.object({
  tenant_id: uuid, event_id: z.string().regex(/^[1-9][0-9]{0,18}$/u),
}).strict();
type ListInput = z.infer<typeof governanceAuditListSchema>;
type Context = { userId: string; supabase: any };
type AuditRow = {
  id: number | string; tenant_id: string; actor_user_id: string | null;
  occurred_at: string; scope: string; action: string;
  resource_type: string | null; resource_id: string | null; context: unknown;
};
const fields = "id,tenant_id,actor_user_id,occurred_at,scope,action,resource_type,resource_id,context";
const unavailable = () => new Error("Governance audit is temporarily unavailable. Please try again.");

async function authorize(context: Context, tenantId: string) {
  if (!context.userId) throw new Error("Forbidden: tenant audit access required.");
  const membership = await context.supabase.from("tenant_members").select("user_id")
    .eq("tenant_id", tenantId).eq("user_id", context.userId)
    .eq("active", true).eq("role", "tenant_admin").maybeSingle();
  if (membership.error) throw unavailable();
  if (!membership.data) throw new Error("Forbidden: active tenant administrator required.");
  const permission = await context.supabase.rpc("user_has_permission", {
    _user_id: context.userId, _tenant_id: tenantId, _permission_id: "audit.log.read", _bu_id: null,
  });
  if (permission.error) throw unavailable();
  if (permission.data !== true) throw new Error("Forbidden: audit read permission required.");
}

// Scalars only: no recursive context, credential objects, URLs or free-form arrays.
export function safeGovernanceAuditText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length > 500 || /https?:|\b(?:bearer|password|secret|credential|token|otp|authorization|private.key)\b|eyJ[A-Za-z0-9_-]+\.|\b[0-9]{6}\b|[A-Za-z0-9+/=_-]{48,}/iu.test(value)) return "[redacted]";
  return value.replace(/[\u0000-\u001f\u007f]/gu, " ");
}
export function projectGovernanceAuditEvent(row: AuditRow, labels: Map<string, string> = new Map()) {
  if (typeof row.id === "number" && !Number.isSafeInteger(row.id)) throw unavailable();
  const context = row.context && typeof row.context === "object" && !Array.isArray(row.context)
    ? row.context as Record<string, unknown> : {};
  const outcome = allowedOutcomes.includes(String(context.outcome)) ? String(context.outcome) : "unknown";
  const version = typeof context.version === "number" && Number.isSafeInteger(context.version) && context.version >= 0
    ? context.version : null;
  const reference = (key: string) => uuid.safeParse(context[key]).success ? context[key] as string : null;
  return {
    id: String(row.id), occurred_at: row.occurred_at, scope: row.scope, action: row.action,
    actor_user_id: row.actor_user_id,
    actor_name: row.actor_user_id ? labels.get(row.actor_user_id) ?? null : null,
    actor_role: safeGovernanceAuditText(context.actor_role), team_name: safeGovernanceAuditText(context.team_name),
    scope_label: safeGovernanceAuditText(context.scope_label) ?? (["tenant", "workspace", "platform", "api", "system"].includes(row.scope) ? row.scope : "unknown"),
    environment: typeof context.environment === "string" && ["prod", "dev", "sandbox", "uat", "development", "staging", "production"].includes(context.environment) ? context.environment : null,
    resource_type: safeGovernanceAuditText(row.resource_type), resource_id: safeGovernanceAuditText(row.resource_id),
    outcome, reason: safeGovernanceAuditText(context.reason), version,
    correlation_id: reference("correlation_id"), request_id: reference("request_id"), review_id: reference("review_id"),
    // References are provenance only; the destination purpose handler must authorize its target.
  };
}

async function searchPredicate(context: Context, data: ListInput): Promise<string | null> {
  if (!data.search) return null;
  // Values cannot contain PostgREST filter grammar, quotes or wildcard characters.
  const parts = [`action.ilike.*${data.search}*`];
  const id = uuid.safeParse(data.search);
  if (id.success) {
    const value = id.data.toLowerCase();
    parts.push(`actor_user_id.eq.${value}`, `context->>request_id.eq.${value}`,
      `context->>review_id.eq.${value}`, `context->>correlation_id.eq.${value}`);
  } else if (/^[1-9][0-9]{0,18}$/u.test(data.search) && BigInt(data.search) <= 9223372036854775807n) {
    parts.push(`id.eq.${data.search}`);
  } else {
    // Labels are searchable only when the caller's ordinary profiles RLS exposes them.
    const profiles = await context.supabase.from("profiles").select("id")
      .ilike("full_name", `%${data.search}%`).limit(101);
    if (profiles.error) throw unavailable();
    if ((profiles.data ?? []).length > 100) throw new Error("Actor search is too broad. Enter a more specific name or identity ID.");
    const ids = [...new Set<string>((profiles.data ?? []).map((p: { id: string }) => p.id))].filter(value => uuid.safeParse(value).success);
    if (ids.length) {
      const members = await context.supabase.from("tenant_members").select("user_id")
        .eq("tenant_id", data.tenant_id).in("user_id", ids);
      if (members.error) throw unavailable();
      const allowed = [...new Set<string>((members.data ?? []).map((m: { user_id: string }) => m.user_id))]
        .filter(value => ids.includes(value) && uuid.safeParse(value).success);
      if (allowed.length) parts.push(`actor_user_id.in.(${allowed.join(",")})`);
    }
  }
  return parts.join(",");
}

function filteredQuery(context: Context, data: ListInput, head = false, search: string | null = null, actions?: readonly string[]) {
  let query = context.supabase.from("audit_log").select(head ? "id" : fields, { count: "exact", head })
    .eq("tenant_id", data.tenant_id).in("action", GOVERNANCE_AUDIT_ACTIONS);
  if (search) query = query.or(search);
  if (actions) query = query.in("action", actions);
  if (data.action) query = query.eq("action", data.action);
  if (data.actor_id) query = query.eq("actor_user_id", data.actor_id);
  if (data.resource_type) query = query.eq("resource_type", data.resource_type);
  if (data.outcome) query = query.in("context->>outcome", recordedOutcomes[data.outcome]);
  if (data.from) query = query.gte("occurred_at", data.from);
  if (data.to) query = query.lte("occurred_at", data.to);
  return query;
}

async function actorLabels(context: Context, tenantId: string, rows: AuditRow[]) {
  const ids = [...new Set(rows.map(r => r.actor_user_id).filter((id): id is string => !!id))];
  const labels = new Map<string, string>();
  if (!ids.length) return labels;
  const members = await context.supabase.from("tenant_members").select("user_id")
    .eq("tenant_id", tenantId).in("user_id", ids);
  if (members.error) throw unavailable();
  const allowed = [...new Set<string>((members.data ?? []).map((r: { user_id: string }) => r.user_id))];
  if (!allowed.length) return labels;
  const profiles = await context.supabase.from("profiles").select("id,full_name").in("id", allowed);
  if (profiles.error) throw unavailable();
  for (const profile of profiles.data ?? []) {
    const name = safeGovernanceAuditText(profile.full_name);
    if (name && name !== "[redacted]" && allowed.includes(profile.id)) labels.set(profile.id, name);
  }
  return labels;
}

export async function listGovernanceAuditTrailHandler({ data: raw, context }: { data: unknown; context: Context }) {
  const data = governanceAuditListSchema.parse(raw);
  await authorize(context, data.tenant_id);
  const search = await searchPredicate(context, data);
  const page = await filteredQuery(context, data, false, search).order("occurred_at", { ascending: false })
    .order("id", { ascending: false }).range((data.page - 1) * data.page_size, data.page * data.page_size - 1);
  if (page.error || !Number.isSafeInteger(page.count) || page.count < 0) throw unavailable();
  const rows = (page.data ?? []) as AuditRow[];
  if (rows.some(r => r.tenant_id !== data.tenant_id)) throw unavailable();
  const counts = await Promise.all(outcomes.map(outcome => filteredQuery(context, { ...data, outcome }, true, search)));
  if (counts.some(r => r.error || !Number.isSafeInteger(r.count) || r.count < 0)) throw unavailable();
  // If filtering by one outcome, KPIs must describe the same filtered population.
  const kpis = Object.fromEntries(outcomes.map((outcome, i) => [outcome, data.outcome && data.outcome !== outcome ? 0 : counts[i].count])) as Record<typeof outcomes[number], number>;
  const classified = Object.values(kpis).reduce((sum: number, n) => sum + Number(n), 0);
  const decisions = await Promise.all([
    filteredQuery(context, data, true, search, ["governance.membership.approve", "governance.membership.reject", "governance.membership.withdraw"]),
    filteredQuery(context, data, true, search, ["governance.access_review.retain", "governance.access_review.change_requested", "governance.access_review.revoke"]),
  ]);
  if (decisions.some(r => r.error || !Number.isSafeInteger(r.count) || r.count < 0)) throw unavailable();
  const labels = await actorLabels(context, data.tenant_id, rows);
  const exportPermission = await context.supabase.rpc("user_has_permission", {
    _user_id: context.userId, _tenant_id: data.tenant_id, _permission_id: "audit.log.export", _bu_id: null,
  });
  if (exportPermission.error) throw unavailable();
  await authorize(context, data.tenant_id);
  return {
    rows: rows.map(row => projectGovernanceAuditEvent(row, labels)), total: page.count,
    page: data.page, page_size: data.page_size, has_more: data.page * data.page_size < page.count,
    kpis: { total: page.count, ...kpis, unknown: classified <= page.count ? page.count - classified : null,
      membership_decisions: decisions[0].count as number, access_review_decisions: decisions[1].count as number },
    metrics_consistency: classified <= page.count ? "independent_reads" as const : "changed_during_read" as const,
    permissions: { read: true, export: exportPermission.data === true },
  };
}

export async function getGovernanceAuditEventHandler({ data: raw, context }: { data: unknown; context: Context }) {
  const data = governanceAuditEventSchema.parse(raw);
  await authorize(context, data.tenant_id);
  const result = await context.supabase.from("audit_log").select(fields)
    .eq("tenant_id", data.tenant_id).in("action", GOVERNANCE_AUDIT_ACTIONS).eq("id", data.event_id).maybeSingle();
  if (result.error) throw unavailable();
  if (!result.data) return null;
  if (result.data.tenant_id !== data.tenant_id) throw unavailable();
  const labels = await actorLabels(context, data.tenant_id, [result.data]);
  await authorize(context, data.tenant_id);
  return projectGovernanceAuditEvent(result.data, labels);
}

export const listGovernanceAuditTrail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()]).validator((data: unknown) => governanceAuditListSchema.parse(data))
  .handler(listGovernanceAuditTrailHandler);
export const getGovernanceAuditEvent = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()]).validator((data: unknown) => governanceAuditEventSchema.parse(data))
  .handler(getGovernanceAuditEventHandler);
