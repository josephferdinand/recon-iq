// @vitest-environment jsdom
import { GovernanceEffectiveScope } from "@/components/governance-review-detail";
import React from "react";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const api = vi.hoisted(() => ({
  membershipList: vi.fn(),
  membershipDetail: vi.fn(),
  membershipOptions: vi.fn(),
  submit: vi.fn(),
  withdraw: vi.fn(),
  approve: vi.fn(),
  reviewList: vi.fn(),
  reviewDetail: vi.fn(),
  reviewOptions: vi.fn(),
  create: vi.fn(),
  decide: vi.fn(),
  auditList: vi.fn(),
  auditDetail: vi.fn(),
}));
vi.mock("@tanstack/react-start", () => ({ useServerFn: (fn: unknown) => fn }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/governance-membership.functions", () => ({
  listGovernanceMembershipRequests: api.membershipList,
  getGovernanceMembershipRequest: api.membershipDetail,
  listGovernanceMembershipOptions: api.membershipOptions,
  submitGovernanceMembershipRequest: api.submit,
  withdrawGovernanceMembershipRequest: api.withdraw,
  decideGovernanceMembershipRequest: api.approve,
}));
vi.mock("@/lib/governance-access-review.functions", () => ({
  listGovernanceAccessReviews: api.reviewList,
  getGovernanceAccessReview: api.reviewDetail,
  listGovernanceAccessReviewOptions: api.reviewOptions,
  createGovernanceAccessReviewCampaign: api.create,
  decideGovernanceAccessReview: api.decide,
}));
vi.mock("@/lib/governance-audit.functions", () => ({
  listGovernanceAuditTrail: api.auditList,
  getGovernanceAuditEvent: api.auditDetail,
  GOVERNANCE_AUDIT_ACTIONS: [
    "governance.membership.request",
    "governance.membership.approve",
    "governance.access_review.retain",
    "governance.access_review.revoke",
  ],
}));

import {
  GovernanceApprovalQueue,
  GovernanceApplicationEnvironmentProvider,
} from "@/components/governance-approval-queue";
import {
  clearGovernanceIntentKey,
  formatGovernanceTime,
  getGovernanceIntentKey,
} from "@/components/governance-review-detail";
import {
  GovernanceMembershipApprovals,
  GovernanceMembershipRequests,
} from "@/components/governance-membership-approvals";
import { GovernanceAccessReviews } from "@/components/governance-access-reviews";
import { GovernanceAuditTrail } from "@/components/governance-audit-trail";

const tenant = "10000000-0000-4000-8000-000000000001";
const bu = "20000000-0000-4000-8000-000000000001";
const workspace = "30000000-0000-4000-8000-000000000001";
const group = "40000000-0000-4000-8000-000000000001";
const subject = "50000000-0000-4000-8000-000000000001";
const reviewer = "60000000-0000-4000-8000-000000000001";
const requestId = "70000000-0000-4000-8000-000000000001";
const hash = "a".repeat(64);
const scope = {
  scope_label: "Tenant group membership; existing group rights can apply across workspaces",
  requested_rights: ["recon.definition.read"],
  group: {},
  workspace: {},
  environment: "prod",
  roles: [],
  bu_assignments: [],
  reconciliation_grants: [],
  data_resource_grants: [],
  legacy_reconciliation_grants: [],
  legacy_data_resource_grants: [],
};
const request = {
  id: requestId,
  tenant_id: tenant,
  requested_by: subject,
  requester_name: "QA requester",
  requested_at: "2026-10-02T12:00:00Z",
  team_name: null,
  bu_id: bu,
  bu_name: "Treasury controls",
  workspace_id: workspace,
  workspace_name: "Treasury workspace",
  environment: "prod",
  group_id: group,
  group_name: "Reconciliation reviewers",
  requested_rights: ["recon.definition.read"],
  approved_by: null,
  approver_name: null,
  decided_at: null,
  status: "pending",
  version: 3,
  correlation_id: requestId,
  request_reason: "Assigned daily controls",
  decision_reason: null,
  scope_snapshot: scope,
};
const requestDetail = {
  ...request,
  scope_label: scope.scope_label,
  effective_scope: scope,
  membership_active: false,
  history: [],
  permissions: { can_approve: true, can_reject: true, can_withdraw: true },
};
const review = {
  id: requestId,
  campaign_id: bu,
  campaign_name: "Quarterly controls",
  subject_user_id: subject,
  member_name: "QA requester",
  team_name: null,
  bu_name: "Treasury controls",
  workspace_name: "Treasury workspace",
  environment: "prod",
  group_name: "Reconciliation reviewers",
  current_rights: ["recon.definition.read"],
  reviewer_id: reviewer,
  reviewer_name: "QA independent administrator",
  due_at: "2026-10-05T12:00:00Z",
  outcome: "pending",
  decided_at: null,
  version: 2,
  snapshot_hash: hash,
  requested_by: tenant,
  requested_at: request.requested_at,
  approved_by: null,
  group_id: group,
  bu_id: bu,
  workspace_id: workspace,
  reason: null,
  correlation_id: requestId,
  effective_scope: {
    workspace_context_only: true,
    group_membership_scope: scope.scope_label,
    resource_grants: [],
  },
  historical: false,
};
function page(rows: unknown[], permissions: unknown, kpis: unknown, p = 1, total = rows.length) {
  return { rows, total, page: p, page_size: 10, permissions, kpis };
}
const membershipKpis = {
  awaiting_decision: 21,
  approved_last_7_days: 12,
  independent_checker_needed: 1,
  rejected_or_withdrawn: 2,
};
const reviewKpis = {
  open_campaigns: 3,
  memberships_to_review: 24,
  overdue_decisions: 2,
  completed_last_30_days: 18,
};
const event = {
  id: "123",
  occurred_at: request.requested_at,
  request_id: requestId,
  review_id: null,
  actor_user_id: reviewer,
  actor_name: "QA independent administrator",
  actor_role: "tenant_admin",
  team_name: null,
  scope_label: "Treasury controls",
  environment: "production",
  action: "governance.membership.approve",
  outcome: "success",
  reason: '=HYPERLINK("https://test.invalid","x")',
  version: 3,
  correlation_id: requestId,
};

function mount(element: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000 }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}
async function choose(label: string, name: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(await screen.findByRole("option", { name: new RegExp(name) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  Object.defineProperty(globalThis.crypto, "randomUUID", { value: randomUUID, configurable: true });
  api.membershipList.mockResolvedValue(
    page([request], { can_submit: true, can_review_queue: true }, membershipKpis, 1, 21),
  );
  api.membershipDetail.mockResolvedValue(requestDetail);
  api.membershipOptions.mockImplementation(async ({ data }) => {
    const choices = {
      bu: [{ id: bu, label: "Treasury controls" }],
      environment: [{ id: tenant, label: "Production", environment: "prod" }],
      workspace: [{ id: workspace, label: "Treasury workspace", bu_id: bu }],
      group: [
        {
          id: group,
          label: "Reconciliation reviewers",
          bu_id: bu,
          workspace_id: workspace,
          selectable: true,
          requested_rights: scope.requested_rights,
          scope_label: scope.scope_label,
        },
      ],
    };
    return {
      rows: choices[data.kind as keyof typeof choices],
      total: 1,
      page: data.page,
      page_size: 25,
      has_more: false,
    };
  });
  api.reviewList.mockResolvedValue(
    page([review], { can_create_campaign: true, can_decide: true }, reviewKpis),
  );
  api.reviewDetail.mockResolvedValue({
    ...review,
    history: [],
    snapshot_current: true,
    permitted_actions: ["retain", "request_change", "revoke"],
  });
  api.reviewOptions.mockImplementation(async ({ data }) => {
    const choices = {
      business_units: [{ id: bu, label: "Treasury controls", group_id: null }],
      groups: [{ id: group, label: "Reconciliation reviewers", group_id: group }],
      workspaces: [{ id: workspace, label: "Treasury workspace", group_id: group }],
      members: [
        {
          id: subject,
          label: "QA requester",
          subject_user_id: subject,
          member_name: "QA requester",
          group_id: group,
          group_name: "Reconciliation reviewers",
          bu_name: "Treasury controls",
          workspace_id: workspace,
          workspace_name: "Treasury workspace",
          environment: "prod",
          current_rights: scope.requested_rights,
          snapshot_hash: hash,
          version: 1,
          effective_scope: review.effective_scope,
        },
      ],
      reviewers: [{ id: reviewer, label: "QA independent administrator", group_id: group }],
    };
    return {
      rows: choices[data.kind as keyof typeof choices],
      total: 1,
      page: data.page,
      page_size: 25,
    };
  });
  api.auditList.mockImplementation(async ({ data }) =>
    page(
      [event],
      { read: true, export: true },
      { total: 1, success: 1, denied: 0, failed: 0, pending: 0, unknown: 0 },
      data.page,
    ),
  );
  api.auditDetail.mockResolvedValue(event);
  api.submit.mockResolvedValue({
    id: requestId,
    outcome: "pending",
    status: "pending",
    version: 1,
  });
  api.withdraw.mockResolvedValue({
    id: requestId,
    outcome: "no_access_granted",
    status: "withdrawn",
    version: 4,
  });
  api.approve.mockResolvedValue({
    id: requestId,
    outcome: "grant_confirmed",
    status: "approved",
    version: 4,
  });
  api.decide.mockResolvedValue({ ...review, outcome: "retained", membership_revoked: false });
  api.create.mockResolvedValue({
    campaign_id: bu,
    item_ids: [requestId],
    correlation_id: requestId,
  });
});
afterEach(cleanup);

describe("approved governance components — actual UI state with isolated port fixtures", () => {
  it("renders all three authorized views, full KPI totals, real supplied environment and gold navigation", async () => {
    mount(
      <GovernanceApplicationEnvironmentProvider environment="DEV">
        <GovernanceApprovalQueue tenantId={tenant} tenantSlug="qa-tenant" />
      </GovernanceApplicationEnvironmentProvider>,
    );
    expect(await screen.findByRole("navigation", { name: "Governance views" })).toBeVisible();
    expect(screen.getByLabelText("Application environment")).toHaveTextContent("DEV");
    expect(screen.getByText("21")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Access reviews" }));
    expect(
      await screen.findByText("QA requester · Quarterly controls", { exact: true }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Audit trail", exact: true }));
    expect(await screen.findByText("governance.membership.approve")).toBeVisible();
    expect(screen.getByRole("region", { name: /Governance audit events/ })).toHaveAttribute(
      "tabindex",
      "0",
    );
  });
  it("keeps service refusal distinct from an empty successful membership queue", async () => {
    api.membershipList.mockRejectedValue(new Error("Current tenant membership required"));
    mount(<GovernanceMembershipApprovals tenantId={tenant} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Current tenant membership required",
    );
    expect(screen.queryByText("No membership requests found")).not.toBeInTheDocument();
  });
  it("submits named dependent scopes with no acting-user input and safely retries the identical key after response loss", async () => {
    api.membershipList.mockResolvedValue(
      page([], { can_submit: true, can_review_queue: false }, membershipKpis),
    );
    api.submit.mockRejectedValueOnce(new Error("Response lost"));
    mount(<GovernanceMembershipApprovals tenantId={tenant} />);
    await screen.findByText("Request group access");
    await choose("Business unit", "Treasury controls");
    await choose("Registered environment", "Production");
    await choose("Workspace", "Treasury workspace");
    await choose("Group", "Reconciliation reviewers");
    fireEvent.change(screen.getByLabelText("Why do you need this access?"), {
      target: { value: "Assigned daily controls" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit membership request" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry same request" }));
    await waitFor(() => expect(api.submit).toHaveBeenCalledTimes(2));
    const first = api.submit.mock.calls[0][0].data;
    expect(api.submit.mock.calls[1][0].data).toEqual(first);
    expect(first).toMatchObject({
      tenant_id: tenant,
      bu_id: bu,
      workspace_id: workspace,
      group_id: group,
      environment: "prod",
      reason: "Assigned daily controls",
    });
    expect(first).not.toHaveProperty("actor_id");
    expect(first).not.toHaveProperty("requested_rights");
    expect(
      api.membershipOptions.mock.calls.some(
        ([call]) =>
          call.data.kind === "group" &&
          call.data.bu_id === bu &&
          call.data.workspace_id === workspace,
      ),
    ).toBe(true);
  });
  it("opens the current own request and withdraws with exact version/reason and stable retry key", async () => {
    api.membershipList.mockResolvedValue(
      page([request], { can_submit: true, can_review_queue: false }, membershipKpis),
    );
    api.withdraw.mockRejectedValueOnce(new Error("Response lost"));
    mount(<GovernanceMembershipApprovals tenantId={tenant} />);
    fireEvent.click(await screen.findByRole("button", { name: "Details · Withdraw" }));
    fireEvent.change(await screen.findByLabelText("Withdrawal reason"), {
      target: { value: "Work reassigned" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Withdraw request", exact: true }));
    await waitFor(() => expect(api.withdraw).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Withdraw request", exact: true })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Withdraw request", exact: true }));
    await waitFor(() => expect(api.withdraw).toHaveBeenCalledTimes(2));
    expect(api.withdraw.mock.calls[1][0]).toEqual(api.withdraw.mock.calls[0][0]);
    expect(api.withdraw.mock.calls[0][0].data).toMatchObject({
      request_id: requestId,
      expected_version: 3,
      reason: "Work reassigned",
    });
  });
  it("honors server decision permissions and refuses stale review snapshots", async () => {
    api.membershipDetail.mockResolvedValue({
      ...requestDetail,
      permissions: { can_approve: false, can_reject: false, can_withdraw: false },
    });
    mount(<GovernanceMembershipApprovals tenantId={tenant} />);
    fireEvent.click(await screen.findByRole("button", { name: "Review", exact: true }));
    await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: "Approve request" })).not.toBeInTheDocument();
    cleanup();
    api.reviewDetail.mockResolvedValue({
      ...review,
      history: [],
      snapshot_current: false,
      permitted_actions: ["retain", "revoke"],
    });
    mount(<GovernanceAccessReviews tenantId={tenant} />);
    fireEvent.click(await screen.findByRole("button", { name: "Review", exact: true }));
    await screen.findByText(/snapshot changed/);
    fireEvent.change(screen.getByLabelText("Decision reason"), {
      target: { value: "Review completed" },
    });
    expect(screen.getByRole("button", { name: "Retain access" })).toBeDisabled();
    expect(api.decide).not.toHaveBeenCalled();
  });
  it("creates a first campaign from named current membership and independent reviewer options, retaining hash and retry payload", async () => {
    api.reviewList.mockResolvedValue(
      page([], { can_create_campaign: true, can_decide: true }, reviewKpis),
    );
    api.create.mockRejectedValueOnce(new Error("Response lost"));
    mount(<GovernanceAccessReviews tenantId={tenant} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Create review campaign" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create review campaign" }));
    fireEvent.change(screen.getByLabelText("Campaign name"), {
      target: { value: "Quarterly certification" },
    });
    fireEvent.change(screen.getByLabelText("Decision due at"), {
      target: { value: "2026-10-05T17:00" },
    });
    await choose("Business unit", "Treasury controls");
    await choose("Group", "Reconciliation reviewers");
    await choose("Member", "QA requester");
    await choose("Independent reviewer", "QA independent administrator");
    fireEvent.click(screen.getByRole("button", { name: "Add member to campaign" }));
    fireEvent.click(screen.getByRole("button", { name: "Create campaign · 1" }));
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Retry same campaign" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry same campaign" }));
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(2));
    expect(api.create.mock.calls[1][0]).toEqual(api.create.mock.calls[0][0]);
    expect(api.create.mock.calls[0][0].data.memberships[0]).toMatchObject({
      subject_user_id: subject,
      group_id: group,
      reviewer_id: reviewer,
      snapshot_hash: hash,
    });
    expect(
      api.reviewOptions.mock.calls.some(
        ([call]) => call.data.kind === "reviewers" && call.data.subject_user_id === subject,
      ),
    ).toBe(true);
  });
  it("downloads authorized allowlisted CSV with formula protection and a stable date window", async () => {
    let downloaded: Blob | null = null;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn((blob) => {
        downloaded = blob;
        return "blob:qa";
      }),
    });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    mount(<GovernanceAuditTrail tenantId={tenant} />);
    await screen.findByText("governance.membership.approve");
    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    await waitFor(() => expect(downloaded).not.toBeNull());
    const content = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(downloaded!);
    });
    expect(content).toContain("'=HYPERLINK");
    expect(content).not.toContain("actor_user_id");
    const reads = api.auditList.mock.calls.map(([call]) => call.data);
    expect(new Set(reads.map((call) => call.to)).size).toBe(1);
    cleanup();
    api.auditList.mockResolvedValue(page([event], { read: true, export: false }, { total: 1 }));
    mount(<GovernanceAuditTrail tenantId={tenant} />);
    await screen.findByText("governance.membership.approve");
    expect(screen.getByRole("button", { name: "Download CSV" })).toBeDisabled();
  });
  it("retains an uncertain key, rejects payload changes and clears only the matching confirmed intent", () => {
    const payload = { id: requestId, reason: "Assigned controls", version: 3 };
    const key = getGovernanceIntentKey("unit-intent", payload);
    expect(getGovernanceIntentKey("unit-intent", payload)).toBe(key);
    expect(() => getGovernanceIntentKey("unit-intent", { ...payload, reason: "Changed" })).toThrow(
      "uncertain result",
    );
    clearGovernanceIntentKey("unit-intent", payload);
    expect(getGovernanceIntentKey("unit-intent", payload)).not.toBe(key);
    expect(formatGovernanceTime(request.requested_at, { second: "2-digit" })).toContain("17:30");
  });
  it("keeps the workspace requester entry self-scoped even for an active tenant administrator", async () => {
    mount(<GovernanceMembershipRequests tenantId={tenant} />);
    expect(await screen.findByText("Request group access")).toBeVisible();
    expect(screen.queryByText("Awaiting decision")).not.toBeInTheDocument();
    expect(api.membershipList.mock.calls[0][0].data.own_only).toBe(true);
    expect(screen.queryByRole("navigation", { name: "Governance views" })).not.toBeInTheDocument();
  });
  it("shows only server-authorized views for a requester and uses an explicit denied state", async () => {
    api.membershipList.mockResolvedValue(
      page([], { can_submit: true, can_review_queue: false }, membershipKpis),
    );
    api.reviewList.mockRejectedValue(new Error("Tenant administrator required"));
    api.auditList.mockRejectedValue(new Error("Audit read denied"));
    mount(<GovernanceApprovalQueue tenantId={tenant} tenantSlug="qa-tenant" />);
    const nav = await screen.findByRole("navigation", { name: "Governance views" });
    expect(nav.querySelectorAll("button")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "View audit trail" })).not.toBeInTheDocument();
    expect(await screen.findByText("Request group access")).toBeVisible();
  });
  it("pages and searches an authoritative 1,005-option BU chooser and restores keyboard focus on Escape", async () => {
    api.membershipOptions.mockImplementation(async ({ data }) => ({
      rows:
        data.kind === "bu"
          ? [
              {
                id: bu,
                label: data.search ? "Treasury matching search" : `Treasury page ${data.page}`,
              },
            ]
          : [{ id: tenant, label: "Production", environment: "prod" }],
      total: data.kind === "bu" ? 1005 : 1,
      page: data.page,
      page_size: 25,
      has_more: data.page < 41,
    }));
    mount(<GovernanceMembershipApprovals tenantId={tenant} />);
    const trigger = await screen.findByRole("combobox", { name: "Business unit" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(await screen.findByRole("option", { name: "Treasury page 1" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "More", exact: true }));
    expect(await screen.findByRole("option", { name: "Treasury page 2" })).toBeVisible();
    fireEvent.change(screen.getByLabelText("Search Business unit"), {
      target: { value: "Treasury" },
    });
    expect(await screen.findByRole("option", { name: "Treasury matching search" })).toBeVisible();
    expect(
      api.membershipOptions.mock.calls.some(
        ([call]) =>
          call.data.kind === "bu" && call.data.page === 1 && call.data.search === "Treasury",
      ),
    ).toBe(true);
    fireEvent.keyDown(screen.getByLabelText("Search Business unit"), { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });
  it("replays an independent approval with the same exact expected version, reason and key", async () => {
    api.approve.mockRejectedValueOnce(new Error("Response lost"));
    mount(<GovernanceMembershipApprovals tenantId={tenant} />);
    fireEvent.click(await screen.findByRole("button", { name: "Review", exact: true }));
    fireEvent.change(await screen.findByLabelText("Decision reason"), {
      target: { value: "Assigned scoped operations" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve request" }));
    await waitFor(() => expect(api.approve).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Approve request" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve request" }));
    await waitFor(() => expect(api.approve).toHaveBeenCalledTimes(2));
    expect(api.approve.mock.calls[1][0]).toEqual(api.approve.mock.calls[0][0]);
    expect(api.approve.mock.calls[0][0].data).toMatchObject({
      request_id: requestId,
      expected_version: 3,
      reason: "Assigned scoped operations",
      decision: "approve",
    });
  });
  it("shows exact effective resource scope with an allowlisted view and excludes arbitrary context", () => {
    mount(
      <GovernanceEffectiveScope
        scope={{
          resource_grants: [
            {
              resource_type: "reconciliation",
              resource_id: requestId,
              action: "run",
              bu_id: bu,
              password: "DO_NOT_RENDER_PRIVATE_CONTEXT",
              context: { token: "hidden" },
            },
          ],
        }}
      />,
    );
    const summary = screen.getByText("Group resource grants · 1");
    fireEvent.click(summary);
    expect(screen.getByText(requestId)).toBeInTheDocument();
    expect(screen.getByText("run")).toBeInTheDocument();
    expect(screen.queryByText("DO_NOT_RENDER_PRIVATE_CONTEXT")).not.toBeInTheDocument();
    expect(screen.queryByText("hidden")).not.toBeInTheDocument();
  });
  it("never shows fabricated KPI zeroes while access-review data is loading", async () => {
    let release: (value: unknown) => void = () => {};
    api.reviewList.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    mount(<GovernanceAccessReviews tenantId={tenant} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading access reviews");
    expect(screen.queryByText("Open review campaigns")).not.toBeInTheDocument();
    release(page([], { can_create_campaign: true, can_decide: true }, reviewKpis));
    expect(await screen.findByText("Open review campaigns")).toBeVisible();
  });
});
