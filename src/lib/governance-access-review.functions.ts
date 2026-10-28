import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { z } from "zod";

const uuid = z.string().uuid();
const tenant = z.object({ tenant_id: uuid }).strict();
export const GovernanceAccessReviewListInput = tenant.extend({
  page: z.number().int().min(1).max(100000).default(1),
  page_size: z.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(160).default(""),
  campaign_id: uuid.nullish(),
  outcome: z.enum(["pending", "retained", "change_requested", "revoked", "historical_unknown"]).nullish(),
  reviewer_id: uuid.nullish(),
});
export const GovernanceAccessReviewDetailInput = tenant.extend({ id: uuid });
export const GovernanceAccessReviewOptionsInput = tenant.extend({
  kind: z.enum(["business_units", "groups", "workspaces", "members", "reviewers"]),
  page: z.number().int().min(1).max(100000).default(1),
  page_size: z.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(160).default(""),
  bu_id: uuid.nullish(), group_id: uuid.nullish(), workspace_id: uuid.nullish(), subject_user_id: uuid.nullish(),
});
export const GovernanceAccessReviewCampaignInput = tenant.extend({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).nullable().optional(),
  due_at: z.string().datetime({ offset: true }),
  request_key: uuid,
  memberships: z.array(z.object({
    subject_user_id: uuid, group_id: uuid, reviewer_id: uuid,
    workspace_id: uuid.nullish(),
    snapshot_hash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  }).strict()).min(1).max(200).superRefine((rows, ctx) => {
    const keys = new Set<string>();
    rows.forEach((row, index) => {
      const key = `${row.subject_user_id}/${row.group_id}`;
      if (keys.has(key)) ctx.addIssue({ code: "custom", path: [index], message: "Duplicate membership" });
      keys.add(key);
    });
  }),
});
export const GovernanceAccessReviewDecisionInput = tenant.extend({
  id: uuid,
  expected_version: z.number().int().min(1),
  snapshot_hash: z.string().regex(/^[a-f0-9]{64}$/),
  decision: z.enum(["retain", "request_change", "revoke"]),
  reason: z.string().trim().min(1).max(2000),
  request_key: uuid,
});

export interface GovernanceAccessReviewRow {
  id: string; campaign_id: string; campaign_name: string; subject_user_id: string;
  member_name: string | null; team_name: string | null; bu_name: string | null;
  workspace_name: string | null; environment: string | null; group_name: string | null;
  current_rights: string[]; reviewer_id: string | null; reviewer_name: string | null;
  due_at: string | null; outcome: "pending" | "retained" | "change_requested" | "revoked" | "historical_unknown";
  decided_at: string | null; version: number; snapshot_hash: string | null;
  requested_by: string | null; requested_at: string; approved_by: string | null;
  group_id: string | null; bu_id: string | null; workspace_id: string | null;
  reason: string | null; correlation_id: string | null;
  effective_scope: { workspace_context_only: boolean; group_membership_scope: string; resource_grants: Json[] };
  historical: boolean;
}
export interface GovernanceAccessReviewPage {
  rows: GovernanceAccessReviewRow[]; total: number; page: number; page_size: number;
  kpis: { open_campaigns: number; memberships_to_review: number; overdue_decisions: number; completed_last_30_days: number };
  permissions: { can_create_campaign: boolean; can_decide: boolean };
}
export interface GovernanceAccessReviewDetail extends GovernanceAccessReviewRow {
  history: Json[]; snapshot_current: boolean;
  permitted_actions: ("retain" | "request_change" | "revoke")[];
}
export interface GovernanceAccessReviewOption {
  id: string; label: string | null; group_id: string | null;
  subject_user_id?: string; member_name?: string | null; team_name?: string | null;
  group_name?: string | null; bu_name?: string | null; workspace_id?: string | null;
  workspace_name?: string | null; environment?: string | null; current_rights?: string[];
  snapshot_hash?: string; version?: number; effective_scope?: GovernanceAccessReviewRow["effective_scope"];
}

// Only caller-authenticated RPCs. No actor, service-role client or client authority.
// RPC casts bridge the generated schema until Primary regenerates it after migration.
async function call<T>(client: unknown, name: string, input: unknown): Promise<T> {
  const rpc = client as { rpc: (name: string, args: { _input: unknown }) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> };
  const result = await rpc.rpc(name, { _input: input });
  if (result.error) throw new Error(result.error.message);
  if (result.data == null) throw new Error("Access-review RPC returned no result");
  return result.data as T;
}

type LabelRow = { id: string; full_name: string | null };
// Person labels use exactly the caller's existing profiles RLS. Never load email,
// private-profile fields or a service-role client. An unreadable label stays null.
async function labels(client: unknown, ids: string[]): Promise<Map<string, string | null>> {
  if (!ids.length) return new Map();
  const scoped = client as { from: (table: "profiles") => { select: (columns: "id,full_name") => { in: (column: "id", values: string[]) => PromiseLike<{ data: LabelRow[] | null; error: { message: string } | null }> } } };
  const result = await scoped.from("profiles").select("id,full_name").in("id", [...new Set(ids)]);
  if (result.error) throw new Error(result.error.message);
  return new Map((result.data ?? []).map(row => [row.id, row.full_name]));
}
async function labelReviews<T extends GovernanceAccessReviewRow>(client: unknown, rows: T[]): Promise<T[]> {
  const names = await labels(client, rows.flatMap(row => [row.subject_user_id, ...(row.reviewer_id ? [row.reviewer_id] : [])]));
  return rows.map(row => ({ ...row, member_name: names.get(row.subject_user_id) ?? null, reviewer_name: row.reviewer_id ? names.get(row.reviewer_id) ?? null : null }));
}

export const listGovernanceAccessReviews = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => GovernanceAccessReviewListInput.parse(input))
  .handler(async ({ data, context }) => {
    const result = await call<GovernanceAccessReviewPage>(context.supabase, "governance_access_review_list", data);
    return { ...result, rows: await labelReviews(context.supabase, result.rows) };
  });

export const getGovernanceAccessReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => GovernanceAccessReviewDetailInput.parse(input))
  .handler(async ({ data, context }) => {
    const result = await call<GovernanceAccessReviewDetail>(context.supabase, "governance_access_review_get", data);
    return (await labelReviews(context.supabase, [result]))[0];
  });

export const listGovernanceAccessReviewOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => GovernanceAccessReviewOptionsInput.parse(input))
  .handler(async ({ data, context }) => {
    const result = await call<{ rows: GovernanceAccessReviewOption[]; total: number; page: number; page_size: number }>(context.supabase, "governance_access_review_options", data);
    return result;
  });

export const createGovernanceAccessReviewCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => GovernanceAccessReviewCampaignInput.parse(input))
  .handler(({ data, context }) => call<{ campaign_id: string; item_ids: string[]; correlation_id: string }>(context.supabase, "governance_access_review_campaign_create", data));

export const decideGovernanceAccessReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => GovernanceAccessReviewDecisionInput.parse(input))
  .handler(({ data, context }) => call<GovernanceAccessReviewDetail & { membership_revoked: boolean }>(context.supabase, "governance_access_review_decide", data));
