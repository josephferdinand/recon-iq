import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Eye } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { GovernanceDetailPanel } from "@/components/governance-review-detail";
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
  formatGovernanceTime,
  formatGovernanceEnvironment,
  useGovernanceFilters,
} from "@/components/governance-review-detail";
import {
  getGovernanceAuditEvent,
  listGovernanceAuditTrail,
  GOVERNANCE_AUDIT_ACTIONS,
} from "@/lib/governance-audit.functions";

const csvField = (value: unknown) => {
  let text = value == null ? "" : String(value);
  if (/^[\s]*[=+@-]/u.test(text) || /^[\t\r]/u.test(text)) text = `'${text}`;
  return `"${text.replace(/"/gu, '""')}"`;
};
const csvText = (rows: Array<Record<string, unknown>>) => {
  const columns = [
    "occurred_at",
    "request_id",
    "review_id",
    "actor_name",
    "actor_role",
    "team_name",
    "scope_label",
    "environment",
    "action",
    "outcome",
    "reason",
    "version",
    "id",
    "correlation_id",
  ];
  return [
    columns.map(csvField).join(","),
    ...rows.map((row) => columns.map((column) => csvField(row[column])).join(",")),
  ].join("\r\n");
};

export function GovernanceAuditTrail({ tenantId }: { tenantId: string }) {
  const listFn = useServerFn(listGovernanceAuditTrail);
  const getFn = useServerFn(getGovernanceAuditEvent);
  const { page, setPage, search, setSearch } = useGovernanceFilters();
  const [action, setAction] = useState("all");
  const [outcome, setOutcome] = useState("all");
  const [days, setDays] = useState("7");
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);
  const [detailError, setDetailError] = useState("");
  const { from, to } = useMemo(() => {
    const end = Date.now();
    return {
      to: new Date(end).toISOString(),
      from: new Date(end - Number(days) * 86_400_000).toISOString(),
    };
  }, [days]);
  const filters = {
    tenant_id: tenantId,
    page,
    page_size: 10,
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(action !== "all" ? { action: action as (typeof GOVERNANCE_AUDIT_ACTIONS)[number] } : {}),
    ...(outcome !== "all"
      ? { outcome: outcome as "success" | "denied" | "failed" | "pending" }
      : {}),
    from,
    to,
  };
  const query = useQuery({
    queryKey: ["governance-audit-trail", filters],
    queryFn: () => listFn({ data: filters }),
  });
  const detail = useMutation({
    mutationFn: (eventId: string) => getFn({ data: { tenant_id: tenantId, event_id: eventId } }),
    onSuccess: (row) => {
      setSelected(row as unknown as Record<string, unknown> | null);
      setDetailError(row ? "" : "This event is no longer available in the current tenant scope.");
    },
    onError: (error) =>
      setDetailError(
        error instanceof Error ? error.message : "The event details could not be loaded.",
      ),
  });
  const exportMutation = useMutation({
    mutationFn: async () => {
      const permission = query.data?.permissions?.export;
      if (permission !== true)
        throw new Error("Your current tenant permissions do not allow audit export.");
      const exportRows: Record<string, unknown>[] = [];
      const exportFilters = {
        tenant_id: tenantId,
        page_size: 100,
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(action !== "all"
          ? { action: action as (typeof GOVERNANCE_AUDIT_ACTIONS)[number] }
          : {}),
        ...(outcome !== "all"
          ? { outcome: outcome as "success" | "denied" | "failed" | "pending" }
          : {}),
        from,
        to,
      };
      let total = 0;
      for (let current = 1; current <= 100; current++) {
        const batch = await listFn({ data: { ...exportFilters, page: current } });
        if (batch.permissions.export !== true)
          throw new Error("Current audit export permission was withdrawn.");
        if (current === 1) total = batch.total;
        else if (batch.total !== total)
          throw new Error("Audit records changed during export. Retry the same filters.");
        exportRows.push(...(batch.rows as unknown as Record<string, unknown>[]));
        if (exportRows.length >= total) break;
      }
      if (new Set(exportRows.map((row) => row.id)).size !== exportRows.length)
        throw new Error("Audit records changed during export. Retry the same filters.");
      if (exportRows.length !== total)
        throw new Error(
          "The authorized audit export exceeded the bounded 10,000-record window. Narrow the filters and try again.",
        );
      return new Blob(["\uFEFF", csvText(exportRows)], { type: "text/csv;charset=utf-8" });
    },
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `reconiq-governance-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success("Authorized audit rows downloaded as CSV.");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Audit export failed."),
  });

  const kpi = query.data?.kpis;
  const rows = query.data?.rows ?? [];
  return (
    <>
      {query.isSuccess && (
        <GovernanceSummaryCards
          items={[
            {
              label: "Events · selected period",
              value: kpi?.total ?? 0,
              hint: `Tenant-scoped · last ${days} days`,
            },
            {
              label: "Membership decisions",
              value: kpi?.membership_decisions ?? 0,
              hint: "Actor and reason retained",
            },
            {
              label: "Access review decisions",
              value: kpi?.access_review_decisions ?? 0,
              hint: "Linked to reviewed snapshots",
            },
            {
              label: "Denied or failed actions",
              value: (kpi?.denied ?? 0) + (kpi?.failed ?? 0),
              hint: "No success inferred",
              tone: (kpi?.denied ?? 0) + (kpi?.failed ?? 0) ? "warning" : "default",
            },
          ]}
        />
      )}
      <GovernancePanel label="Governance audit trail">
        <GovernanceToolbar
          maxSearchLength={120}
          showEnvironment={false}
          searchLabel="Search actor, request, review or correlation ID"
          searchPlaceholder="Search actor, request, review or correlation ID"
          search={search}
          onSearch={(value) => {
            setSearch(value);
            setPage(1);
          }}
        >
          <label className="sr-only" htmlFor="audit-action">
            Audit action
          </label>
          <select
            id="audit-action"
            aria-label="Audit action"
            className="h-10 max-w-56 rounded-md border border-slate-300 bg-white px-3 text-sm"
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              setPage(1);
            }}
          >
            <option value="all">All governance actions</option>
            {GOVERNANCE_AUDIT_ACTIONS.map((name) => (
              <option key={name} value={name}>
                {name.replaceAll(".", " · ")}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="audit-outcome">
            Audit outcome
          </label>
          <select
            id="audit-outcome"
            aria-label="Audit outcome"
            className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
            value={outcome}
            onChange={(event) => {
              setOutcome(event.target.value);
              setPage(1);
            }}
          >
            <option value="all">All outcomes</option>
            <option value="success">Success</option>
            <option value="denied">Denied</option>
            <option value="failed">Failed</option>
            <option value="pending">Pending</option>
          </select>
          <label className="sr-only" htmlFor="audit-period">
            Audit period
          </label>
          <select
            id="audit-period"
            aria-label="Audit period"
            className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
            value={days}
            onChange={(event) => {
              setDays(event.target.value);
              setPage(1);
            }}
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
          <Button
            variant="outline"
            onClick={() => exportMutation.mutate()}
            disabled={exportMutation.isPending || query.data?.permissions?.export !== true}
          >
            <Download className="mr-2 h-4 w-4" />
            {exportMutation.isPending ? "Preparing…" : "Download CSV"}
          </Button>
        </GovernanceToolbar>
        {query.isPending ? (
          <GovernanceLoading label="audit events" />
        ) : query.isError ? (
          <GovernanceError
            message={query.error instanceof Error ? query.error.message : "The audit query failed."}
            onRetry={() => void query.refetch()}
          />
        ) : rows.length === 0 ? (
          <GovernanceEmpty
            title="No governance events found"
            detail="No recorded governance events match this tenant, period and filter selection."
          />
        ) : (
          <>
            <GovernanceTableScroll label="Governance audit events; scroll horizontally for more columns">
              <GovernanceTableHead>
                <GovernanceTh>Event time · IST</GovernanceTh>
                <GovernanceTh>Request / review</GovernanceTh>
                <GovernanceTh>Actor / role</GovernanceTh>
                <GovernanceTh>Team / scope</GovernanceTh>
                <GovernanceTh>Environment</GovernanceTh>
                <GovernanceTh>Action / outcome</GovernanceTh>
                <GovernanceTh>Reason / version</GovernanceTh>
                <GovernanceTh>Audit / correlation ID</GovernanceTh>
                <GovernanceTh>Details</GovernanceTh>
              </GovernanceTableHead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <GovernanceTd>
                      {formatGovernanceTime(row.occurred_at, { second: "2-digit" })}
                    </GovernanceTd>
                    <GovernanceTd>
                      <GovernanceCell
                        primary={row.request_id ?? row.review_id ?? "No linked request"}
                        secondary={
                          row.review_id && row.request_id ? `Review ${row.review_id}` : undefined
                        }
                      />
                    </GovernanceTd>
                    <GovernanceTd>
                      <GovernanceCell
                        primary={row.actor_name ?? "Identity unavailable"}
                        secondary={row.actor_role ?? "Role unavailable"}
                      />
                    </GovernanceTd>
                    <GovernanceTd>
                      <GovernanceCell
                        primary={row.team_name ?? "Team unavailable"}
                        secondary={row.scope_label ?? "Scope unavailable"}
                      />
                    </GovernanceTd>
                    <GovernanceTd>{formatGovernanceEnvironment(row.environment)}</GovernanceTd>
                    <GovernanceTd>
                      <GovernanceCell
                        primary={row.action}
                        secondary={<GovernanceStatus value={row.outcome} />}
                      />
                    </GovernanceTd>
                    <GovernanceTd>
                      <GovernanceCell
                        primary={row.reason ?? "Reason not recorded"}
                        secondary={
                          row.version == null ? "Version unavailable" : `Version ${row.version}`
                        }
                      />
                    </GovernanceTd>
                    <GovernanceTd>
                      <GovernanceCell
                        primary={row.id}
                        secondary={row.correlation_id ?? "Correlation ID unavailable"}
                      />
                    </GovernanceTd>
                    <GovernanceTd>
                      <Button
                        size="sm"
                        className="bg-[#caa33e] text-slate-950 hover:bg-[#b8912f]"
                        onClick={() => {
                          setDetailError("");
                          detail.mutate(row.id);
                        }}
                      >
                        <Eye className="mr-1 h-4 w-4" />
                        View
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
      {query.isSuccess && query.data.permissions.export !== true && (
        <p className="mt-2 text-xs text-slate-600">
          CSV download is disabled because export permission is not confirmed for your current
          tenant scope.
        </p>
      )}
      {query.data?.metrics_consistency === "changed_during_read" && (
        <p role="status" className="mt-3 text-sm text-amber-900">
          Audit events changed while the totals were read. Refresh to read the current totals.
        </p>
      )}
      {!selected && detail.isPending && <GovernanceLoading label="current audit event" />}
      {!selected && detailError && (
        <div
          role="alert"
          className="mt-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900"
        >
          {detailError}
        </div>
      )}
      <GovernanceFootnote>
        Historical fields remain unknown when they were not recorded. UTC event times are displayed
        in IST. An approval decision and its applied access outcome remain separate audit events.
      </GovernanceFootnote>
      {selected && (
        <GovernanceDetailPanel title="Governance audit event" onClose={() => setSelected(null)}>
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {Object.entries(selected)
              .filter(
                ([key, value]) =>
                  !["resource_type", "resource_id"].includes(key) &&
                  value !== null &&
                  typeof value !== "object",
              )
              .map(([key, value]) => (
                <div key={key}>
                  <dt className="text-xs font-medium text-slate-600">{key.replaceAll("_", " ")}</dt>
                  <dd className="mt-1 break-words text-sm text-slate-950">
                    {key === "occurred_at" ? formatGovernanceTime(String(value)) : String(value)}
                  </dd>
                </div>
              ))}
          </dl>
          {detailError && (
            <p role="alert" className="mt-4 text-sm text-red-800">
              {detailError}
            </p>
          )}
          {detail.isPending && (
            <p role="status" className="mt-4 text-sm text-slate-600">
              Loading event details…
            </p>
          )}
        </GovernanceDetailPanel>
      )}
    </>
  );
}
