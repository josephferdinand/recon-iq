import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCheck, Eye, Plus, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  GovernanceDetailPanel,
  GovernanceHistory,
  GovernanceEffectiveScope,
} from "@/components/governance-review-detail";
import {
  GovernanceCell,
  GovernanceEmpty,
  GovernanceError,
  GovernanceFootnote,
  GovernanceLoading,
  GovernancePagination,
  GovernancePanel,
  GovernanceStatus,
  GovernanceSummaryCards,
  GovernanceTableHead,
  GovernanceTableScroll,
  GovernanceTd,
  GovernanceTh,
  GovernanceToolbar,
  clearGovernanceIntentDraft,
  clearGovernanceIntentKey,
  formatGovernanceTime,
  formatGovernanceEnvironment,
  getGovernanceIntentKey,
  readGovernanceIntentDraft,
  storeGovernanceIntentDraft,
  useGovernanceFilters,
} from "@/components/governance-review-detail";
import {
  createGovernanceAccessReviewCampaign,
  decideGovernanceAccessReview,
  getGovernanceAccessReview,
  listGovernanceAccessReviews,
  listGovernanceAccessReviewOptions,
  type GovernanceAccessReviewDetail,
  type GovernanceAccessReviewOption,
  type GovernanceAccessReviewRow,
} from "@/lib/governance-access-review.functions";

const emptyKpis = {
  open_campaigns: 0,
  memberships_to_review: 0,
  overdue_decisions: 0,
  completed_last_30_days: 0,
};

export function GovernanceAccessReviews({ tenantId }: { tenantId: string }) {
  const client = useQueryClient();
  const listFn = useServerFn(listGovernanceAccessReviews);
  const detailFn = useServerFn(getGovernanceAccessReview);
  const decideFn = useServerFn(decideGovernanceAccessReview);
  const { filters, page, setPage, search, setSearch } = useGovernanceFilters();
  const [outcome, setOutcome] = useState("all");
  const [campaignId, setCampaignId] = useState("all");
  const [selected, setSelected] = useState<GovernanceAccessReviewDetail | null>(null);
  const [reason, setReason] = useState("");
  const [campaignOpen, setCampaignOpen] = useState(false);
  const input = {
    tenant_id: tenantId,
    page,
    page_size: 10,
    search: filters.search,
    ...(outcome !== "all"
      ? {
          outcome: outcome as
            | "pending"
            | "retained"
            | "change_requested"
            | "revoked"
            | "historical_unknown",
        }
      : {}),
    ...(campaignId !== "all" ? { campaign_id: campaignId } : {}),
  };
  const query = useQuery({
    queryKey: ["governance-access-reviews", input],
    queryFn: () => listFn({ data: input }),
  });
  const detailQuery = useMutation({
    mutationFn: (id: string) => detailFn({ data: { tenant_id: tenantId, id } }),
    onSuccess: (data) => {
      setSelected(data);
      setReason(readGovernanceIntentDraft<string>(`review-decision-${data.id}`) ?? "");
    },
  });
  const decision = useMutation({
    mutationFn: (data: {
      id: string;
      version: number;
      hash: string;
      choice: "retain" | "request_change" | "revoke";
      reason: string;
    }) => {
      const intent = {
        tenant_id: tenantId,
        id: data.id,
        expected_version: data.version,
        snapshot_hash: data.hash,
        decision: data.choice,
        reason: data.reason.trim(),
      };
      const request_key = getGovernanceIntentKey(`review-decision-${data.id}`, intent);
      return decideFn({ data: { ...intent, request_key } });
    },
    onSuccess: async (_result, variables) => {
      const intent = {
        tenant_id: tenantId,
        id: variables.id,
        expected_version: variables.version,
        snapshot_hash: variables.hash,
        decision: variables.choice,
        reason: variables.reason.trim(),
      };
      clearGovernanceIntentKey(`review-decision-${variables.id}`, intent);
      clearGovernanceIntentDraft(`review-decision-${variables.id}`);
      toast.success(
        variables.choice === "revoke"
          ? "Review decision recorded; access outcome will follow the verified result."
          : "Review decision recorded.",
      );
      setSelected(null);
      setReason("");
      await client.invalidateQueries({ queryKey: ["governance-access-reviews"] });
      await client.invalidateQueries({ queryKey: ["governance-audit-trail"] });
    },
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? `${error.message} Retry the unchanged decision to reuse its request key.`
          : "The review decision was not recorded.",
      ),
  });

  const summaries = query.data?.kpis ?? emptyKpis;
  const rows = query.data?.rows ?? [];

  return (
    <>
      {campaignOpen && (
        <GovernanceAccessReviewCampaignBuilder
          tenantId={tenantId}
          onCancel={() => setCampaignOpen(false)}
          onCreated={async () => {
            setCampaignOpen(false);
            await client.invalidateQueries({ queryKey: ["governance-access-reviews"] });
            await client.invalidateQueries({ queryKey: ["governance-audit-trail"] });
          }}
        />
      )}
      {query.isSuccess && (
        <GovernanceSummaryCards
          items={[
            {
              label: "Open review campaigns",
              value: summaries.open_campaigns,
              hint: "Current access certification",
            },
            {
              label: "Memberships to review",
              value: summaries.memberships_to_review,
              hint: "Within your authorized scope",
            },
            {
              label: "Overdue decisions",
              value: summaries.overdue_decisions,
              hint: "Awaiting reviewer action",
              tone: summaries.overdue_decisions ? "warning" : "default",
            },
            {
              label: "Completed · last 30 days",
              value: summaries.completed_last_30_days,
              hint: "Retained decision evidence",
              tone: "good",
            },
          ]}
        />
      )}
      <GovernancePanel label="Access review queue">
        <GovernanceToolbar
          searchLabel="Search access reviews"
          searchPlaceholder="Search review, member, group or reviewer"
          showEnvironment={false}
          maxSearchLength={160}
          search={search}
          onSearch={(value) => {
            setSearch(value);
            setPage(1);
          }}
        >
          <label className="sr-only" htmlFor="governance-review-campaign">
            Review campaign
          </label>
          <select
            id="governance-review-campaign"
            aria-label="Review campaign"
            className="h-10 max-w-56 rounded-md border border-slate-300 bg-white px-3 text-sm"
            value={campaignId}
            onChange={(event) => {
              setCampaignId(event.target.value);
              setPage(1);
            }}
          >
            <option value="all">All campaigns</option>
            {[...new Map(rows.map((row) => [row.campaign_id, row.campaign_name])).entries()].map(
              ([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ),
            )}
          </select>
          <label className="sr-only" htmlFor="governance-review-outcome">
            Review outcome
          </label>
          <select
            id="governance-review-outcome"
            aria-label="Review outcome"
            className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
            value={outcome}
            onChange={(event) => {
              setOutcome(event.target.value);
              setPage(1);
            }}
          >
            <option value="all">All outcomes</option>
            <option value="pending">Pending</option>
            <option value="retained">Retained</option>
            <option value="change_requested">Change requested</option>
            <option value="revoked">Revoked</option>
            <option value="historical_unknown">Historical · unknown</option>
          </select>
          <Button
            className="bg-[#caa33e] text-slate-950 hover:bg-[#b8912f]"
            onClick={() => setCampaignOpen((open) => !open)}
            disabled={!query.data?.permissions.can_create_campaign}
          >
            <Plus className="mr-2 h-4 w-4" />
            Create review campaign
          </Button>
        </GovernanceToolbar>
        {query.isPending ? (
          <GovernanceLoading label="access reviews" />
        ) : query.isError ? (
          <GovernanceError
            message={
              query.error instanceof Error ? query.error.message : "The access review query failed."
            }
            onRetry={() => void query.refetch()}
          />
        ) : rows.length === 0 ? (
          <GovernanceEmpty
            title="No access reviews found"
            detail="No records match this tenant and filter selection."
          />
        ) : (
          <>
            <GovernanceTableScroll label="Access reviews; scroll horizontally for more columns">
              <GovernanceTableHead>
                <GovernanceTh>Review / member</GovernanceTh>
                <GovernanceTh>Team / business unit</GovernanceTh>
                <GovernanceTh>Workspace / environment</GovernanceTh>
                <GovernanceTh>Group / current rights</GovernanceTh>
                <GovernanceTh>Assigned reviewer</GovernanceTh>
                <GovernanceTh>Due at · IST</GovernanceTh>
                <GovernanceTh>Outcome / version</GovernanceTh>
                <GovernanceTh>Action</GovernanceTh>
              </GovernanceTableHead>
              <tbody>
                {rows.map((row: GovernanceAccessReviewRow) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <GovernanceTd>
                      <GovernanceCell
                        primary={row.id}
                        secondary={`${row.member_name ?? row.subject_user_id} · ${row.campaign_name}${row.historical ? " · historical record" : ""}`}
                      />
                    </GovernanceTd>
                    <GovernanceTd>
                      <GovernanceCell
                        primary={row.team_name ?? "Team unavailable"}
                        secondary={row.bu_name ?? row.bu_id ?? "Business unit unavailable"}
                      />
                    </GovernanceTd>
                    <GovernanceTd>
                      <GovernanceCell
                        primary={
                          row.workspace_name ?? row.workspace_id ?? "Workspace context unavailable"
                        }
                        secondary={formatGovernanceEnvironment(row.environment)}
                      />
                    </GovernanceTd>
                    <GovernanceTd>
                      <GovernanceCell
                        primary={row.group_name ?? "Group unavailable"}
                        secondary={row.current_rights.join(" · ") || "Rights unavailable"}
                      />
                      <div className="mt-1 text-xs font-medium text-amber-900">
                        Effective scope: {row.effective_scope.group_membership_scope}
                      </div>
                      {row.effective_scope.resource_grants.length > 0 && (
                        <div className="mt-1 text-xs text-slate-600">
                          Group resource grants may extend across workspaces.
                        </div>
                      )}
                    </GovernanceTd>
                    <GovernanceTd>
                      <GovernanceCell
                        primary={row.reviewer_name ?? row.reviewer_id ?? "Reviewer unavailable"}
                        secondary={row.reviewer_id ? "Assigned reviewer" : "No reviewer assigned"}
                      />
                    </GovernanceTd>
                    <GovernanceTd>{formatGovernanceTime(row.due_at)}</GovernanceTd>
                    <GovernanceTd>
                      <GovernanceStatus value={row.outcome} />
                      <div className="mt-1 text-xs text-slate-600">
                        Snapshot v{row.version}
                        {row.snapshot_hash
                          ? ` · ${row.snapshot_hash.slice(0, 8)}`
                          : " · incomplete"}
                      </div>
                    </GovernanceTd>
                    <GovernanceTd>
                      <Button
                        size="sm"
                        className="bg-[#caa33e] text-slate-950 hover:bg-[#b8912f]"
                        onClick={() => detailQuery.mutate(row.id)}
                      >
                        <Eye className="mr-1 h-4 w-4" />
                        {row.outcome === "pending" ? "Review" : "View"}
                      </Button>
                    </GovernanceTd>
                  </tr>
                ))}
              </tbody>
            </GovernanceTableScroll>
            <GovernancePagination
              page={query.data.page}
              pageSize={query.data.page_size}
              total={query.data.total}
              onPage={setPage}
            />
          </>
        )}
      </GovernancePanel>
      {!selected && detailQuery.isPending && <GovernanceLoading label="current review details" />}
      {!selected && detailQuery.isError && (
        <GovernanceError
          message={
            detailQuery.error instanceof Error
              ? detailQuery.error.message
              : "Review details could not be loaded."
          }
          onRetry={() => detailQuery.variables && detailQuery.mutate(detailQuery.variables)}
        />
      )}
      <GovernanceFootnote>
        Reviews certify existing access. A revoke is confirmed only when the reviewed membership
        change commits and its effective access is denied. Historical rows without a complete
        current snapshot remain marked unknown. Display times use IST; event timestamps remain UTC.
      </GovernanceFootnote>
      {selected && (
        <GovernanceDetailPanel
          title="Access certification review"
          onClose={() => setSelected(null)}
        >
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {[
              ["Member", selected.member_name ?? "Member unavailable"],
              [
                "Team / business unit",
                `${selected.team_name ?? "Team unavailable"} / ${selected.bu_name ?? "BU unavailable"}`,
              ],
              [
                "Workspace / environment",
                `${selected.workspace_name ?? "Workspace context unavailable"} / ${selected.environment ?? "Unavailable"}`,
              ],
              ["Group", selected.group_name ?? "Group unavailable"],
              ["Current rights", selected.current_rights.join(" · ") || "Rights unavailable"],
              ["Effective scope", selected.effective_scope.group_membership_scope],
              ["Reviewer", selected.reviewer_name ?? "Reviewer unavailable"],
              [
                "Snapshot",
                `Version ${selected.version} · ${selected.snapshot_hash ?? "No verified snapshot"}`,
              ],
              ["Decision time", formatGovernanceTime(selected.decided_at)],
              ["Reason", selected.reason ?? "No reason recorded"],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs font-medium text-slate-600">{label}</dt>
                <dd className="mt-1 text-sm text-slate-950">{value}</dd>
              </div>
            ))}
          </dl>
          {!selected.snapshot_current && (
            <p role="alert" className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-950">
              <ShieldAlert className="mr-2 inline h-4 w-4" />
              The membership or permission snapshot changed. Refresh the record before deciding.
            </p>
          )}
          {selected.effective_scope.resource_grants.length > 0 && (
            <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              This group has resource grants beyond the named workspace. Review the effective scope
              before taking action.
            </p>
          )}
          <GovernanceEffectiveScope scope={selected.effective_scope} />
          <GovernanceHistory events={selected.history} />
          <label className="mt-5 block text-sm font-medium" htmlFor="review-decision-reason">
            Decision reason
          </label>
          <textarea
            id="review-decision-reason"
            readOnly={decision.isPending || decision.isError}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              storeGovernanceIntentDraft(`review-decision-${selected.id}`, event.target.value);
            }}
            maxLength={2000}
            rows={3}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white p-3 text-sm text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
            placeholder="Explain why this access should remain, change or be revoked."
          />
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            {selected.permitted_actions.includes("retain") && (
              <Button
                variant="outline"
                disabled={
                  decision.isPending ||
                  !reason.trim() ||
                  !selected.snapshot_current ||
                  !selected.snapshot_hash
                }
                onClick={() =>
                  decision.mutate({
                    id: selected.id,
                    version: selected.version,
                    hash: selected.snapshot_hash!,
                    choice: "retain",
                    reason,
                  })
                }
              >
                <CheckCheck className="mr-2 h-4 w-4" />
                Retain access
              </Button>
            )}
            {selected.permitted_actions.includes("request_change") && (
              <Button
                variant="outline"
                disabled={
                  decision.isPending ||
                  !reason.trim() ||
                  !selected.snapshot_current ||
                  !selected.snapshot_hash
                }
                onClick={() =>
                  decision.mutate({
                    id: selected.id,
                    version: selected.version,
                    hash: selected.snapshot_hash!,
                    choice: "request_change",
                    reason,
                  })
                }
              >
                Request change
              </Button>
            )}
            {selected.permitted_actions.includes("revoke") && (
              <Button
                variant="destructive"
                disabled={
                  decision.isPending ||
                  !reason.trim() ||
                  !selected.snapshot_current ||
                  !selected.snapshot_hash
                }
                onClick={() =>
                  decision.mutate({
                    id: selected.id,
                    version: selected.version,
                    hash: selected.snapshot_hash!,
                    choice: "revoke",
                    reason,
                  })
                }
              >
                <ShieldAlert className="mr-2 h-4 w-4" />
                Revoke access
              </Button>
            )}
          </div>
          {detailQuery.isPending && (
            <p role="status" className="mt-3 text-sm text-slate-600">
              Refreshing current snapshot…
            </p>
          )}
          {detailQuery.isError && (
            <p role="alert" className="mt-3 text-sm text-red-800">
              {detailQuery.error instanceof Error
                ? detailQuery.error.message
                : "The current review could not be loaded."}
            </p>
          )}
        </GovernanceDetailPanel>
      )}
    </>
  );
}

type ReviewOptionKind = "business_units" | "groups" | "workspaces" | "members" | "reviewers";
function ReviewOptionPicker({
  tenantId,
  kind,
  label,
  value,
  onChange,
  buId,
  groupId,
  workspaceId,
  subjectUserId,
  optional = false,
  disabled = false,
}: {
  tenantId: string;
  kind: ReviewOptionKind;
  label: string;
  value: GovernanceAccessReviewOption | null;
  onChange: (option: GovernanceAccessReviewOption | null) => void;
  buId?: string;
  groupId?: string;
  workspaceId?: string;
  subjectUserId?: string;
  optional?: boolean;
  disabled?: boolean;
}) {
  const optionsFn = useServerFn(listGovernanceAccessReviewOptions);
  const listId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    setPage(1);
    setSearch("");
    setOpen(false);
  }, [tenantId, buId, groupId, workspaceId, subjectUserId]);
  const needsBu = kind === "groups" || kind === "workspaces" || kind === "members";
  const needsGroup = kind === "members" || kind === "reviewers";
  const enabled =
    !disabled &&
    (!needsBu || !!buId) &&
    (!needsGroup || !!groupId) &&
    (kind !== "reviewers" || !!subjectUserId);
  const input = {
    tenant_id: tenantId,
    kind,
    page,
    page_size: 25,
    search: search.trim(),
    ...(buId ? { bu_id: buId } : {}),
    ...(groupId ? { group_id: groupId } : {}),
    ...(workspaceId ? { workspace_id: workspaceId } : {}),
    ...(subjectUserId ? { subject_user_id: subjectUserId } : {}),
  };
  const query = useQuery({
    queryKey: ["governance-access-review-options", input],
    queryFn: () => optionsFn({ data: input }),
    enabled,
  });
  const display = (option: GovernanceAccessReviewOption) =>
    option.label ?? option.member_name ?? option.id;
  return (
    <div
      className="relative min-w-48 flex-1"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <label className="mb-1 block text-xs font-medium text-slate-700">
        {label}
        {optional ? " · optional" : ""}
      </label>
      <button
        type="button"
        role="combobox"
        ref={trigger}
        aria-controls={listId}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        aria-label={label}
        aria-expanded={open}
        disabled={!enabled}
        onClick={() => setOpen((value) => !value)}
        className="flex h-10 w-full items-center justify-between rounded-md border border-slate-300 bg-white px-3 text-left text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 disabled:bg-slate-100 disabled:text-slate-500"
      >
        <span className="truncate">
          {value
            ? display(value)
            : enabled
              ? `Choose ${label.toLowerCase()}`
              : "Select the preceding scope first"}
        </span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div
          role="region"
          aria-label={`${label} choices`}
          className="absolute z-30 mt-1 w-full min-w-64 rounded-md border border-slate-300 bg-white p-2 shadow-lg"
        >
          <Input
            maxLength={160}
            aria-label={`Search ${label}`}
            autoFocus
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder={`Search ${label.toLowerCase()}`}
          />
          {optional && (
            <button
              type="button"
              className="mt-1 w-full rounded px-3 py-2 text-left text-sm hover:bg-slate-100"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              No specific workspace context
            </button>
          )}
          {query.isPending ? (
            <p role="status" className="p-3 text-sm text-slate-600">
              Loading authorized names…
            </p>
          ) : query.isError ? (
            <p role="alert" className="p-3 text-sm text-red-800">
              {query.error instanceof Error
                ? query.error.message
                : `Could not load ${label.toLowerCase()} choices.`}
            </p>
          ) : query.data.rows.length === 0 ? (
            <p className="p-3 text-sm text-slate-600">No matching authorized records.</p>
          ) : (
            <div
              id={listId}
              role="listbox"
              aria-label={`${label} options`}
              className="mt-1 max-h-56 overflow-y-auto"
            >
              {query.data.rows.map((option) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={value?.id === option.id}
                  key={option.id}
                  onClick={() => {
                    onChange(option);
                    setOpen(false);
                  }}
                  className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
                >
                  <span className="block font-medium">{display(option)}</span>
                  {[
                    option.team_name,
                    option.bu_name,
                    option.group_name,
                    option.workspace_name,
                    option.environment?.toUpperCase(),
                  ].filter(Boolean).length > 0 && (
                    <span className="mt-1 block text-xs text-slate-600">
                      {[
                        option.team_name,
                        option.bu_name,
                        option.group_name,
                        option.workspace_name,
                        option.environment?.toUpperCase(),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                  {option.current_rights?.length ? (
                    <span className="mt-1 block text-xs text-slate-600">
                      {option.current_rights.join(" · ")}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
          {query.data && query.data.total > query.data.page_size && (
            <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2 text-xs text-slate-600">
              <span>
                Page {query.data.page} · {query.data.total.toLocaleString()} matches
              </span>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => current - 1)}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page * query.data.page_size >= query.data.total}
                  onClick={() => setPage((current) => current + 1)}
                >
                  More
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type CampaignMember = {
  subject_user_id: string;
  group_id: string;
  reviewer_id: string;
  workspace_id: string | null;
  snapshot_hash: string;
  memberLabel: string;
  groupLabel: string;
  reviewerLabel: string;
  teamLabel: string | null;
  buLabel: string | null;
  workspaceLabel: string | null;
  environment: string | null;
  rights: string[];
  scopeLabel: string;
};
type CampaignDraft = {
  name: string;
  dueAt: string;
  description: string;
  businessUnit: GovernanceAccessReviewOption | null;
  group: GovernanceAccessReviewOption | null;
  workspace: GovernanceAccessReviewOption | null;
  member: GovernanceAccessReviewOption | null;
  reviewer: GovernanceAccessReviewOption | null;
  selected: CampaignMember[];
};
const emptyCampaignDraft: CampaignDraft = {
  name: "",
  dueAt: "",
  description: "",
  businessUnit: null,
  group: null,
  workspace: null,
  member: null,
  reviewer: null,
  selected: [],
};
function readCampaignDraft(tenantId: string): CampaignDraft {
  try {
    return {
      ...emptyCampaignDraft,
      ...(JSON.parse(
        sessionStorage.getItem(`fvi-review-campaign-draft:${tenantId}`) ?? "{}",
      ) as Partial<CampaignDraft>),
    };
  } catch {
    return emptyCampaignDraft;
  }
}

function GovernanceAccessReviewCampaignBuilder({
  tenantId,
  onCancel,
  onCreated,
}: {
  tenantId: string;
  onCancel: () => void;
  onCreated: () => void;
}) {
  const createFn = useServerFn(createGovernanceAccessReviewCampaign);
  const [draft, setDraft] = useState<CampaignDraft>(() =>
    typeof window === "undefined" ? emptyCampaignDraft : readCampaignDraft(tenantId),
  );
  const [memberError, setMemberError] = useState("");
  useEffect(() => {
    sessionStorage.setItem(`fvi-review-campaign-draft:${tenantId}`, JSON.stringify(draft));
  }, [tenantId, draft]);
  const addMembership = () => {
    const member = draft.member;
    const reviewer = draft.reviewer;
    if (!draft.group?.id || !member?.subject_user_id || !member.snapshot_hash || !reviewer?.id) {
      setMemberError(
        "Select a current membership with a verified snapshot and an independent tenant-administrator reviewer.",
      );
      return;
    }
    if (
      draft.selected.some(
        (item) =>
          item.subject_user_id === member.subject_user_id && item.group_id === draft.group!.id,
      )
    ) {
      setMemberError("This member and group are already included.");
      return;
    }
    const item: CampaignMember = {
      subject_user_id: member.subject_user_id,
      group_id: draft.group.id,
      reviewer_id: reviewer.id,
      workspace_id: draft.workspace?.id ?? member.workspace_id ?? null,
      snapshot_hash: member.snapshot_hash,
      memberLabel: member.member_name ?? member.label ?? member.id,
      groupLabel: member.group_name ?? draft.group.label ?? draft.group.id,
      reviewerLabel: reviewer.label ?? reviewer.id,
      teamLabel: member.team_name ?? null,
      buLabel: member.bu_name ?? draft.businessUnit?.label ?? null,
      workspaceLabel: draft.workspace?.label ?? member.workspace_name ?? null,
      environment: member.environment ?? null,
      rights: member.current_rights ?? [],
      scopeLabel:
        member.effective_scope?.group_membership_scope ?? "Effective group scope unavailable",
    };
    setDraft((current) => ({
      ...current,
      selected: [...current.selected, item],
      member: null,
      reviewer: null,
    }));
    setMemberError("");
  };
  const create = useMutation({
    mutationFn: () => {
      if (!draft.name.trim() || !draft.dueAt || !draft.selected.length)
        throw new Error(
          "Enter a campaign name and due time, then add at least one verified membership and reviewer.",
        );
      const intent = {
        tenant_id: tenantId,
        name: draft.name.trim(),
        description: draft.description.trim() || undefined,
        due_at: new Date(draft.dueAt).toISOString(),
        memberships: draft.selected.map(
          ({ subject_user_id, group_id, reviewer_id, workspace_id, snapshot_hash }) => ({
            subject_user_id,
            group_id,
            reviewer_id,
            workspace_id,
            snapshot_hash,
          }),
        ),
      };
      const request_key = getGovernanceIntentKey(`review-campaign-${tenantId}`, intent);
      return createFn({ data: { ...intent, request_key } });
    },
    onSuccess: (result) => {
      const intent = {
        tenant_id: tenantId,
        name: draft.name.trim(),
        description: draft.description.trim() || undefined,
        due_at: new Date(draft.dueAt).toISOString(),
        memberships: draft.selected.map(
          ({ subject_user_id, group_id, reviewer_id, workspace_id, snapshot_hash }) => ({
            subject_user_id,
            group_id,
            reviewer_id,
            workspace_id,
            snapshot_hash,
          }),
        ),
      };
      clearGovernanceIntentKey(`review-campaign-${tenantId}`, intent);
      sessionStorage.removeItem(`fvi-review-campaign-draft:${tenantId}`);
      sessionStorage.removeItem(`fvi-review-campaign-draft:${tenantId}`);
      toast.success(`Campaign created with ${result.item_ids.length} verified memberships.`);
      onCreated();
    },
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? `${error.message} If the result is uncertain, retry the exact saved campaign to replay the same request key.`
          : "Campaign creation did not return a verified result.",
      ),
  });

  return (
    <section
      aria-label="Create access review campaign"
      className="mb-5 rounded-lg border border-slate-200 bg-white p-4"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">Create access review campaign</h2>
          <p className="mt-1 text-sm text-slate-600">
            Search current tenant memberships, inspect their effective scope and assign a separate
            active tenant administrator to review each one.
          </p>
        </div>
        <Button variant="outline" onClick={onCancel}>
          Close
        </Button>
      </div>
      <fieldset disabled={create.isPending || create.isError} className="min-w-0 border-0 p-0">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">
            Campaign name
            <Input
              className="mt-1"
              value={draft.name}
              onChange={(event) => setDraft((d) => ({ ...d, name: event.target.value }))}
              maxLength={160}
            />
          </label>
          <label className="text-sm font-medium">
            Decision due at
            <Input
              className="mt-1"
              type="datetime-local"
              value={draft.dueAt}
              onChange={(event) => setDraft((d) => ({ ...d, dueAt: event.target.value }))}
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-slate-600">
          Due time uses your browser timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone});
          timestamps are stored in UTC and displayed in IST in the review table.
        </p>
        <label className="mt-3 block text-sm font-medium">
          Description · optional
          <textarea
            rows={2}
            maxLength={1000}
            value={draft.description}
            onChange={(event) => setDraft((d) => ({ ...d, description: event.target.value }))}
            className="mt-1 w-full rounded-md border border-slate-300 p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
          />
        </label>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <ReviewOptionPicker
            tenantId={tenantId}
            kind="business_units"
            label="Business unit"
            value={draft.businessUnit}
            onChange={(businessUnit) =>
              setDraft((d) => ({
                ...d,
                businessUnit,
                group: null,
                workspace: null,
                member: null,
                reviewer: null,
              }))
            }
          />
          <ReviewOptionPicker
            tenantId={tenantId}
            kind="groups"
            label="Group"
            value={draft.group}
            buId={draft.businessUnit?.id}
            onChange={(group) =>
              setDraft((d) => ({ ...d, group, workspace: null, member: null, reviewer: null }))
            }
            disabled={!draft.businessUnit}
          />
          <ReviewOptionPicker
            tenantId={tenantId}
            kind="workspaces"
            label="Workspace"
            value={draft.workspace}
            buId={draft.businessUnit?.id}
            groupId={draft.group?.id}
            onChange={(workspace) =>
              setDraft((d) => ({ ...d, workspace, member: null, reviewer: null }))
            }
            optional
            disabled={!draft.group}
          />
          <ReviewOptionPicker
            tenantId={tenantId}
            kind="members"
            label="Member"
            value={draft.member}
            buId={draft.businessUnit?.id}
            groupId={draft.group?.id}
            workspaceId={draft.workspace?.id}
            onChange={(member) => setDraft((d) => ({ ...d, member, reviewer: null }))}
            disabled={!draft.group}
          />
          <ReviewOptionPicker
            tenantId={tenantId}
            kind="reviewers"
            label="Independent reviewer"
            value={draft.reviewer}
            groupId={draft.group?.id}
            subjectUserId={draft.member?.subject_user_id}
            onChange={(reviewer) => setDraft((d) => ({ ...d, reviewer }))}
            disabled={!draft.group || !draft.member}
          />
        </div>
        {draft.member && (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <strong>{draft.member.member_name ?? draft.member.label ?? draft.member.id}</strong>
            {draft.member.team_name ? ` · ${draft.member.team_name}` : ""}
            {draft.member.group_name ? ` · ${draft.member.group_name}` : ""}
            {draft.member.current_rights?.length ? (
              <p className="mt-1">Current rights: {draft.member.current_rights.join(" · ")}</p>
            ) : (
              <p className="mt-1">Current rights unavailable from this scoped source.</p>
            )}
            <p className="mt-1">
              {draft.member.effective_scope?.group_membership_scope ?? "Group scope unavailable"} ·
              group grants may extend across workspaces.
            </p>
            {draft.reviewer && (
              <p className="mt-1">
                Assigned independent reviewer: {draft.reviewer.label ?? draft.reviewer.id}
              </p>
            )}
          </div>
        )}
        {draft.member && draft.reviewer && (
          <div className="mt-3 flex justify-end">
            <Button variant="outline" onClick={addMembership}>
              <Plus className="mr-2 h-4 w-4" />
              Add member to campaign
            </Button>
          </div>
        )}
        {memberError && (
          <p role="alert" className="mt-2 text-sm text-red-800">
            {memberError}
          </p>
        )}
        {draft.selected.length > 0 && (
          <GovernancePanel label="Selected campaign memberships">
            <GovernanceTableScroll label="Selected members and independent reviewers">
              <GovernanceTableHead>
                <GovernanceTh>Member / team</GovernanceTh>
                <GovernanceTh>Business unit / group</GovernanceTh>
                <GovernanceTh>Workspace context / environment</GovernanceTh>
                <GovernanceTh>Current rights / effective scope</GovernanceTh>
                <GovernanceTh>Independent reviewer</GovernanceTh>
                <GovernanceTh>Action</GovernanceTh>
              </GovernanceTableHead>
              <tbody>
                {draft.selected.map((item, index) => (
                  <tr key={`${item.subject_user_id}-${item.group_id}`}>
                    <GovernanceTd>
                      <GovernanceCell
                        primary={item.memberLabel}
                        secondary={item.teamLabel ?? "Team unavailable"}
                      />
                    </GovernanceTd>
                    <GovernanceTd>
                      <GovernanceCell
                        primary={item.buLabel ?? "Business unit unavailable"}
                        secondary={item.groupLabel}
                      />
                    </GovernanceTd>
                    <GovernanceTd>
                      <GovernanceCell
                        primary={item.workspaceLabel ?? "No specific workspace context"}
                        secondary={formatGovernanceEnvironment(item.environment)}
                      />
                    </GovernanceTd>
                    <GovernanceTd>
                      <GovernanceCell
                        primary={item.rights.join(" · ") || "Rights unavailable"}
                        secondary={item.scopeLabel}
                      />
                      <span className="mt-1 block text-xs text-amber-900">
                        May apply across workspaces through group grants.
                      </span>
                    </GovernanceTd>
                    <GovernanceTd>{item.reviewerLabel}</GovernanceTd>
                    <GovernanceTd>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setDraft((d) => ({
                            ...d,
                            selected: d.selected.filter((_x, i) => i !== index),
                          }))
                        }
                      >
                        Remove
                      </Button>
                    </GovernanceTd>
                  </tr>
                ))}
              </tbody>
            </GovernanceTableScroll>
          </GovernancePanel>
        )}
      </fieldset>
      {create.isError && (
        <p role="alert" className="mt-3 text-sm text-amber-900">
          The campaign result is uncertain. Retry the unchanged saved campaign with the same request
          key.
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-600">
          Up to 200 current memberships. Each row uses the verified snapshot hash and a reviewer
          distinct from the campaign creator and member.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            className="bg-[#caa33e] text-slate-950 hover:bg-[#b8912f]"
            disabled={
              create.isPending ||
              !draft.name.trim() ||
              !draft.dueAt ||
              !draft.selected.length ||
              draft.selected.length > 200
            }
            onClick={() => create.mutate()}
          >
            <Plus className="mr-2 h-4 w-4" />
            {create.isError ? "Retry same campaign" : `Create campaign · ${draft.selected.length}`}
          </Button>
        </div>
      </div>
    </section>
  );
}
