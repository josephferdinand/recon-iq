import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Eye, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  GovernanceDetailPanel,
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
  getGovernanceIntentKey,
  readGovernanceIntentDraft,
  storeGovernanceIntentDraft,
  useGovernanceFilters,
} from "@/components/governance-review-detail";
import {
  decideGovernanceMembershipRequest,
  getGovernanceMembershipRequest,
  listGovernanceMembershipRequests,
  listGovernanceMembershipOptions,
  submitGovernanceMembershipRequest,
  withdrawGovernanceMembershipRequest,
  type GovernanceMembershipDetail,
  type GovernanceMembershipOptions,
  type GovernanceMembershipRequest,
} from "@/lib/governance-membership.functions";

const statusLabels: Record<string, string> = {
  pending: "Awaiting review",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export function GovernanceMembershipRequests({ tenantId }: { tenantId: string }) {
  return <GovernanceMembershipApprovals key={tenantId} tenantId={tenantId} requesterOnly />;
}

export function GovernanceMembershipApprovals({
  tenantId,
  requesterOnly = false,
}: {
  tenantId: string;
  requesterOnly?: boolean;
}) {
  const client = useQueryClient();
  const listFn = useServerFn(listGovernanceMembershipRequests);
  const optionsFn = useServerFn(listGovernanceMembershipOptions);
  const getFn = useServerFn(getGovernanceMembershipRequest);
  const decideFn = useServerFn(decideGovernanceMembershipRequest);
  const { filters, page, setPage, search, setSearch, environment, setEnvironment } =
    useGovernanceFilters();
  const [status, setStatus] = useState("all");
  const [businessUnit, setBusinessUnit] = useState<MembershipOption | null>(null);
  const [selected, setSelected] = useState<GovernanceMembershipDetail | null>(null);
  const [reason, setReason] = useState("");
  const input = {
    tenant_id: tenantId,
    page,
    page_size: 10,
    search: filters.search,
    ...(requesterOnly ? { own_only: true } : {}),
    ...(status !== "all"
      ? { status: status as "pending" | "approved" | "rejected" | "withdrawn" }
      : {}),
    ...(businessUnit?.id ? { bu_id: businessUnit.id } : {}),
    ...(environment !== "all"
      ? { environment: environment.toLowerCase() as "prod" | "dev" | "sandbox" | "uat" }
      : {}),
  };
  const query = useQuery({
    queryKey: ["governance-membership-requests", input],
    queryFn: () => listFn({ data: input }),
  });
  const registeredEnvironments = useQuery({
    queryKey: ["governance-membership-options", tenantId, "environment"],
    queryFn: () =>
      optionsFn({
        data: { tenant_id: tenantId, kind: "environment", page: 1, page_size: 100, search: "" },
      }),
  });
  const detailQuery = useMutation({
    mutationFn: (requestId: string) =>
      getFn({ data: { tenant_id: tenantId, request_id: requestId } }),
    onSuccess: (record) => {
      setSelected(record);
      setReason(readGovernanceIntentDraft<string>(`membership-decision-${record.id}`) ?? "");
    },
  });
  const decision = useMutation({
    mutationFn: ({
      request,
      choice,
      note,
    }: {
      request: GovernanceMembershipDetail;
      choice: "approve" | "reject";
      note: string;
    }) => {
      const intent = {
        tenant_id: tenantId,
        request_id: request.id,
        expected_version: request.version,
        decision: choice,
        reason: note.trim(),
      };
      const request_key = getGovernanceIntentKey(`membership-decision-${request.id}`, intent);
      return decideFn({ data: { ...intent, request_key } });
    },
    onSuccess: async (result, variables) => {
      const intent = {
        tenant_id: tenantId,
        request_id: variables.request.id,
        expected_version: variables.request.version,
        decision: variables.choice,
        reason: variables.note.trim(),
      };
      clearGovernanceIntentKey(`membership-decision-${variables.request.id}`, intent);
      clearGovernanceIntentDraft(`membership-decision-${variables.request.id}`);
      toast.success(
        result.outcome === "grant_confirmed"
          ? "Membership approved and the reviewed grant was confirmed."
          : result.outcome === "no_access_granted"
            ? "Request rejected; no membership was granted."
            : "Decision recorded.",
      );
      setSelected(null);
      setReason("");
      await client.invalidateQueries({ queryKey: ["governance-membership-requests"] });
      await client.invalidateQueries({ queryKey: ["governance-audit-trail"] });
    },
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? `${error.message} Retry the unchanged decision to reuse its request key.`
          : "The membership decision was not recorded.",
      ),
  });

  const kpis = query.data?.kpis;
  const rows = query.data?.rows ?? [];
  const canReview = !requesterOnly && query.data?.permissions.can_review_queue === true;
  const canSubmit = query.data?.permissions.can_submit === true;
  return (
    <>
      {query.isPending ? (
        <GovernanceLoading label="membership requests" />
      ) : query.isError ? (
        <GovernanceError
          message={
            query.error instanceof Error
              ? query.error.message
              : "The membership request query failed."
          }
          onRetry={() => void query.refetch()}
        />
      ) : !canReview ? (
        <WorkspaceMembershipState
          key={tenantId}
          tenantId={tenantId}
          canSubmit={canSubmit}
          rows={rows}
          page={query.data.page}
          pageSize={query.data.page_size}
          total={query.data.total}
          onPage={setPage}
        />
      ) : (
        <>
          <GovernanceSummaryCards
            items={[
              {
                label: "Awaiting decision",
                value: kpis?.awaiting_decision ?? 0,
                hint: "Tenant administrator queue",
              },
              {
                label: "Approved · last 7 days",
                value: kpis?.approved_last_7_days ?? 0,
                hint: "Confirmed membership grants",
                tone: "good",
              },
              {
                label: "Independent checker needed",
                value: kpis?.independent_checker_needed ?? 0,
                hint: "Requester cannot approve self",
                tone: kpis?.independent_checker_needed ? "warning" : "default",
              },
              {
                label: "Rejected or withdrawn",
                value: kpis?.rejected_or_withdrawn ?? 0,
                hint: "No new access granted",
              },
            ]}
          />
          <GovernancePanel label="Membership approvals queue">
            <GovernanceToolbar
              search={search}
              onSearch={(value) => {
                setSearch(value);
                setPage(1);
              }}
              environment={environment}
              onEnvironment={(value) => {
                setEnvironment(value);
                setPage(1);
              }}
              environmentValues={(registeredEnvironments.data?.rows ?? []).flatMap((row) =>
                row.environment ? [row.environment.toUpperCase()] : [],
              )}
            >
              <MembershipOptionPicker
                tenantId={tenantId}
                kind="bu"
                label="Business unit"
                compact
                allowClear
                value={businessUnit}
                onChange={(value) => {
                  setBusinessUnit(value);
                  setPage(1);
                }}
              />
              <label className="sr-only" htmlFor="membership-status">
                Decision status
              </label>
              <select
                id="membership-status"
                aria-label="Decision status"
                className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">All statuses</option>
                <option value="pending">Awaiting review</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="withdrawn">Withdrawn</option>
              </select>
            </GovernanceToolbar>
            {rows.length === 0 ? (
              <GovernanceEmpty
                title="No membership requests found"
                detail="No records match this tenant and filter selection."
              />
            ) : (
              <>
                <GovernanceTableScroll label="Membership approvals; scroll horizontally for more columns">
                  <GovernanceTableHead>
                    <GovernanceTh>Request / requester</GovernanceTh>
                    <GovernanceTh>Requested at · IST</GovernanceTh>
                    <GovernanceTh>Team / business unit</GovernanceTh>
                    <GovernanceTh>Workspace / environment</GovernanceTh>
                    <GovernanceTh>Group / requested rights</GovernanceTh>
                    <GovernanceTh>Approver / decision time</GovernanceTh>
                    <GovernanceTh>Status</GovernanceTh>
                    <GovernanceTh>Action</GovernanceTh>
                  </GovernanceTableHead>
                  <tbody>
                    {rows.map((row: GovernanceMembershipRequest) => (
                      <tr key={row.id} className="hover:bg-slate-50">
                        <GovernanceTd>
                          <GovernanceCell
                            primary={row.id}
                            secondary={row.requester_name ?? "Requester identity unavailable"}
                          />
                        </GovernanceTd>
                        <GovernanceTd>{formatGovernanceTime(row.requested_at)}</GovernanceTd>
                        <GovernanceTd>
                          <GovernanceCell
                            primary={row.team_name ?? "Team unavailable"}
                            secondary={row.bu_name ?? "Business unit unavailable"}
                          />
                        </GovernanceTd>
                        <GovernanceTd>
                          <GovernanceCell
                            primary={row.workspace_name ?? "Workspace unavailable"}
                            secondary={row.environment.toUpperCase()}
                          />
                        </GovernanceTd>
                        <GovernanceTd>
                          <GovernanceCell
                            primary={row.group_name ?? "Group unavailable"}
                            secondary={row.requested_rights.join(" · ") || "Rights unavailable"}
                          />
                        </GovernanceTd>
                        <GovernanceTd>
                          <GovernanceCell
                            primary={
                              row.approver_name ??
                              (row.decided_at
                                ? "Approver identity unavailable"
                                : "Awaiting independent admin")
                            }
                            secondary={
                              row.decided_at
                                ? formatGovernanceTime(row.decided_at)
                                : "No decision recorded"
                            }
                          />
                        </GovernanceTd>
                        <GovernanceTd>
                          <GovernanceStatus value={statusLabels[row.status] ?? row.status} />
                          <div className="mt-1 text-xs text-slate-600">Request v{row.version}</div>
                        </GovernanceTd>
                        <GovernanceTd>
                          <Button
                            size="sm"
                            className="bg-[#caa33e] text-slate-950 hover:bg-[#b8912f]"
                            onClick={() => detailQuery.mutate(row.id)}
                          >
                            <Eye className="mr-1 h-4 w-4" />
                            {row.status === "pending" ? "Review" : "View"}
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
          <GovernanceFootnote>
            Membership applies to the tenant group. Group resource grants may make effective
            permissions available across workspaces; inspect the scope snapshot before approving.
            Only a distinct, currently active tenant administrator can decide. Tenant administrators
            create business units and groups.
          </GovernanceFootnote>
        </>
      )}
      {!selected && detailQuery.isPending && (
        <GovernanceLoading label="current membership details" />
      )}
      {!selected && detailQuery.isError && (
        <GovernanceError
          message={
            detailQuery.error instanceof Error
              ? detailQuery.error.message
              : "Membership details could not be loaded."
          }
          onRetry={() => detailQuery.variables && detailQuery.mutate(detailQuery.variables)}
        />
      )}
      {selected && (
        <GovernanceDetailPanel title="Membership request review" onClose={() => setSelected(null)}>
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {[
              ["Requester", selected.requester_name ?? "Requester identity unavailable"],
              [
                "Team / business unit",
                `${selected.team_name ?? "Team unavailable"} / ${selected.bu_name ?? "BU unavailable"}`,
              ],
              [
                "Workspace / environment",
                `${selected.workspace_name ?? "Workspace unavailable"} / ${selected.environment.toUpperCase()}`,
              ],
              ["Group", selected.group_name ?? "Group unavailable"],
              ["Requested rights", selected.requested_rights.join(" · ") || "Rights unavailable"],
              ["Effective scope", selected.scope_label],
              [
                "Current group resource grants",
                selected.effective_scope.data_resource_grants.length
                  ? `${selected.effective_scope.data_resource_grants.length} scoped resource grants`
                  : "No additional resource grants recorded",
              ],
              [
                "Current role assignments",
                selected.effective_scope.roles.length
                  ? `${selected.effective_scope.roles.length} role assignments in snapshot`
                  : "No role assignments recorded",
              ],
              ["Version", `Request v${selected.version}`],
              ["Request reason", selected.request_reason],
              ["Previous decision reason", selected.decision_reason ?? "No decision recorded"],
              ["Correlation ID", selected.correlation_id],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs font-medium text-slate-600">{label}</dt>
                <dd className="mt-1 break-words text-sm text-slate-950">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            <ShieldCheck className="mr-2 inline h-4 w-4" />
            The requested group can affect resources in other workspaces. Approval does not create a
            workspace-only grant. Read the full effective group, role, BU and resource scope before
            deciding.
          </div>
          <GovernanceEffectiveScope scope={selected.effective_scope} />
          {selected.history.length > 0 && (
            <section className="mt-5">
              <h3 className="text-sm font-semibold text-slate-950">Decision history</h3>
              <ol className="mt-2 space-y-2">
                {selected.history.map((event) => (
                  <li
                    key={`${event.id}-${event.version}`}
                    className="rounded border border-slate-200 p-3 text-sm"
                  >
                    <div className="font-medium text-slate-900">
                      {event.action} · {event.outcome} · v{event.version}
                    </div>
                    <div className="mt-1 text-xs text-slate-600">
                      {formatGovernanceTime(event.occurred_at)} · {event.reason}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}
          <label className="mt-5 block text-sm font-medium" htmlFor="membership-decision-reason">
            Decision reason
          </label>
          <textarea
            id="membership-decision-reason"
            readOnly={decision.isPending || decision.isError}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              storeGovernanceIntentDraft(`membership-decision-${selected.id}`, event.target.value);
            }}
            maxLength={2000}
            rows={3}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white p-3 text-sm text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
            placeholder="Explain the decision and its exact group scope."
          />
          <div className="mt-4 flex justify-end gap-2">
            {selected.permissions.can_reject && (
              <Button
                variant="outline"
                disabled={decision.isPending || !reason.trim()}
                onClick={() =>
                  decision.mutate({ request: selected, choice: "reject", note: reason })
                }
              >
                Reject request
              </Button>
            )}
            {selected.permissions.can_approve && (
              <Button
                className="bg-[#caa33e] text-slate-950 hover:bg-[#b8912f]"
                disabled={decision.isPending || !reason.trim()}
                onClick={() =>
                  decision.mutate({ request: selected, choice: "approve", note: reason })
                }
              >
                <ShieldCheck className="mr-2 h-4 w-4" />
                Approve request
              </Button>
            )}
          </div>
          {detailQuery.isPending && (
            <p role="status" className="mt-3 text-sm text-slate-600">
              Loading current request and permission scope…
            </p>
          )}
          {detailQuery.isError && (
            <p role="alert" className="mt-3 text-sm text-red-800">
              {detailQuery.error instanceof Error
                ? detailQuery.error.message
                : "The current request could not be loaded."}
            </p>
          )}
        </GovernanceDetailPanel>
      )}
    </>
  );
}

type MembershipOption = GovernanceMembershipOptions["rows"][number];
type MembershipOptionKind = "bu" | "workspace" | "group" | "environment";

function MembershipOptionPicker({
  tenantId,
  kind,
  label,
  value,
  onChange,
  buId,
  workspaceId,
  environment,
  valueKey = "id",
  disabled = false,
  compact = false,
  allowClear = false,
}: {
  tenantId: string;
  kind: MembershipOptionKind;
  label: string;
  value: MembershipOption | null;
  onChange: (value: MembershipOption | null) => void;
  buId?: string;
  workspaceId?: string;
  environment?: string;
  valueKey?: "id" | "environment";
  disabled?: boolean;
  compact?: boolean;
  allowClear?: boolean;
}) {
  const listFn = useServerFn(listGovernanceMembershipOptions);
  const listId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    setPage(1);
    setSearch("");
    setOpen(false);
  }, [tenantId, buId, workspaceId, environment]);
  const enabled =
    !disabled &&
    ((kind !== "workspace" && kind !== "group") || !!buId) &&
    (kind !== "group" || !!workspaceId);
  const args = {
    tenant_id: tenantId,
    kind,
    page,
    page_size: 25,
    search: search.trim(),
    ...(buId ? { bu_id: buId } : {}),
    ...(workspaceId ? { workspace_id: workspaceId } : {}),
    ...(environment ? { environment: environment as "prod" | "dev" | "sandbox" | "uat" } : {}),
  };
  const query = useQuery({
    queryKey: ["governance-membership-options", args],
    queryFn: () => listFn({ data: args }),
    enabled,
  });
  const shown = value ? (value.label ?? value.environment ?? value.id) : null;
  return (
    <div
      className={compact ? "relative w-48" : "relative min-w-48 flex-1"}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <label className={compact ? "sr-only" : "mb-1 block text-xs font-medium text-slate-700"}>
        {label}
      </label>
      <button
        type="button"
        role="combobox"
        ref={trigger}
        aria-controls={listId}
        aria-expanded={open}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
        aria-label={label}
        disabled={!enabled}
        onClick={() => setOpen((current) => !current)}
        className="flex h-10 w-full items-center justify-between rounded-md border border-slate-300 bg-white px-3 text-left text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 disabled:bg-slate-100 disabled:text-slate-500"
      >
        <span className="truncate">
          {shown ??
            (enabled
              ? allowClear
                ? "All business units"
                : `Choose ${label.toLowerCase()}`
              : "Select the preceding scope first")}
        </span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div
          className="absolute z-30 mt-1 w-full min-w-64 rounded-md border border-slate-300 bg-white p-2 shadow-lg"
          role="region"
          aria-label={`${label} choices`}
        >
          <Input
            maxLength={200}
            aria-label={`Search ${label}`}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder={`Search ${label.toLowerCase()}`}
            autoFocus
          />
          {allowClear && (
            <button
              type="button"
              className="mt-1 w-full rounded px-3 py-2 text-left text-sm hover:bg-slate-100"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              All business units
            </button>
          )}
          {query.isPending ? (
            <p role="status" className="p-3 text-sm text-slate-600">
              Loading named options…
            </p>
          ) : query.isError ? (
            <p role="alert" className="p-3 text-sm text-red-800">
              {query.error instanceof Error
                ? query.error.message
                : `Could not load ${label.toLowerCase()} options.`}
            </p>
          ) : query.data.rows.length === 0 ? (
            <p className="p-3 text-sm text-slate-600">No matching authorized options.</p>
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
                  disabled={option.selectable === false}
                  onClick={() => {
                    onChange(option);
                    setOpen(false);
                  }}
                  className="block w-full rounded px-3 py-2 text-left text-sm hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 disabled:opacity-50"
                >
                  <span className="block font-medium">
                    {option.label ?? option.environment ?? option.id}
                  </span>
                  {option.description && (
                    <span className="mt-1 block text-xs text-slate-600">{option.description}</span>
                  )}
                  {option.scope_label && (
                    <span className="mt-1 block text-xs text-amber-900">{option.scope_label}</span>
                  )}
                  {option.requested_rights?.length ? (
                    <span className="mt-1 block text-xs text-slate-600">
                      Effective rights: {option.requested_rights.join(" · ")}
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
                  disabled={!query.data.has_more}
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

type RequestDraft = {
  bu: MembershipOption | null;
  environment: MembershipOption | null;
  workspace: MembershipOption | null;
  group: MembershipOption | null;
  reason: string;
};
const emptyRequestDraft: RequestDraft = {
  bu: null,
  environment: null,
  workspace: null,
  group: null,
  reason: "",
};
function readRequestDraft(tenantId: string): RequestDraft {
  try {
    return {
      ...emptyRequestDraft,
      ...(JSON.parse(
        sessionStorage.getItem(`fvi-membership-request-draft:${tenantId}`) ?? "{}",
      ) as Partial<RequestDraft>),
    };
  } catch {
    return emptyRequestDraft;
  }
}

function MembershipRequestForm({ tenantId }: { tenantId: string }) {
  const client = useQueryClient();
  const submitFn = useServerFn(submitGovernanceMembershipRequest);
  const [draft, setDraft] = useState<RequestDraft>(() =>
    typeof window === "undefined" ? emptyRequestDraft : readRequestDraft(tenantId),
  );
  useEffect(() => {
    sessionStorage.setItem(`fvi-membership-request-draft:${tenantId}`, JSON.stringify(draft));
  }, [draft, tenantId]);
  const submit = useMutation({
    mutationFn: () => {
      if (
        !draft.bu?.id ||
        !draft.environment?.environment ||
        !draft.workspace?.id ||
        !draft.group?.id ||
        draft.group.selectable === false ||
        !draft.reason.trim()
      )
        throw new Error(
          "Select a valid business unit, registered environment, associated workspace and eligible group, then provide a reason.",
        );
      const intent = {
        tenant_id: tenantId,
        bu_id: draft.bu.id,
        workspace_id: draft.workspace.id,
        group_id: draft.group.id,
        environment: draft.environment.environment.toLowerCase() as
          | "prod"
          | "dev"
          | "sandbox"
          | "uat",
        reason: draft.reason.trim(),
      };
      const request_key = getGovernanceIntentKey(`membership-submit-${tenantId}`, intent);
      return submitFn({ data: { ...intent, request_key } });
    },
    onSuccess: async (result) => {
      const intent = {
        tenant_id: tenantId,
        bu_id: draft.bu!.id,
        workspace_id: draft.workspace!.id,
        group_id: draft.group!.id,
        environment: draft.environment!.environment!.toLowerCase(),
        reason: draft.reason.trim(),
      };
      clearGovernanceIntentKey(`membership-submit-${tenantId}`, intent);
      sessionStorage.removeItem(`fvi-membership-request-draft:${tenantId}`);
      setDraft(emptyRequestDraft);
      toast.success(
        `Request ${result.id.slice(0, 8)} submitted. It is awaiting an independent tenant administrator.`,
      );
      await client.invalidateQueries({ queryKey: ["governance-membership-requests"] });
    },
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? `${error.message} If the result is uncertain, retry these exact details to safely replay the same request.`
          : "Membership request was not submitted; retry with the same details.",
      ),
  });
  return (
    <GovernancePanel label="Request group membership">
      <div className="border-b border-slate-200 p-4">
        <h2 className="text-lg font-semibold text-slate-950">Request group access</h2>
        <p className="mt-1 text-sm text-slate-600">
          Your signed-in account is the requester. Choose only an existing, currently authorized
          scope.
        </p>
      </div>
      <div className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MembershipOptionPicker
            tenantId={tenantId}
            kind="bu"
            label="Business unit"
            value={draft.bu}
            onChange={(bu) => setDraft((d) => ({ ...d, bu, workspace: null, group: null }))}
            disabled={submit.isError || submit.isPending}
          />
          <MembershipOptionPicker
            tenantId={tenantId}
            kind="environment"
            label="Registered environment"
            value={draft.environment}
            valueKey="environment"
            buId={draft.bu?.id}
            onChange={(environment) =>
              setDraft((d) => ({ ...d, environment, workspace: null, group: null }))
            }
            disabled={!draft.bu || submit.isError || submit.isPending}
          />
          <MembershipOptionPicker
            tenantId={tenantId}
            kind="workspace"
            label="Workspace"
            value={draft.workspace}
            buId={draft.bu?.id}
            environment={draft.environment?.environment}
            onChange={(workspace) => setDraft((d) => ({ ...d, workspace, group: null }))}
            disabled={!draft.bu || !draft.environment || submit.isError || submit.isPending}
          />
          <MembershipOptionPicker
            tenantId={tenantId}
            kind="group"
            label="Group"
            value={draft.group}
            buId={draft.bu?.id}
            workspaceId={draft.workspace?.id}
            environment={draft.environment?.environment}
            onChange={(group) => setDraft((d) => ({ ...d, group }))}
            disabled={
              !draft.bu ||
              !draft.workspace ||
              !draft.environment ||
              submit.isError ||
              submit.isPending
            }
          />
        </div>
        {draft.group && (
          <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4">
            <p className="font-medium text-slate-950">Effective group scope</p>
            <p className="mt-1 text-sm text-slate-800">
              {draft.group.scope_label ?? "Scope details unavailable"}
            </p>
            <p className="mt-2 text-sm text-slate-800">
              Requested rights: {draft.group.requested_rights?.join(" · ") || "Rights unavailable"}
            </p>
            <p className="mt-2 text-xs text-amber-950">
              Tenant group membership; existing group rights can apply across workspaces. The
              workspace is request context and does not restrict the group’s effective grants.
            </p>
          </div>
        )}
        <label
          htmlFor="membership-request-reason"
          className="mt-4 block text-sm font-medium text-slate-900"
        >
          Why do you need this access?
        </label>
        <textarea
          id="membership-request-reason"
          value={draft.reason}
          onChange={(event) => setDraft((d) => ({ ...d, reason: event.target.value }))}
          maxLength={2000}
          rows={3}
          disabled={submit.isError || submit.isPending}
          className="mt-1 w-full rounded-md border border-slate-300 bg-white p-3 text-sm text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 disabled:bg-slate-100"
          placeholder="Describe the work that requires these group rights."
        />
        {submit.isError && (
          <p role="alert" className="mt-3 text-sm text-amber-900">
            The result is uncertain. Review the saved details above and retry unchanged to reuse the
            same request key.
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-600">
            Requests are versioned and idempotent. Retrying an uncertain result reuses the same
            request key.
          </p>
          <Button
            className="bg-[#caa33e] text-slate-950 hover:bg-[#b8912f]"
            disabled={
              submit.isPending ||
              !draft.bu ||
              !draft.environment?.environment ||
              !draft.workspace ||
              !draft.group ||
              draft.group.selectable === false ||
              !draft.reason.trim()
            }
            onClick={() => submit.mutate()}
          >
            {submit.isError ? "Retry same request" : "Submit membership request"}
          </Button>
        </div>
      </div>
    </GovernancePanel>
  );
}

function WorkspaceMembershipState({
  tenantId,
  canSubmit,
  rows,
  page,
  pageSize,
  total,
  onPage,
}: {
  tenantId: string;
  canSubmit: boolean;
  rows: GovernanceMembershipRequest[];
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const client = useQueryClient();
  const getFn = useServerFn(getGovernanceMembershipRequest);
  const withdrawFn = useServerFn(withdrawGovernanceMembershipRequest);
  const [selected, setSelected] = useState<GovernanceMembershipDetail | null>(null);
  const [reason, setReason] = useState("");
  const getDetail = useMutation({
    mutationFn: (id: string) => getFn({ data: { tenant_id: tenantId, request_id: id } }),
    onSuccess: (row) => {
      setSelected(row);
      setReason(readGovernanceIntentDraft<string>(`membership-withdraw-${row.id}`) ?? "");
    },
  });
  const withdraw = useMutation({
    mutationFn: () => {
      if (!selected || !reason.trim()) throw new Error("A withdrawal reason is required.");
      const intent = {
        tenant_id: tenantId,
        request_id: selected.id,
        expected_version: selected.version,
        reason: reason.trim(),
      };
      const request_key = getGovernanceIntentKey(`membership-withdraw-${selected.id}`, intent);
      return withdrawFn({ data: { ...intent, request_key } });
    },
    onSuccess: async (result) => {
      const intent = {
        tenant_id: tenantId,
        request_id: selected!.id,
        expected_version: selected!.version,
        reason: reason.trim(),
      };
      clearGovernanceIntentKey(`membership-withdraw-${selected!.id}`, intent);
      clearGovernanceIntentDraft(`membership-withdraw-${selected!.id}`);
      toast.success(`Request ${result.id.slice(0, 8)} withdrawn.`);
      setSelected(null);
      await client.invalidateQueries({ queryKey: ["governance-membership-requests"] });
      await client.invalidateQueries({ queryKey: ["governance-audit-trail"] });
    },
    onError: (error) =>
      toast.error(
        error instanceof Error
          ? `${error.message} Retry with the same reason to replay safely.`
          : "Withdrawal outcome is uncertain; retry with the same reason.",
      ),
  });
  return (
    <div className="space-y-4">
      {canSubmit && <MembershipRequestForm tenantId={tenantId} />}
      <GovernancePanel label="My membership requests">
        <div className="border-b border-slate-200 p-4">
          <h2 className="font-semibold text-slate-950">Your requests</h2>
          <p className="mt-1 text-sm text-slate-600">
            Only your own requests appear here. A tenant administrator reviews each request;
            submission does not grant access.
          </p>
        </div>
        {rows.length ? (
          <>
            <GovernanceTableScroll label="Your membership requests">
              <GovernanceTableHead>
                <GovernanceTh>Request / reason</GovernanceTh>
                <GovernanceTh>Requested at · IST</GovernanceTh>
                <GovernanceTh>Business unit / group</GovernanceTh>
                <GovernanceTh>Workspace / environment</GovernanceTh>
                <GovernanceTh>Effective rights and scope</GovernanceTh>
                <GovernanceTh>Approver / outcome</GovernanceTh>
                <GovernanceTh>Status</GovernanceTh>
                <GovernanceTh>Action</GovernanceTh>
              </GovernanceTableHead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <GovernanceTd>
                      <GovernanceCell primary={row.id} secondary={row.request_reason} />
                    </GovernanceTd>
                    <GovernanceTd>{formatGovernanceTime(row.requested_at)}</GovernanceTd>
                    <GovernanceTd>
                      <GovernanceCell
                        primary={row.bu_name ?? row.bu_id}
                        secondary={row.group_name ?? row.group_id}
                      />
                    </GovernanceTd>
                    <GovernanceTd>
                      <GovernanceCell
                        primary={row.workspace_name ?? row.workspace_id}
                        secondary={row.environment.toUpperCase()}
                      />
                    </GovernanceTd>
                    <GovernanceTd>
                      <GovernanceCell
                        primary={row.requested_rights.join(" · ") || "Rights unavailable"}
                        secondary={row.scope_snapshot.scope_label}
                      />
                    </GovernanceTd>
                    <GovernanceTd>
                      <GovernanceCell
                        primary={
                          row.approver_name ??
                          (row.decided_at
                            ? "Approver identity unavailable"
                            : "Awaiting independent tenant admin")
                        }
                        secondary={
                          row.decided_at
                            ? formatGovernanceTime(row.decided_at)
                            : "No decision recorded"
                        }
                      />
                    </GovernanceTd>
                    <GovernanceTd>
                      <GovernanceStatus value={statusLabels[row.status] ?? row.status} />
                    </GovernanceTd>
                    <GovernanceTd>
                      <Button
                        size="sm"
                        className="bg-[#caa33e] text-slate-950 hover:bg-[#b8912f]"
                        onClick={() => getDetail.mutate(row.id)}
                      >
                        Details{row.status === "pending" ? " · Withdraw" : ""}
                      </Button>
                    </GovernanceTd>
                  </tr>
                ))}
              </tbody>
            </GovernanceTableScroll>
            <GovernancePagination page={page} pageSize={pageSize} total={total} onPage={onPage} />
          </>
        ) : (
          <GovernanceEmpty
            title="No membership requests"
            detail="Your current tenant scope has no request records."
          />
        )}
      </GovernancePanel>
      {!canSubmit && (
        <p
          role="status"
          className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700"
        >
          Request submission is not available with your current tenant permissions.
        </p>
      )}
      {!selected && getDetail.isPending && <GovernanceLoading label="your request details" />}
      {!selected && getDetail.isError && (
        <GovernanceError
          message={
            getDetail.error instanceof Error
              ? getDetail.error.message
              : "Request details could not be loaded."
          }
          onRetry={() => getDetail.variables && getDetail.mutate(getDetail.variables)}
        />
      )}
      {selected && (
        <GovernanceDetailPanel title="Your membership request" onClose={() => setSelected(null)}>
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {[
              ["Status", statusLabels[selected.status] ?? selected.status],
              ["Requested at", formatGovernanceTime(selected.requested_at)],
              ["Business unit", selected.bu_name ?? selected.bu_id],
              [
                "Workspace / environment",
                `${selected.workspace_name ?? selected.workspace_id} / ${selected.environment.toUpperCase()}`,
              ],
              ["Group", selected.group_name ?? selected.group_id],
              ["Requested rights", selected.requested_rights.join(" · ") || "Rights unavailable"],
              ["Effective scope", selected.scope_label],
              ["Reason", selected.request_reason],
              ["Decision reason", selected.decision_reason ?? "No decision recorded"],
              ["Version / correlation", `v${selected.version} · ${selected.correlation_id}`],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs font-medium text-slate-600">{label}</dt>
                <dd className="mt-1 break-words text-sm text-slate-950">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
            Tenant group membership; existing group rights can apply across workspaces. Workspace
            selection records context only.
          </div>
          <GovernanceEffectiveScope scope={selected.effective_scope} />
          {selected.history.length > 0 && (
            <section className="mt-5">
              <h3 className="text-sm font-semibold">Request history</h3>
              <ol className="mt-2 space-y-2">
                {selected.history.map((event) => (
                  <li
                    key={`${event.id}-${event.version}`}
                    className="rounded border border-slate-200 p-3 text-sm"
                  >
                    <strong>
                      {event.action} · {event.outcome} · v{event.version}
                    </strong>
                    <div className="mt-1 text-xs text-slate-600">
                      {formatGovernanceTime(event.occurred_at)} · {event.reason}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {selected.permissions.can_withdraw && selected.status === "pending" && (
            <div className="mt-5">
              <label htmlFor="membership-withdraw-reason" className="block text-sm font-medium">
                Withdrawal reason
              </label>
              <textarea
                id="membership-withdraw-reason"
                readOnly={withdraw.isPending || withdraw.isError}
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  storeGovernanceIntentDraft(
                    `membership-withdraw-${selected.id}`,
                    event.target.value,
                  );
                }}
                rows={3}
                maxLength={2000}
                className="mt-1 w-full rounded-md border border-slate-300 p-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
              />
              <div className="mt-3 flex justify-end">
                <Button
                  variant="outline"
                  disabled={!reason.trim() || withdraw.isPending}
                  onClick={() => withdraw.mutate()}
                >
                  Withdraw request
                </Button>
              </div>
            </div>
          )}
          {getDetail.isPending && <p role="status">Refreshing request details…</p>}
          {getDetail.isError && (
            <p role="alert" className="mt-3 text-sm text-red-800">
              {getDetail.error instanceof Error
                ? getDetail.error.message
                : "The request detail could not be loaded."}
            </p>
          )}
        </GovernanceDetailPanel>
      )}
    </div>
  );
}
