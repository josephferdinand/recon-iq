import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import { z } from "zod";

const uuid = z.string().uuid();
const reason = z.string().trim().min(1).max(2000);
export const governanceMembershipStatusSchema = z.enum(["pending", "approved", "rejected", "withdrawn"]);
export const governanceMembershipEnvironmentSchema = z.enum(["prod", "dev", "sandbox", "uat"]);
export const governanceMembershipListSchema = z.object({
  tenant_id: uuid,
  page: z.number().int().min(1).max(100000).default(1),
  page_size: z.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(200).default(""),
  own_only: z.boolean().default(false),
  status: governanceMembershipStatusSchema.nullish(),
  bu_id: uuid.nullish(),
  environment: governanceMembershipEnvironmentSchema.nullish(),
}).strict();
export const governanceMembershipDetailSchema = z.object({ tenant_id: uuid, request_id: uuid }).strict();
export const governanceMembershipSubmitSchema = z.object({
  tenant_id: uuid, bu_id: uuid, workspace_id: uuid, group_id: uuid,
  environment: governanceMembershipEnvironmentSchema, reason, request_key: uuid,
}).strict();
export const governanceMembershipWithdrawSchema = z.object({
  tenant_id: uuid, request_id: uuid, expected_version: z.number().int().positive(), reason, request_key: uuid,
}).strict();
export const governanceMembershipDecisionSchema = governanceMembershipWithdrawSchema.extend({ decision: z.enum(["approve", "reject"]) });
export const governanceMembershipOptionsSchema = z.object({
  tenant_id: uuid, kind: z.enum(["bu", "workspace", "group", "environment"]),
  page: z.number().int().min(1).max(100000).default(1), page_size: z.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(200).default(""), bu_id: uuid.nullish(), workspace_id: uuid.nullish(),
  environment: governanceMembershipEnvironmentSchema.nullish(),
}).strict().superRefine((input, context) => {
  if ((input.kind === "workspace" || input.kind === "group") && !input.bu_id) context.addIssue({ code: "custom", path: ["bu_id"], message: "Select a business unit" });
  if (input.kind === "group" && !input.workspace_id) context.addIssue({ code: "custom", message: "Select a workspace" });
});

export type GovernanceMembershipStatus = z.infer<typeof governanceMembershipStatusSchema>;
export type GovernanceMembershipEnvironment = z.infer<typeof governanceMembershipEnvironmentSchema>;
export type GovernanceMembershipListInput = z.input<typeof governanceMembershipListSchema>;
export type GovernanceMembershipSubmitInput = z.infer<typeof governanceMembershipSubmitSchema>;
export type GovernanceMembershipDecisionInput = z.infer<typeof governanceMembershipDecisionSchema>;
export type GovernanceMembershipScope = {
  scope_label: string;
  requested_rights: string[];
  group: Record<string, Json>;
  workspace: Record<string, Json>;
  environment: string;
  roles: Array<Record<string, Json>>;
  bu_assignments: Array<Record<string, Json>>;
  reconciliation_grants: Array<Record<string, Json>>;
  data_resource_grants: Array<Record<string, Json>>;
  legacy_reconciliation_grants: Array<Record<string, Json>>;
  legacy_data_resource_grants: Array<Record<string, Json>>;
};
export type GovernanceMembershipRequest = {
  id: string; tenant_id: string; requested_by: string; requester_name: string | null; requested_at: string;
  team_name: string | null; bu_id: string; bu_name: string | null; workspace_id: string; workspace_name: string | null;
  environment: GovernanceMembershipEnvironment; group_id: string; group_name: string | null; requested_rights: string[];
  approved_by: string | null; approver_name: string | null; decided_at: string | null; status: GovernanceMembershipStatus;
  version: number; correlation_id: string; request_reason: string; decision_reason: string | null;
  scope_snapshot: GovernanceMembershipScope; can_decide?: boolean; can_withdraw?: boolean;
};
export type GovernanceMembershipKPIs = {
  awaiting_decision: number; approved_last_7_days: number; independent_checker_needed: number; rejected_or_withdrawn: number;
};
export type GovernanceMembershipList = {
  rows: GovernanceMembershipRequest[]; total: number; page: number; page_size: number; kpis: GovernanceMembershipKPIs;
  permissions: { can_submit: boolean; can_review_queue: boolean };
};
export type GovernanceMembershipDetail = GovernanceMembershipRequest & {
  scope_label: string; effective_scope: GovernanceMembershipScope; membership_active: boolean;
  history: Array<{ id: number | string; tenant_id: string; request_id: string; actor_user_id: string; action: string;
    occurred_at: string; version: number; reason: string; outcome: string; correlation_id: string; audit_id: number | string }>;
  permissions: { can_approve: boolean; can_reject: boolean; can_withdraw: boolean };
};
export type GovernanceMembershipMutation = {
  id: string; status: GovernanceMembershipStatus; version: number; correlation_id: string; audit_id: string;
  outcome: "pending" | "grant_confirmed" | "no_access_granted";
};
type MembershipContext = { userId: string; supabase: { rpc: (name: never, args: never) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> } };

// Only the middleware's ordinary caller client is used. Acting identity is derived by auth.uid() in SQL.
async function rpc<T>(context: MembershipContext, name: string, args: Record<string, unknown>): Promise<T> {
  if (!context.userId) throw new Error("Authenticated caller required");
  const { data, error } = await context.supabase.rpc(name as never, args as never);
  if (error) {
    const failure = new Error(error.message) as Error & { code?: string };
    failure.code = error.code;
    throw failure;
  }
  if (data == null) throw new Error("Membership operation returned no authoritative result");
  return data as T;
}
export const listGovernanceMembershipRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => governanceMembershipListSchema.parse(input))
  .handler(({ data, context }) => rpc<GovernanceMembershipList>(context, "list_governance_membership_requests", {
    _tenant_id: data.tenant_id, _page: data.page, _page_size: data.page_size, _search: data.search,
    _status: data.status ?? null, _bu_id: data.bu_id ?? null, _environment: data.environment ?? null,
    _own_only: data.own_only,
  }));
export const getGovernanceMembershipRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => governanceMembershipDetailSchema.parse(input))
  .handler(({ data, context }) => rpc<GovernanceMembershipDetail>(context, "get_governance_membership_request", {
    _tenant_id: data.tenant_id, _request_id: data.request_id,
  }));
export const submitGovernanceMembershipRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => governanceMembershipSubmitSchema.parse(input))
  .handler(({ data, context }) => rpc<GovernanceMembershipMutation>(context, "submit_governance_membership_request", {
    _tenant_id: data.tenant_id, _bu_id: data.bu_id, _workspace_id: data.workspace_id, _group_id: data.group_id,
    _environment: data.environment, _reason: data.reason, _request_key: data.request_key,
  }));
export const decideGovernanceMembershipRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => governanceMembershipDecisionSchema.parse(input))
  .handler(({ data, context }) => rpc<GovernanceMembershipMutation>(context, "decide_governance_membership_request", {
    _tenant_id: data.tenant_id, _request_id: data.request_id, _expected_version: data.expected_version,
    _decision: data.decision, _reason: data.reason, _request_key: data.request_key,
  }));
export const withdrawGovernanceMembershipRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => governanceMembershipWithdrawSchema.parse(input))
  .handler(({ data, context }) => rpc<GovernanceMembershipMutation>(context, "withdraw_governance_membership_request", {
    _tenant_id: data.tenant_id, _request_id: data.request_id, _expected_version: data.expected_version,
    _reason: data.reason, _request_key: data.request_key,
  }));

export type GovernanceMembershipOptions = {
  rows: Array<{ id: string; label: string; description?: string; bu_id?: string; workspace_id?: string; environment?: GovernanceMembershipEnvironment; selectable?: boolean; requested_rights?: string[]; scope_label?: string; effective_scope?: GovernanceMembershipScope }>;
  total: number; page: number; page_size: number; has_more: boolean;
};
export const listGovernanceMembershipOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => governanceMembershipOptionsSchema.parse(input))
  .handler(({ data, context }) => rpc<GovernanceMembershipOptions>(context, "list_governance_membership_options", {
    _tenant_id: data.tenant_id, _kind: data.kind, _page: data.page, _page_size: data.page_size, _search: data.search,
    _bu_id: data.bu_id ?? null, _workspace_id: data.workspace_id ?? null, _environment: data.environment ?? null,
  }));
