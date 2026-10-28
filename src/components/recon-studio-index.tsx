import { useRef, useState, type ReactNode } from "react";
import { Check, ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { ReconListPageRow } from "@/lib/recons.functions";
import { reconTypeLabel } from "@/lib/recon-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ResourceIdentitySummary } from "@/components/resource-identity-summary";
import { ResourceActorSummary as ResourceActorSummaryView } from "@/components/resource-actor-summary";
import { FviDetailDialogLayout } from "@/components/fvi-detail-dialog-layout";
import type { ResourceAccessSummary } from "@/lib/resource-access-summaries.functions";
import type { ResourceActorSummary } from "@/lib/resource-actor-summaries.functions";

type Props = {
  rows: ReconListPageRow[];
  resourceAccessById: ReadonlyMap<string, ResourceAccessSummary>;
  resourceAccessAvailable: boolean;
  resourceAccessLoading: boolean;
  resourceActorById: ReadonlyMap<string, ResourceActorSummary>;
  resourceActorAvailable: boolean;
  dataSourceNameById: ReadonlyMap<string, string>;
  retirementStatusById: ReadonlyMap<string, string>;
  retirementStatusAvailable: boolean;
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  selectedIndex: number;
  searchInput: string;
  statusFilter: string;
  typeFilter: string;
  sortOrder: string;
  updatedFrom: string;
  updatedThrough: string;
  updatedRangeInvalid: boolean;
  isLoading: boolean;
  isError: boolean;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onTypeChange: (value: string) => void;
  onSortChange: (value: string) => void;
  onUpdatedFromChange: (value: string) => void;
  onUpdatedThroughChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onSelect: (index: number) => void;
  onRetry: () => void;
  renderSelectedActions: (row: ReconListPageRow, closeDetails: () => void) => ReactNode;
};

function countParts(row: ReconListPageRow) {
  return {
    sides: Array.isArray(row.sides) ? row.sides.length : null,
    rules: Array.isArray(row.rules) ? row.rules.length : null,
  };
}

function formattedDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function safeRuleParameters(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return [] as Array<[string, string]>;
  return Object.entries(value as Record<string, unknown>).flatMap(([key, parameter]) => {
    if (/(?:^|_)(?:id|uuid|token|secret|password|credential)$/iu.test(key)) return [];
    if (typeof parameter === "string") {
      if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/iu.test(parameter)) return [];
      return [[key, parameter]];
    }
    if (typeof parameter === "number" || typeof parameter === "boolean")
      return [[key, String(parameter)]];
    if (
      Array.isArray(parameter) &&
      parameter.every((item) => ["string", "number", "boolean"].includes(typeof item))
    ) {
      return [[key, parameter.join(", ")]];
    }
    return [];
  });
}

export function ReconStudioIndex(props: Props) {
  const {
    rows,
    resourceAccessById,
    resourceAccessAvailable,
    resourceAccessLoading,
    resourceActorById,
    resourceActorAvailable,
    dataSourceNameById,
    retirementStatusById,
    retirementStatusAvailable,
    total,
    page,
    pageSize,
    totalPages,
    selectedIndex,
    searchInput,
    statusFilter,
    typeFilter,
    sortOrder,
    updatedFrom,
    updatedThrough,
    updatedRangeInvalid,
    isLoading,
    isError,
    onSearchChange,
    onStatusChange,
    onTypeChange,
    onSortChange,
    onUpdatedFromChange,
    onUpdatedThroughChange,
    onPageChange,
    onSelect,
    onRetry,
    renderSelectedActions,
  } = props;
  const selected = rows[selectedIndex] ?? rows[0];
  const [viewedRowId, setViewedRowId] = useState<string | null>(null);
  const viewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const viewedRow = rows.find((row) => row.id === viewedRowId) ?? null;
  const viewedParts = viewedRow ? countParts(viewedRow) : null;
  const viewedExpectedSides =
    viewedRow?.recon_type === "three_sided" ? 3 : viewedRow?.recon_type === "two_sided" ? 2 : 1;
  const viewedNeedsSetup =
    !!viewedRow &&
    !!viewedParts &&
    (viewedParts.sides === null ||
      viewedParts.sides < viewedExpectedSides ||
      viewedParts.rules === null ||
      viewedParts.rules === 0);
  const viewedSides: Array<Record<string, any>> =
    viewedRow && Array.isArray(viewedRow.sides)
      ? (viewedRow.sides as Array<Record<string, any>>)
      : [];
  const viewedRules: Array<Record<string, any>> =
    viewedRow && Array.isArray(viewedRow.rules)
      ? (viewedRow.rules as Array<Record<string, any>>)
      : [];
  const accessSummaryFor = (row: ReconListPageRow) => {
    const summary = resourceAccessById.get(row.id);
    return summary ? { ...summary, public_id: row.recon_code } : undefined;
  };
  const hasFilters =
    !!searchInput.trim() ||
    statusFilter !== "all" ||
    typeFilter !== "all" ||
    Boolean(updatedFrom || updatedThrough);
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(14rem,2fr)_minmax(8rem,0.8fr)_minmax(8rem,0.8fr)_minmax(10rem,1fr)_minmax(9rem,1fr)_minmax(9rem,1fr)_minmax(11rem,1fr)]">
        <label className="relative block">
          <span className="sr-only">Search reconciliations</span>
          <Search
            aria-hidden="true"
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Search reconciliations by name, recon_code or description"
            className="pl-9"
            value={searchInput}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Name, recon_code or description…"
          />
        </label>
        <Select value={statusFilter} onValueChange={onStatusChange}>
          <SelectTrigger aria-label="Filter reconciliations by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={onTypeChange}>
          <SelectTrigger aria-label="Filter reconciliations by type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="one_sided">Single Side</SelectItem>
            <SelectItem value="two_sided">Two-Sided</SelectItem>
            <SelectItem value="three_sided">Tri-Party</SelectItem>
          </SelectContent>
        </Select>
        <Select disabled value="unavailable">
          <SelectTrigger
            aria-label="Filter by business unit"
            title="Business-unit mappings are not active in this environment"
          >
            <SelectValue placeholder="Business unit" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unavailable">Business unit unavailable</SelectItem>
          </SelectContent>
        </Select>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Updated from (UTC)</span>
          <Input
            aria-label="Updated from (UTC)"
            type="date"
            value={updatedFrom}
            onChange={(event) => onUpdatedFromChange(event.target.value)}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Updated through (UTC)</span>
          <Input
            aria-label="Updated through (UTC)"
            type="date"
            value={updatedThrough}
            onChange={(event) => onUpdatedThroughChange(event.target.value)}
          />
        </label>
        <Select value={sortOrder} onValueChange={onSortChange}>
          <SelectTrigger aria-label="Sort reconciliations">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="updated_desc">Last updated (newest)</SelectItem>
            <SelectItem value="updated_asc">Last updated (oldest)</SelectItem>
            <SelectItem value="name_asc">Name (A–Z)</SelectItem>
            <SelectItem value="name_desc">Name (Z–A)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="min-w-0">
        <div className="min-w-0">
          {updatedRangeInvalid ? (
            <div role="alert" className="rounded-md border border-destructive/40 p-6 text-sm">
              Updated through must be on or after Updated from.
            </div>
          ) : isLoading ? (
            <div role="status" className="space-y-2" aria-label="Loading reconciliations">
              {Array.from({ length: 5 }, (_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          ) : isError ? (
            <div role="alert" className="rounded-md border border-destructive/40 p-6 text-sm">
              Reconciliations could not be loaded.{" "}
              <Button type="button" size="sm" variant="outline" className="ml-2" onClick={onRetry}>
                Try again
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-md border border-dashed p-8 text-center text-sm">
              <p className="font-medium">
                {hasFilters ? "No reconciliations match these filters." : "No reconciliations yet."}
              </p>
              <p className="mt-1 text-muted-foreground">
                {hasFilters
                  ? "Change a filter or search term to widen your results."
                  : "Create a reconciliation after adding its data sources."}
              </p>
            </div>
          ) : (
            <div className="max-h-[32rem] overflow-auto rounded-md border">
              <table
                className="w-full min-w-[1120px] border-collapse text-left text-sm"
                aria-label="Reconciliations"
              >
                <thead className="sticky top-0 z-10 bg-muted text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="w-9 p-3">
                      <span className="sr-only">Select</span>
                    </th>
                    <th className="p-3">Public ID</th>
                    <th className="p-3">Reconciliation</th>
                    <th className="p-3">Type</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Business units</th>
                    <th className="p-3">User groups</th>
                    <th className="p-3">Sources / rules</th>
                    <th className="p-3">Last run</th>
                    <th className="p-3">Updated</th>
                    <th className="fvi-sticky-view-cell p-3 text-right">View</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => {
                    const chosen = selected?.id === row.id;
                    const parts = countParts(row);
                    return (
                      <tr
                        key={row.id}
                        aria-selected={chosen}
                        className={`border-t align-top ${chosen ? "fvi-selected-row" : "hover:bg-muted/30"}`}
                      >
                        <td data-selection-control className="p-3">
                          <button
                            type="button"
                            aria-label={`Select ${row.name}`}
                            aria-pressed={chosen}
                            onClick={() => onSelect(index)}
                            className={`flex h-5 w-5 items-center justify-center rounded border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${chosen ? "border-teal-700 bg-teal-700 text-white" : "border-input"}`}
                          >
                            {chosen && <Check aria-hidden="true" className="h-3.5 w-3.5" />}
                          </button>
                        </td>
                        <td className="p-3">
                          <ResourceIdentitySummary
                            summary={accessSummaryFor(row)}
                            available={resourceAccessAvailable}
                            publicIdFallback={row.recon_code}
                            section="identity"
                          />
                        </td>
                        <td className="max-w-[19rem] p-3">
                          <button
                            type="button"
                            onClick={() => onSelect(index)}
                            className="line-clamp-2 text-left font-medium hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            {row.name}
                          </button>
                          {row.description && (
                            <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                              {row.description}
                            </p>
                          )}
                        </td>
                        <td className="p-3">{reconTypeLabel(row.recon_type)}</td>
                        <td className="p-3">
                          <Badge
                            variant={row.status === "active" ? "default" : "outline"}
                            className="capitalize"
                          >
                            {row.status}
                          </Badge>
                        </td>
                        <td className="min-w-36 p-3">
                          {resourceAccessLoading ? (
                            <span role="status" className="text-xs text-muted-foreground">
                              Loading…
                            </span>
                          ) : (
                            <ResourceIdentitySummary
                              summary={accessSummaryFor(row)}
                              available={resourceAccessAvailable}
                              section="business-units"
                            />
                          )}
                        </td>
                        <td className="min-w-36 p-3">
                          {resourceAccessLoading ? (
                            <span role="status" className="text-xs text-muted-foreground">
                              Loading…
                            </span>
                          ) : (
                            <ResourceIdentitySummary
                              summary={accessSummaryFor(row)}
                              available={resourceAccessAvailable}
                              section="user-groups"
                            />
                          )}
                        </td>
                        <td className="p-3">
                          {parts.sides === null ? "—" : parts.sides} /{" "}
                          {parts.rules === null ? "—" : parts.rules}
                        </td>
                        <td className="p-3 text-xs">
                          {!row.last_run_available
                            ? "Unavailable"
                            : row.last_run_at
                              ? formattedDate(row.last_run_at)
                              : "Never"}
                        </td>
                        <td className="p-3 text-xs">
                          <div>{formattedDate(row.updated_at)}</div>
                          <ResourceActorSummaryView
                            mode="updated-line"
                            summary={resourceActorById.get(row.id)}
                            available={resourceActorAvailable}
                          />
                        </td>
                        <td className="fvi-sticky-view-cell p-3 text-right">
                          <Button
                            type="button"
                            size="sm"
                            variant="default"
                            className="fvi-row-view-action"
                            aria-label={`View ${row.name}`}
                            aria-haspopup="dialog"
                            aria-controls={`recon-details-${row.id}`}
                            aria-expanded={viewedRowId === row.id}
                            onClick={(event) => {
                              viewTriggerRef.current = event.currentTarget;
                              setViewedRowId(row.id);
                              onSelect(index);
                            }}
                          >
                            View
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {!isLoading && !isError && total > 0 && (
            <nav
              aria-label="Reconciliation pages"
              className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm"
            >
              <span>
                {first}–{last} of {total} · {pageSize} per page
              </span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={page <= 1}
                  aria-label="Previous page"
                  onClick={() => onPageChange(page - 1)}
                >
                  <ChevronLeft aria-hidden="true" className="h-4 w-4" />
                </Button>
                <span className="px-2" aria-live="polite">
                  Page {page} of {totalPages}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={page >= totalPages}
                  aria-label="Next page"
                  onClick={() => onPageChange(page + 1)}
                >
                  <ChevronRight aria-hidden="true" className="h-4 w-4" />
                </Button>
              </div>
            </nav>
          )}
        </div>
        <Dialog
          open={viewedRowId !== null}
          onOpenChange={(open) => {
            if (!open) setViewedRowId(null);
          }}
        >
          <DialogContent
            id={viewedRow ? `recon-details-${viewedRow.id}` : undefined}
            className="h-[min(92dvh,64rem)] max-h-[92dvh] w-[calc(100vw-1rem)] max-w-[min(96vw,88rem)] overflow-hidden gap-0 p-0"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              (event.currentTarget as HTMLElement)
                .querySelector<HTMLElement>("[data-fvi-dialog-title]")
                ?.focus();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              viewTriggerRef.current?.focus();
            }}
          >
            {viewedRow ? (
              <FviDetailDialogLayout
                railEyebrow="REKON STUDIO"
                railTitle="RECONCILIATION"
                railStatus={
                  <Badge
                    variant={viewedRow.status === "active" ? "default" : "outline"}
                    className="capitalize"
                  >
                    {viewedRow.status}
                  </Badge>
                }
                railFields={[
                  {
                    label: "Public ID · recon_code",
                    value: <span className="font-mono">{viewedRow.recon_code}</span>,
                  },
                  { label: "Type", value: reconTypeLabel(viewedRow.recon_type) },
                  {
                    label: "Last run",
                    value: !viewedRow.last_run_available
                      ? "Unavailable"
                      : viewedRow.last_run_at
                        ? formattedDate(viewedRow.last_run_at)
                        : "Never",
                  },
                  {
                    label: "Last run status",
                    value: !viewedRow.last_run_available
                      ? "Unavailable"
                      : (viewedRow.last_status ?? "Not run"),
                  },
                  { label: "Definition status", value: viewedRow.status },
                  {
                    label: "Approval lifecycle",
                    value: retirementStatusAvailable
                      ? (retirementStatusById.get(viewedRow.id) ??
                        "No pending retirement request is shown in the current response")
                      : "Retirement request status unavailable in this role or environment",
                  },
                  {
                    label: "Version history",
                    value:
                      "Saved snapshots can be inspected with Versions when that action is available; the current version number is not in this list response.",
                  },
                  {
                    label: "Lock state",
                    value: "Lock state is not provided by this reconciliation record.",
                  },
                  { label: "Updated", value: formattedDate(viewedRow.updated_at) },
                ]}
                title={viewedRow.name}
                description="Configured sources, matching rules and parameters, access, lifecycle, latest results, and available actions."
                content={
                  <div className="space-y-6">
                    {viewedRow.description && (
                      <p className="text-sm text-muted-foreground">{viewedRow.description}</p>
                    )}
                    <ResourceActorSummaryView
                      mode="detail"
                      summary={resourceActorById.get(viewedRow.id)}
                      available={resourceActorAvailable}
                    />
                    <ResourceIdentitySummary
                      summary={accessSummaryFor(viewedRow)}
                      available={resourceAccessAvailable}
                      publicIdFallback={viewedRow.recon_code}
                      mode="detail"
                    />
                    <section
                      aria-labelledby="recon-detail-change-control"
                      className="space-y-2 rounded-md border p-3 text-sm"
                    >
                      <h3 id="recon-detail-change-control" className="font-semibold">
                        Change control
                      </h3>
                      <p>
                        {viewedRow.status === "draft"
                          ? "Direct edit is available for this draft to authorized writers."
                          : "No direct Edit entry point is available for this definition in this view. The request-change candidate workflow is not connected here."}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Maker-checker approval state for definition changes is not provided by the
                        current list response. Retirement requests, when supported, use the separate
                        two-person workflow shown in Approval lifecycle.
                      </p>
                    </section>
                    <section aria-labelledby="recon-detail-sources" className="space-y-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <h3 id="recon-detail-sources" className="font-semibold">
                          Configured sources
                        </h3>
                        <span className="text-xs text-muted-foreground">
                          {viewedSides.length} source{viewedSides.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      {viewedSides.length ? (
                        <ul className="divide-y rounded-md border">
                          {viewedSides.map((side, index) => {
                            const sourceName =
                              typeof side.data_source_id === "string"
                                ? dataSourceNameById.get(side.data_source_id)
                                : undefined;
                            return (
                              <li
                                key={`${String(side.side_id ?? index)}-${index}`}
                                className="grid gap-1 p-3 text-sm sm:grid-cols-[8rem_1fr]"
                              >
                                <span className="text-xs font-medium text-muted-foreground">
                                  {String(side.label ?? side.side_id ?? `Side ${index + 1}`)}
                                </span>
                                <span className="break-words">
                                  {sourceName?.trim() || "Source name unavailable"}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      ) : (
                        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                          No source configuration is available for this reconciliation.
                        </p>
                      )}
                    </section>
                    {viewedNeedsSetup && (
                      <div
                        role="status"
                        className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"
                      >
                        <p className="font-medium">Needs setup</p>
                        <p className="mt-1 text-xs">
                          Add the required sources and a matching rule before running this
                          reconciliation.
                        </p>
                      </div>
                    )}
                    <section aria-labelledby="recon-detail-rules" className="space-y-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <h3 id="recon-detail-rules" className="font-semibold">
                          Matching rules and parameters
                        </h3>
                        <span className="text-xs text-muted-foreground">
                          {viewedRules.length} rule{viewedRules.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      {viewedRules.length ? (
                        <div className="space-y-3">
                          {viewedRules.map((rule, index) => {
                            const fields =
                              rule.fields &&
                              typeof rule.fields === "object" &&
                              !Array.isArray(rule.fields)
                                ? Object.entries(rule.fields as Record<string, unknown>).filter(
                                    ([, field]) => typeof field === "string" && field.trim(),
                                  )
                                : [];
                            const parameters = safeRuleParameters(rule.params);
                            return (
                              <article
                                key={String(rule.id ?? `${String(rule.kind ?? "rule")}-${index}`)}
                                className="rounded-md border p-3 text-sm"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <h4 className="font-medium">
                                    {String(rule.kind ?? `Rule ${index + 1}`)}
                                  </h4>
                                  {rule.is_key === true && (
                                    <Badge variant="outline">Key rule</Badge>
                                  )}
                                </div>
                                {typeof rule.description === "string" && rule.description && (
                                  <p className="mt-1 text-muted-foreground">{rule.description}</p>
                                )}
                                {fields.length > 0 && (
                                  <p className="mt-2 text-xs">
                                    <span className="text-muted-foreground">Fields: </span>
                                    {fields
                                      .map(([side, field]) => `${side}: ${String(field)}`)
                                      .join(" · ")}
                                  </p>
                                )}
                                {parameters.length > 0 && (
                                  <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                                    {parameters.map(([key, value]) => (
                                      <div key={key}>
                                        <dt className="text-xs text-muted-foreground">{key}</dt>
                                        <dd className="break-words">{value}</dd>
                                      </div>
                                    ))}
                                  </dl>
                                )}
                                {fields.length === 0 && parameters.length === 0 && (
                                  <p className="mt-2 text-xs text-muted-foreground">
                                    No field mapping or display-safe parameter values are available.
                                  </p>
                                )}
                              </article>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                          No matching rules are configured.
                        </p>
                      )}
                    </section>
                    <p className="text-xs text-muted-foreground">
                      Change trail unavailable. Definition edits use the current writer path; no
                      definition-level maker-checker approval state is provided by this view.
                      Retirement requests, when active, use the separate two-person workflow shown
                      above.
                    </p>
                  </div>
                }
                actions={renderSelectedActions(viewedRow, () => setViewedRowId(null))}
              />
            ) : (
              <FviDetailDialogLayout
                railEyebrow="REKON STUDIO"
                railTitle="RECONCILIATION"
                railStatus={<Badge variant="outline">Unavailable</Badge>}
                railFields={[]}
                title="Reconciliation unavailable"
                description="This item is no longer on the current page."
                content={
                  <p className="text-sm text-muted-foreground">
                    Close this view and locate the reconciliation again.
                  </p>
                }
                actions={null}
              />
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
