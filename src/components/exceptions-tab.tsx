import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  resolveException, bulkResolveExceptions, escalateExceptionToTicket,
} from "@/lib/recons.functions";
import { listExceptionPage, listComments, listAttachments } from "@/lib/break-manager.functions";
import { listExceptionTransitions } from "@/lib/nrl.functions";
import { listTenantMembers } from "@/lib/members.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ShieldAlert, Keyboard, ArrowUpRight, CheckCheck, Download, Clock3, History, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { SavedViews } from "@/components/saved-views";
import { exportCSV, exportXLSX, exportJSON } from "@/lib/export-utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MobileTriage } from "@/components/mobile-triage";
import { useKeyboardShortcuts, type Shortcut } from "@/hooks/use-keyboard-shortcuts";
import { KeyboardShortcutsDialog } from "@/components/keyboard-shortcuts-dialog";
import { autoAssignExceptions, listAssignmentRules } from "@/lib/assignment-rules.functions";
import { getExceptionDashboard, type ExceptionDashboard } from "@/lib/exception-dashboard.functions";
import { formatUserMessage, mapKnownFailure, type UserMessage, type UserMessageCategory } from "@/lib/user-message";

function exceptionWriteFailure(error: unknown, action: string, recoveryAction: { id: string; label: string }): UserMessage {
  const candidate = error && typeof error === "object" ? error as { code?: unknown; status?: unknown } : {};
  const code = typeof candidate.code === "string" ? candidate.code : undefined;
  const status = typeof candidate.status === "number" ? candidate.status : undefined;
  const mapped = mapKnownFailure(code, status);
  const definite = ["input", "business", "auth", "session", "mfa"].includes(mapped.category);
  const category: UserMessageCategory = definite ? mapped.category : "unknown_write_outcome";
  return formatUserMessage({ ...mapped, category, action, code, status, availableActions: category === "unknown_write_outcome" ? [recoveryAction] : [] });
}

export function ExceptionsTab({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const getDashboard = useServerFn(getExceptionDashboard);
  const listPage = useServerFn(listExceptionPage);
  const resolve = useServerFn(resolveException);
  const bulk = useServerFn(bulkResolveExceptions);
  const escalate = useServerFn(escalateExceptionToTicket);
  const listRules = useServerFn(listAssignmentRules);
  const autoAssign = useServerFn(autoAssignExceptions);
  const listMembers = useServerFn(listTenantMembers);
  const rulesQ = useQuery({ queryKey: ["assignment-rules", tenantId], queryFn: () => listRules({ data: { tenant_id: tenantId } }), staleTime: 60_000 });
  const membersQ = useQuery({ queryKey: ["tenant-members", tenantId], queryFn: () => listMembers({ data: { tenant_id: tenantId } }), staleTime: 60_000 });

  const [filters, setFilters] = useState<{ status: string; stage: string; q: string; severity: string }>({
    status: "open", stage: "all", q: "", severity: "all",
  });
  const [cursor, setCursor] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [sort, setSort] = useState<"created_at" | "updated_at">("created_at");

  const q = useQuery({
    queryKey: ["breaks", tenantId, filters, sort, page, pageSize],
    queryFn: () => listPage({ data: {
      tenant_id: tenantId,
      page,
      page_size: pageSize,
      status: filters.status === "all" ? undefined : filters.status as "open" | "investigating" | "resolved" | "wont_fix",
      lifecycle_state: filters.stage === "all" ? undefined : filters.stage as "new" | "assigned" | "investigating" | "pending_counterparty" | "resolved" | "written_off" | "unspecified",
      severity: filters.severity === "all" ? undefined : filters.severity as "critical" | "high" | "medium" | "low",
      q: filters.q.trim() || undefined,
      sort,
      ascending: false,
    } }),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
  const dashboardQ = useQuery<ExceptionDashboard>({
    queryKey: ["exception-dashboard", tenantId, 30],
    queryFn: () => getDashboard({ data: { tenant_id: tenantId, days: 30 } }),
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
  });

  const pageResult = q.data as unknown as { items: any[]; total: number } | undefined;
  const rows: any[] = q.isError ? [] : pageResult?.items ?? [];
  const total = q.isError ? 0 : pageResult?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<any | null>(null);
  const [note, setNote] = useState("");
  const [target, setTarget] = useState<"investigating"|"resolved"|"wont_fix"|"open">("resolved");
  const [exceptionMessage, setExceptionMessage] = useState<UserMessage | null>(null);
  const [exceptionMessageContext, setExceptionMessageContext] = useState<"page" | "ticket">("page");
  const [uncertainAction, setUncertainAction] = useState<"assign" | "resolve" | "bulk" | "ticket" | null>(null);
  const [ticketFieldError, setTicketFieldError] = useState<string | null>(null);
  const mAssign = useMutation({
    mutationFn: (rule_id: string) => autoAssign({ data: { tenant_id: tenantId, rule_id, exception_ids: Array.from(selected) } }),
    onSuccess: (r: any) => { setExceptionMessage(null); setUncertainAction(null); toast.success(`Assigned ${r.assigned}, skipped ${r.skipped}`); setSelected(new Set()); qc.invalidateQueries({ queryKey: ["breaks", tenantId] }); },
    onError: (error) => { const message = exceptionWriteFailure(error, "auto-assign the selected exceptions", { id: "refresh-exceptions", label: "Refresh exception queue before retrying" }); setExceptionMessageContext("page"); setExceptionMessage(message); if (message.category === "unknown_write_outcome") setUncertainAction("assign"); },
  });
  const [helpOpen, setHelpOpen] = useState(false);
  const [escOpen, setEscOpen] = useState<any | null>(null);
  const [escSubject, setEscSubject] = useState("");

  useEffect(() => { setCursor(0); setPage(0); setSelected(new Set()); setActive(null); }, [filters.status, filters.stage, filters.severity, filters.q]);
  useEffect(() => { if (page >= pageCount) setPage(pageCount - 1); }, [page, pageCount]);
  useEffect(() => {
    if (!active) return;
    setActive(rows.find((row) => row.id === active.id) ?? null);
  }, [rows, active]);

  const mResolve = useMutation({
    mutationFn: (vars: { id: string; status: typeof target; note?: string }) => resolve({
      data: { id: vars.id, tenant_id: tenantId, status: vars.status, note: vars.note },
    }),
    onError: (error) => { const message = exceptionWriteFailure(error, "update this exception", { id: "check-exception", label: "Check this exception's current status" }); setExceptionMessageContext("page"); setExceptionMessage(message); if (message.category === "unknown_write_outcome") setUncertainAction("resolve"); },
    onSuccess: () => { setExceptionMessage(null); setUncertainAction(null); toast.success("Exception updated"); setActive(null); setNote(""); },
    onSettled: () => qc.invalidateQueries({ queryKey: ["breaks", tenantId] }),
  });

  const mBulk = useMutation({
    mutationFn: (vars: { status: typeof target }) =>
      bulk({ data: { tenant_id: tenantId, ids: Array.from(selected), status: vars.status } }),
    onSuccess: (res: any) => {
      setExceptionMessage(null);
      setUncertainAction(null);
      toast.success(`${res.count} exceptions updated`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["breaks", tenantId] });
    },
    onError: (error) => { const message = exceptionWriteFailure(error, "update the selected exceptions", { id: "refresh-exceptions", label: "Refresh exception queue before retrying" }); setExceptionMessageContext("page"); setExceptionMessage(message); if (message.category === "unknown_write_outcome") setUncertainAction("bulk"); },
  });

  const mEscalate = useMutation({
    mutationFn: () => escalate({
      data: { tenant_id: tenantId, exception_id: escOpen.id, subject: escSubject.trim() || `Exception ${escOpen.public_case_id ?? "case"}`, priority: "high" },
    }),
    onSuccess: (res: any) => {
      setExceptionMessage(null);
      setUncertainAction(null);
      setTicketFieldError(null);
      toast.success(`Created ticket ${res.ref}`);
      setEscOpen(null); setEscSubject("");
      qc.invalidateQueries({ queryKey: ["breaks", tenantId] });
    },
    onError: (error) => { const message = exceptionWriteFailure(error, "create a ticket for this exception", { id: "refresh-exceptions", label: "Check the exception queue before retrying" }); setExceptionMessageContext("ticket"); setExceptionMessage(message); if (message.category === "unknown_write_outcome") setUncertainAction("ticket"); },
  });

  function submitEscalation() {
    const subject = escSubject.trim();
    if (subject.length < 3 || subject.length > 160) {
      const issue = subject.length > 160 ? "too_long" : subject ? "invalid_format" : "required";
      const message = formatUserMessage({ category: "input", action: "create a ticket for this exception", fields: [{ field: "Ticket subject", issue, limit: issue === "too_long" ? 160 : undefined }] });
      setTicketFieldError(message.fieldErrors["Ticket subject"]);
      setExceptionMessageContext("ticket");
      setExceptionMessage(message);
      return;
    }
    setTicketFieldError(null);
    setExceptionMessage(null);
    mEscalate.mutate();
  }

  async function readBackExceptionAction(actionId: string) {
    if (actionId === "check-exception" && active?.public_case_id) {
      const result = await listPage({ data: { tenant_id: tenantId, page: 0, page_size: 10, q: active.public_case_id, sort, ascending: false } });
      if (Array.isArray(result.items)) {
        const currentCase = result.items.find((row: any) => row.public_case_id === active.public_case_id) ?? null;
        setFilters((current) => ({ ...current, status: "all", q: active.public_case_id }));
        setPage(0);
        setSelected(new Set());
        setActive(currentCase);
        setExceptionMessage(null);
        setUncertainAction(null);
        setExceptionMessageContext("page");
        setEscOpen(null);
      }
      return;
    }
    const results = await Promise.all([q.refetch(), dashboardQ.refetch()]);
    if (results.every((result) => result.isSuccess)) {
      setUncertainAction(null);
      setExceptionMessage(null);
      setExceptionMessageContext("page");
      setEscOpen(null);
    }
  }

  function exceptionMessageView(context: typeof exceptionMessageContext) {
    if (!exceptionMessage || exceptionMessageContext !== context) return null;
    const humanMessage = context === "ticket" && ticketFieldError
      ? "Correct the highlighted field to continue."
      : exceptionMessage.humanMessage;
    return <div role="alert" aria-live="assertive" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"><p className="font-medium">{exceptionMessage.title}</p><p className="mt-1">{humanMessage}</p>{!ticketFieldError && exceptionMessage.fieldErrors["Ticket subject"] ? <p id="exception-ticket-subject-error" className="mt-1 text-destructive">{exceptionMessage.fieldErrors["Ticket subject"]}</p> : null}{exceptionMessage.nextActions.map((action) => <Button key={action.id} type="button" size="sm" variant="outline" className="mt-2" onClick={() => void readBackExceptionAction(action.id)}>{action.label}</Button>)}</div>;
  }

  const openInspector = (row: any) => {
    setActive(row);
    setNote(row.resolution_note ?? "");
    setTarget(row.status === "investigating" ? "investigating" : row.status === "resolved" ? "resolved" : row.status === "wont_fix" ? "wont_fix" : "open");
  };
  const openEscalate = (row: any) => { setEscOpen(row); setEscSubject(`Exception ${row.public_case_id ?? "case"}`); };

  const inspectActive = !!active || !!escOpen;
  const shortcuts: Shortcut[] = useMemo(() => [
    { combo: "j",          group: "Navigation", description: "Next exception",        handler: () => setCursor((c) => Math.min(rows.length - 1, c + 1)) },
    { combo: "arrowdown",  group: "Navigation", description: "Next exception",        handler: () => setCursor((c) => Math.min(rows.length - 1, c + 1)) },
    { combo: "k",          group: "Navigation", description: "Previous exception",    handler: () => setCursor((c) => Math.max(0, c - 1)) },
    { combo: "arrowup",    group: "Navigation", description: "Previous exception",    handler: () => setCursor((c) => Math.max(0, c - 1)) },
    { combo: "enter",      group: "Navigation", description: "Inspect focused",       handler: () => rows[cursor] && openInspector(rows[cursor]) },
    { combo: "/",          group: "Navigation", description: "Focus search",          handler: () => (document.querySelector<HTMLInputElement>('input[placeholder*="reason"]'))?.focus() },
    { combo: "esc",        group: "Navigation", description: "Close / clear",         handler: () => { if (selected.size) setSelected(new Set()); }, allowInInput: false },
    { combo: "x",          group: "Selection",  description: "Toggle selection",      handler: () => { const id = rows[cursor]?.id; if (!id) return; setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); } },
    { combo: "shift+a",    group: "Selection",  description: "Select this page",      handler: () => setSelected((s) => new Set([...s, ...rows.map((r: any) => r.id)])) },
    { combo: "shift+n",    group: "Selection",  description: "Clear selection",       handler: () => setSelected(new Set()) },
    { combo: "r",          group: "Actions",    description: "Mark resolved",         handler: () => canWrite && rows[cursor] && mResolve.mutate({ id: rows[cursor].id, status: "resolved" }), disabled: !canWrite },
    { combo: "i",          group: "Actions",    description: "Mark investigating",    handler: () => canWrite && rows[cursor] && mResolve.mutate({ id: rows[cursor].id, status: "investigating" }), disabled: !canWrite },
    { combo: "w",          group: "Actions",    description: "Mark won't fix",        handler: () => canWrite && rows[cursor] && mResolve.mutate({ id: rows[cursor].id, status: "wont_fix" }), disabled: !canWrite },
    { combo: "e",          group: "Actions",    description: "Escalate to ticket",    handler: () => canWrite && rows[cursor] && openEscalate(rows[cursor]), disabled: !canWrite },
    { combo: "?",          group: "Help",       description: "Show shortcuts",        handler: () => setHelpOpen(true) },
    { combo: "shift+/",    group: "Help",       description: "Show shortcuts",        handler: () => setHelpOpen(true) },
  ], [rows, cursor, canWrite, selected, mResolve]);
  useKeyboardShortcuts(shortcuts, !inspectActive);

  const toggleAll = () => {
    if (rows.every((r) => selected.has(r.id))) setSelected((s) => new Set([...s].filter((id) => !rows.some((r) => r.id === id))));
    else setSelected((s) => new Set([...s, ...rows.map((r) => r.id)]));
  };

  return (
    <div className="space-y-4">
    <ExceptionSnapshot
      data={dashboardQ.data}
      isPending={dashboardQ.isPending}
      isError={dashboardQ.isError}
      isFetching={dashboardQ.isFetching}
      onRefresh={() => { void dashboardQ.refetch(); }}
    />
    {exceptionMessageContext === "page" ? exceptionMessageView("page") : null}
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5" /> Exceptions</CardTitle>
            <CardDescription>
              <span className="mr-2">Work the queue by match issue and workflow stage. Results are tenant-scoped and paged from the server.</span>
              <kbd className="rounded border px-1">j</kbd>/<kbd className="rounded border px-1">k</kbd> nav,
              <kbd className="mx-1 rounded border px-1">x</kbd> select,
              <kbd className="mx-1 rounded border px-1">e</kbd> escalate,
              <kbd className="mx-1 rounded border px-1">?</kbd> help.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <MobileTriage tenantId={tenantId} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" aria-label="Export current page" disabled={q.isError || q.isPending}><Download className="mr-1 h-3.5 w-3.5" /> Export page</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => exportCSV(rows.map(flattenEx), `exceptions-${Date.now()}.csv`)}>CSV</DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportXLSX(rows.map(flattenEx), `exceptions-${Date.now()}.xlsx`)}>Excel</DropdownMenuItem>
                <DropdownMenuItem onClick={() => exportJSON(rows.map(flattenEx), `exceptions-${Date.now()}.json`)}>JSON</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="ghost" size="icon" onClick={() => setHelpOpen(true)} aria-label="Keyboard shortcuts">
              <Keyboard className="h-4 w-4" />
            </Button>
            <Input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="Search reason, root cause, case or run ID…" aria-label="Search exceptions" className="h-9 w-60" />
            <Select value={sort} onValueChange={(value) => { setSort(value as typeof sort); setPage(0); setCursor(0); setActive(null); }}>
              <SelectTrigger className="w-40" aria-label="Sort exceptions"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="created_at">Newest first</SelectItem><SelectItem value="updated_at">Recently updated</SelectItem></SelectContent>
            </Select>
            <Select value={filters.severity} onValueChange={(v) => setFilters({ ...filters, severity: v })}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severities</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.status} onValueChange={(v) => setFilters({ ...filters, status: v })}>
              <SelectTrigger className="w-40" aria-label="Queue status"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Queue: open</SelectItem>
                <SelectItem value="investigating">Queue: investigating</SelectItem>
                <SelectItem value="resolved">Queue: resolved</SelectItem>
                <SelectItem value="wont_fix">Won't fix</SelectItem>
                <SelectItem value="all">All queue statuses</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filters.stage} onValueChange={(v) => setFilters({ ...filters, stage: v })}>
              <SelectTrigger className="w-48" aria-label="Workflow stage"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All workflow stages</SelectItem>
                <SelectItem value="new">Stage: new</SelectItem>
                <SelectItem value="assigned">Stage: assigned</SelectItem>
                <SelectItem value="investigating">Stage: investigating</SelectItem>
                <SelectItem value="pending_counterparty">Stage: pending counterparty</SelectItem>
                <SelectItem value="resolved">Stage: resolved</SelectItem>
                <SelectItem value="written_off">Stage: written off</SelectItem>
                <SelectItem value="unspecified">Stage not recorded</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <SavedViews tenantId={tenantId} scope="exceptions" currentFilters={filters} onApply={(f) => setFilters({ status: "open", stage: "all", q: "", severity: "all", ...f })} />
        {selected.size > 0 && canWrite && !q.isError && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 p-2">
            <span className="text-sm font-medium">{selected.size} selected</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => mBulk.mutate({ status: "investigating" })} disabled={mBulk.isPending || uncertainAction === "bulk"}>Investigating</Button>
              <Button size="sm" onClick={() => mBulk.mutate({ status: "resolved" })} disabled={mBulk.isPending || uncertainAction === "bulk"}>
                <CheckCheck className="mr-1 h-3.5 w-3.5" /> Resolve all
              </Button>
              <Button size="sm" variant="outline" onClick={() => mBulk.mutate({ status: "wont_fix" })} disabled={mBulk.isPending || uncertainAction === "bulk"}>Won't fix</Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" disabled={mAssign.isPending || (rulesQ.data?.length ?? 0) === 0}>Auto-assign</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {(rulesQ.data ?? []).filter((r: any) => r.enabled).map((r: any) => (
                    <DropdownMenuItem key={r.id} disabled={uncertainAction === "assign" || mAssign.isPending} onClick={() => mAssign.mutate(r.id)}>
                      {r.name} <span className="ml-2 text-xs text-muted-foreground">{r.strategy}</span>
                    </DropdownMenuItem>
                  ))}
                  {(rulesQ.data ?? []).filter((r: any) => r.enabled).length === 0 && (
                    <DropdownMenuItem disabled>No enabled rules — configure in Auto-assignment</DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
            </div>
          </div>
        )}
      </CardHeader>
      <CardContent>
        {q.isPending ? (
          <div className="space-y-2" aria-label="Loading exceptions" aria-busy="true">
            {[0,1,2,3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : q.isError ? (
          <div role="alert" className="rounded-md border border-destructive/40 p-6">
            <p className="font-medium text-destructive">Exception queue unavailable</p>
            <p className="mt-1 text-sm text-muted-foreground">
              The queue could not be loaded, so its current status cannot be confirmed. Try again; if this continues, contact your administrator.
            </p>
            <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => q.refetch()}>Try again</Button>
          </div>
        ) : total === 0 ? (
          <div className="rounded-md border border-dashed p-8 text-center">
            <ShieldAlert className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">Nothing to triage</p>
            <p className="mt-1 text-xs text-muted-foreground">
              No exceptions match the current filters. Clear a filter or search term and try again.
            </p>
          </div>
        ) : (
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
          <div className="min-w-0 space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground" aria-live="polite">
              <span>{total} {total === 1 ? "case" : "cases"} match filters</span>
              <span>Queue status and workflow stage are recorded separately.</span>
            </div>
            <RecordedDeadlineSummary rows={rows} asOf={dashboardQ.isError ? undefined : dashboardQ.data?.as_of} />
            {canWrite && (
              <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
                <Checkbox checked={rows.length > 0 && rows.every((r) => selected.has(r.id))} onCheckedChange={toggleAll} aria-label="Select all cases on this page" />
                <span>Select this page ({rows.length})</span>
              </div>
            )}
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[940px] text-left text-sm">
                <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                  <tr>
                    {canWrite ? <th scope="col" className="px-3 py-2"><span className="sr-only">Select</span></th> : null}
                    <th scope="col" className="px-3 py-2">Case ID</th>
                    <th scope="col" className="px-3 py-2">Reconciliation / run</th>
                    <th scope="col" className="px-3 py-2">Match issue</th>
                    <th scope="col" className="px-3 py-2">Source / side</th>
                    <th scope="col" className="px-3 py-2">Age / due date</th>
                    <th scope="col" className="px-3 py-2">Priority / severity</th>
                    <th scope="col" className="px-3 py-2">Assigned to</th>
                    <th scope="col" className="px-3 py-2">Queue / workflow</th>
                    <th scope="col" className="fvi-sticky-view-cell px-3 py-2 text-right">View</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((x: any, i: number) => {
                    const isActive = active?.id === x.id;
                    const isCursor = i === cursor;
                    return (
                      <tr key={x.id} aria-selected={isActive} className={isActive ? "fvi-selected-row" : isCursor ? "bg-[var(--brand-gold)]/5" : "hover:bg-muted/30"}>
                        {canWrite ? (
                          <td className="px-3 py-3 align-top">
                            <Checkbox checked={selected.has(x.id)} onCheckedChange={(checked) => {
                              setSelected((current) => { const next = new Set(current); checked ? next.add(x.id) : next.delete(x.id); return next; });
                            }} aria-label={`Select exception ${i + 1}`} />
                          </td>
                        ) : null}
                        <td className="px-3 py-3 align-top font-mono text-xs">
                          {x.public_case_id ? <Button type="button" variant="link" className="h-auto p-0 font-mono text-xs" aria-label={`View case ${x.public_case_id}`} onClick={() => { setCursor(i); openInspector(x); }}>{x.public_case_id}</Button> : "Case ID not recorded"}
                        </td>
                        <td className="px-3 py-3 align-top">
                          <span className="block max-w-48 truncate font-medium">{x.run?.definition?.name ?? "Reconciliation not recorded"}</span>
                          <span className="mt-1 block font-mono text-xs text-muted-foreground">Run · {x.run?.run_uid ?? "Not recorded"}</span>
                        </td>
                        <td className="max-w-60 px-3 py-3 align-top">
                          <Button type="button" variant="ghost" className="h-auto whitespace-normal p-0 text-left font-medium hover:bg-transparent focus-visible:ring-offset-0"
                            aria-label={`Inspect ${x.match_issue?.label ?? "Other exception"}, ${queueStatusLabel(x.status)}, workflow ${stageLabel(x.lifecycle_state)}`}
                            aria-pressed={isActive}
                            onClick={() => { setCursor(i); openInspector(x); }}>
                            {x.match_issue?.label ?? "Other exception"}
                          </Button>
                          <span className="mt-1 block text-xs text-muted-foreground">{x.root_cause ?? "Root cause not recorded"}</span>
                        </td>
                        <td className="px-3 py-3 align-top text-xs">{x.side ?? "Not recorded"}</td>
                        <td className="whitespace-nowrap px-3 py-3 align-top text-xs">
                          <span className="block font-medium">{formatExceptionAge(x.created_at, dashboardQ.isError ? undefined : dashboardQ.data?.as_of)}</span>
                          <span className="mt-1 block text-muted-foreground">{formatDueDateState(x.due_date, dashboardQ.isError ? undefined : dashboardQ.data?.as_of)}</span>
                        </td>
                        <td className="px-3 py-3 align-top text-xs">
                          <span className="block font-medium">{x.priority ?? "Not set"}</span>
                          <span className="mt-1 block text-muted-foreground">Severity · {x.severity ?? "Not set"}</span>
                        </td>
                        <td className="px-3 py-3 align-top text-xs">{assigneeLabel(x.assignee, membersQ.data, membersQ.isError)}</td>
                        <td className="px-3 py-3 align-top text-xs">
                          <span className="block"><span className="font-medium">Queue</span> · {queueStatusLabel(x.status)}</span>
                          <span className="mt-1 block"><span className="font-medium">Workflow</span> · {stageLabel(x.lifecycle_state)}</span>
                        </td>
                        <td className="fvi-sticky-view-cell px-3 py-3 text-right">
                          <div className="flex justify-end gap-1">
                            <Button type="button" size="sm" variant="outline" className="fvi-row-view-action" onClick={() => { setCursor(i); openInspector(x); }}>View</Button>
                            {canWrite ? <Button type="button" size="icon" variant="ghost" onClick={() => openEscalate(x)} aria-label={`Escalate ${x.public_case_id ?? "exception"} to ticket`}><ArrowUpRight className="h-3.5 w-3.5" /></Button> : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground">
              <span>Showing {total ? page * pageSize + 1 : 0}–{Math.min(total, (page + 1) * pageSize)} of {total} cases</span>
              <div className="flex items-center gap-2">
                <label htmlFor="exceptions-page-size">Rows per page</label>
                <Select value={String(pageSize)} onValueChange={(value) => { setPageSize(Number(value)); setPage(0); setCursor(0); setActive(null); }}>
                  <SelectTrigger id="exceptions-page-size" className="h-8 w-20"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="10">10</SelectItem><SelectItem value="25">25</SelectItem><SelectItem value="50">50</SelectItem></SelectContent>
                </Select>
                <Button size="sm" variant="outline" onClick={() => { setPage((p) => Math.max(0, p - 1)); setCursor(0); setActive(null); }} disabled={page === 0}>Previous</Button>
                <span aria-live="polite">Page {page + 1} of {pageCount}</span>
                <Button size="sm" variant="outline" onClick={() => { setPage((p) => Math.min(pageCount - 1, p + 1)); setCursor(0); setActive(null); }} disabled={page + 1 >= pageCount}>Next</Button>
              </div>
            </div>
          </div>
          <BreakInspector
            active={active}
            onClose={() => setActive(null)}
            canWrite={canWrite}
            tenantId={tenantId}
            ownerLabel={assigneeLabel(active?.assignee, membersQ.data, membersQ.isError)}
            note={note} setNote={setNote}
            target={target} setTarget={setTarget}
            onSave={() => mResolve.mutate({ id: active.id, status: target, note: note || undefined })}
            pending={mResolve.isPending || uncertainAction === "resolve"}
          />
          </div>
        )}
      </CardContent>


      <Dialog open={!!escOpen} onOpenChange={(o) => { if (!o) setEscOpen(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Escalate to ticket</DialogTitle>
            <DialogDescription>Creates a high-priority ticket linked to this break.</DialogDescription>
          </DialogHeader>
          {exceptionMessageContext === "ticket" ? exceptionMessageView("ticket") : null}
          <div className="space-y-3">
            <div>
              <label htmlFor="exception-ticket-subject" className="text-xs font-medium">Subject</label>
              <Input id="exception-ticket-subject" value={escSubject} maxLength={160} aria-invalid={Boolean(ticketFieldError)} aria-describedby={ticketFieldError ? "exception-ticket-subject-error" : "exception-ticket-subject-help"} onChange={(e) => { setEscSubject(e.target.value); setTicketFieldError(null); setExceptionMessage(null); }} />
              <p id="exception-ticket-subject-help" className="mt-1 text-xs text-muted-foreground">Use 3–160 characters.</p>
              {ticketFieldError ? <p id="exception-ticket-subject-error" role="alert" className="mt-1 text-xs text-destructive">{ticketFieldError}</p> : null}
            </div>
            {escOpen && (
              <div className="rounded border bg-muted/40 p-2 text-xs">
                <strong>{escOpen.match_issue?.label ?? "Other exception"}</strong>
                <p className="mt-1 text-muted-foreground">severity {escOpen.severity}</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEscOpen(null)}>Cancel</Button>
            <Button onClick={submitEscalation} disabled={mEscalate.isPending || uncertainAction === "ticket"}>Create ticket</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <KeyboardShortcutsDialog open={helpOpen} onOpenChange={setHelpOpen} shortcuts={shortcuts} title="Exceptions — keyboard shortcuts" />

    </Card>
    </div>
  );
}

const AGE_BUCKET_COLOURS = [
  "var(--fvi-emerald)",
  "var(--fvi-cyan)",
  "var(--brand-gold)",
  "var(--fvi-amber)",
  "var(--fvi-crimson)",
] as const;

function ExceptionSnapshot({
  data,
  isPending,
  isError,
  isFetching,
  onRefresh,
}: {
  data?: ExceptionDashboard;
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  onRefresh: () => void;
}) {
  if (isPending) {
    return (
      <Card aria-label="Loading exception overview" aria-busy="true">
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-20 w-full" />)}
          <Skeleton className="h-12 w-full sm:col-span-2 xl:col-span-6" />
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card role="alert" className="border-warning/40 bg-warning/5">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Exception overview unavailable</CardTitle>
            <CardDescription>Aggregate status and ageing could not be verified. The paged case queue remains separate.</CardDescription>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={onRefresh} disabled={isFetching}>
            {isFetching ? "Refreshing…" : "Try again"}
          </Button>
        </CardHeader>
      </Card>
    );
  }

  const stageCounts = new Map(data.by_status.map((item) => [item.name, item.count]));
  const cards = [
    { label: "Open exceptions", value: data.totals.open, note: "Authorized scope · all visible runs" },
    { label: "New", value: stageCounts.get("new") ?? 0, note: "Workflow stage" },
    { label: "Assigned", value: stageCounts.get("assigned") ?? 0, note: "Workflow stage" },
    { label: "Investigating", value: stageCounts.get("investigating") ?? 0, note: "Workflow stage" },
    { label: "Pending counterparty", value: stageCounts.get("pending_counterparty") ?? 0, note: "Workflow stage" },
    { label: "Closed", value: data.totals.resolved, note: "Resolved or written off" },
  ];
  const ageTotal = data.ageing.reduce((sum, item) => sum + item.count, 0);
  const ageDescription = data.ageing.map((item) => `${item.name} days: ${item.count}`).join(", ");
  const snapshotLabel = formatExceptionSnapshot(data.as_of);

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3 pb-3">
        <div>
          <CardTitle className="text-base">Exception overview</CardTitle>
              <CardDescription>
            Tenant-level aggregate across cases in your authorized scope, not limited to the selected page or run, as of {snapshotLabel}.
          </CardDescription>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onRefresh} disabled={isFetching}>
          {isFetching ? "Refreshing…" : "Refresh overview"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {cards.map((card) => (
            <div key={card.label} className="min-w-0 rounded-md border bg-card p-3">
              <dt className="truncate text-xs font-medium text-muted-foreground">{card.label}</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums">{card.value.toLocaleString()}</dd>
              <dd className="mt-0.5 truncate text-[11px] text-muted-foreground">{card.note}</dd>
            </div>
          ))}
        </dl>
        <section aria-labelledby="exceptions-age-heading" className="border-t pt-3">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h3 id="exceptions-age-heading" className="text-sm font-semibold">Age of open exceptions</h3>
              <p className="text-xs text-muted-foreground">Full elapsed days since creation. Due dates below are recorded deadlines; SLA timer status is not part of this overview.</p>
            </div>
            <span className="text-xs text-muted-foreground">{ageTotal.toLocaleString()} open cases with age buckets</span>
          </div>
          {ageTotal > 0 ? (
            <>
              <div role="img" aria-label={`Open exception ages: ${ageDescription}`} className="flex h-3 overflow-hidden rounded-full bg-muted">
                {data.ageing.map((bucket, index) => (
                  <span key={bucket.name} style={{ width: `${(bucket.count / ageTotal) * 100}%`, backgroundColor: AGE_BUCKET_COLOURS[index] }} />
                ))}
              </div>
              <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-5">
                {data.ageing.map((bucket, index) => (
                  <li key={bucket.name} className="flex items-center gap-1.5">
                    <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: AGE_BUCKET_COLOURS[index] }} />
                    <span>{bucket.name} days</span>
                    <span className="font-medium tabular-nums text-foreground">{bucket.count.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No open exceptions are in the current authorized population.</p>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

function RecordedDeadlineSummary({ rows, asOf }: { rows: any[]; asOf?: string }) {
  const snapshot = asOf ? Date.parse(asOf) : Number.NaN;
  const totals = rows.reduce((result, row) => {
    if (!row.due_date) result.notRecorded += 1;
    else {
      const deadline = Date.parse(row.due_date);
      if (!Number.isFinite(snapshot) || !Number.isFinite(deadline)) result.unavailable += 1;
      else if (deadline <= snapshot) result.passed += 1;
      else result.upcoming += 1;
    }
    return result;
  }, { passed: 0, upcoming: 0, notRecorded: 0, unavailable: 0 });
  return (
    <section aria-label="Recorded due dates for this page" className="rounded-md border bg-muted/10 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold">Recorded due dates · current page</h3>
        <p className="text-xs text-muted-foreground">A passed due date is not confirmation of an SLA breach.</p>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div className="rounded border bg-background px-2.5 py-2"><dt className="text-muted-foreground">Passed</dt><dd className="mt-0.5 font-semibold tabular-nums">{totals.passed.toLocaleString()}</dd></div>
        <div className="rounded border bg-background px-2.5 py-2"><dt className="text-muted-foreground">Upcoming</dt><dd className="mt-0.5 font-semibold tabular-nums">{totals.upcoming.toLocaleString()}</dd></div>
        <div className="rounded border bg-background px-2.5 py-2"><dt className="text-muted-foreground">No due date</dt><dd className="mt-0.5 font-semibold tabular-nums">{totals.notRecorded.toLocaleString()}</dd></div>
        <div className="rounded border bg-background px-2.5 py-2"><dt className="text-muted-foreground">Status unavailable</dt><dd className="mt-0.5 font-semibold tabular-nums">{totals.unavailable.toLocaleString()}</dd></div>
      </dl>
    </section>
  );
}

function formatExceptionSnapshot(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "time unavailable" : `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function formatExceptionAge(createdAt?: string | null, asOf?: string | null) {
  if (!createdAt || !asOf) return "Age unavailable";
  const created = Date.parse(createdAt);
  const snapshot = Date.parse(asOf);
  if (!Number.isFinite(created) || !Number.isFinite(snapshot) || created > snapshot) return "Age unavailable";
  const hours = Math.floor((snapshot - created) / 3_600_000);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

function formatDueDateState(dueDate?: string | null, asOf?: string | null) {
  if (!dueDate) return "No due date";
  const due = Date.parse(dueDate);
  if (!Number.isFinite(due)) return "Due date unavailable";
  const snapshot = asOf ? Date.parse(asOf) : Number.NaN;
  const deadline = formatExceptionDate(dueDate);
  if (!Number.isFinite(snapshot)) return `Due ${deadline} · state unavailable`;
  return `${due <= snapshot ? "Due date passed" : "Due"} · ${deadline}`;
}

function BreakInspector({
  active, onClose, canWrite, tenantId, ownerLabel, note, setNote, target, setTarget, onSave, pending,
}: {
  active: any | null; onClose: () => void; canWrite: boolean;
  tenantId: string; ownerLabel: string;
  note: string; setNote: (v: string) => void;
  target: "investigating"|"resolved"|"wont_fix"|"open"; setTarget: (v: any) => void;
  onSave: () => void; pending: boolean;
}) {
  const commentsFn = useServerFn(listComments);
  const attachmentsFn = useServerFn(listAttachments);
  const transitionsFn = useServerFn(listExceptionTransitions);
  const comments = useQuery({
    queryKey: ["break-comments", active?.id],
    queryFn: () => commentsFn({ data: { exception_id: active.id } }),
    enabled: !!active?.id,
  });
  const attachments = useQuery({
    queryKey: ["break-attachments", active?.id],
    queryFn: () => attachmentsFn({ data: { exception_id: active.id } }),
    enabled: !!active?.id,
  });
  const history = useQuery({
    queryKey: ["exc-transitions", active?.id],
    queryFn: () => transitionsFn({ data: { tenant_id: tenantId, exception_id: active.id } }),
    enabled: !!active?.id,
  });
  if (!active) {
    return (
      <Card className="xl:sticky xl:top-4 xl:max-h-[80vh]">
        <CardContent className="flex min-h-52 flex-col items-center justify-center p-6 text-center">
          <ShieldAlert className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
          <p className="mt-3 font-medium">Select a case to inspect</p>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">Match issue, workflow stage, source evidence, comments and activity appear here.</p>
        </CardContent>
      </Card>
    );
  }
  const payload = active?.payload ?? {};
  const sides = useMemo(() => extractSides(payload), [payload]);
  const allKeys = useMemo(() => {
    const set = new Set<string>();
    for (const s of sides) for (const row of s.rows) for (const k of Object.keys(row)) set.add(k);
    return Array.from(set);
  }, [sides]);

  return (
    <Card className="xl:sticky xl:top-4 xl:max-h-[80vh] xl:overflow-hidden xl:flex xl:flex-col">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <Badge variant="outline">Queue · {queueStatusLabel(active.status)}</Badge>
            Exception details · {active.public_case_id ?? "Case ID not recorded"}
          </CardTitle>
          <CardDescription><span className="font-medium text-foreground">Match issue · </span>{active.match_issue?.label ?? "Other exception"}</CardDescription>
        </CardHeader>
        <CardContent className="min-h-0 space-y-4 overflow-y-auto">

        <div className="grid gap-3 rounded-md border bg-muted/20 p-3 text-sm sm:grid-cols-2">
          <InspectorField label="Workflow stage">{stageLabel(active?.lifecycle_state)}</InspectorField>
          <InspectorField label="Owner">{ownerLabel}</InspectorField>
          <InspectorField label="Public case ID">{active?.public_case_id ?? "Not recorded"}</InspectorField>
          <InspectorField label="Reconciliation">{active?.run?.definition?.name ?? "Not recorded"}</InspectorField>
          <InspectorField label="Run ID">{active?.run?.run_uid ?? "Not recorded"}</InspectorField>
          <InspectorField label="Run started">{active?.run?.started_at ? formatExceptionDate(active.run.started_at) : "Not recorded"}</InspectorField>
          <InspectorField label="Severity">{active?.severity ?? "Not recorded"}</InspectorField>
          <InspectorField label="Priority">{active?.priority ?? "Not recorded"}</InspectorField>
          <InspectorField label="Source side">{active?.side ?? "Not recorded"}</InspectorField>
          <InspectorField label="Due date">{active?.due_date ? formatExceptionDate(active.due_date) : "Not set"}</InspectorField>
          <InspectorField label="Root cause" className="sm:col-span-2">{active?.root_cause ?? "Not recorded"}</InspectorField>
        </div>

        {sides.length >= 2 ? (
          <div className="max-h-[50vh] overflow-auto rounded border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/60 text-left">
                <tr>
                  <th className="px-3 py-2">Field</th>
                {sides.map((s, i) => <th key={i} className="px-3 py-2">{s.label}{s.rows.length > 1 ? ` · ${s.rows.length} records` : ""}</th>)}
                </tr>
              </thead>
              <tbody>
                {allKeys.map((k) => {
                  const values = sides.flatMap((s) => s.rows.map((row) => row[k]));
                  const missingSideValue = sides.some((side) => side.rows.length === 0 || side.rows.some((row) => row[k] == null));
                  const differ = missingSideValue || new Set(values.map((value) => JSON.stringify(value))).size > 1;
                  return (
                    <tr key={k} className={`border-t ${differ ? "bg-destructive/5" : ""}`}>
                      <td className="px-3 py-1.5 font-mono text-[11px]">{k}</td>
                      {sides.map((side, i) => (
                        <td key={i} className={`px-3 py-1.5 font-mono text-[11px] ${differ ? "text-destructive font-medium" : ""}`}>
                          {side.rows.length === 0 ? <span className="text-muted-foreground">—</span> : side.rows.map((row, rowIndex) => {
                            const value = row[k];
                            const display = value == null ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value);
                            return <div key={rowIndex}>{side.rows.length > 1 ? <span className="text-muted-foreground">Record {rowIndex + 1}: </span> : null}{display}</div>;
                          })}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <pre className="max-h-[50vh] overflow-auto rounded bg-muted p-2 text-[11px]">
            {JSON.stringify(payload, null, 2)}
          </pre>
        )}

        <section className="space-y-2 border-t pt-3" aria-labelledby="exception-comments-heading">
          <h3 id="exception-comments-heading" className="flex items-center gap-2 text-sm font-semibold"><MessageSquare className="h-4 w-4" /> Comments</h3>
          {comments.isLoading ? <p className="text-xs text-muted-foreground">Loading comments…</p> : comments.isError ?
            <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Comments could not be loaded. Reopen this case to try again.</span>
              <Button type="button" size="sm" variant="outline" onClick={() => comments.refetch()}>Try again</Button>
            </div> :
            (comments.data ?? []).length === 0 ? <p className="text-xs text-muted-foreground">No comments recorded.</p> :
              <div className="max-h-36 space-y-2 overflow-y-auto">
                {(comments.data ?? []).map((comment: any) => (
                  <div key={comment.id} className="rounded border bg-muted/20 p-2 text-xs">
                    <p className="font-medium">{comment.author?.full_name ?? comment.author?.email ?? "Team member"}{comment.internal ? " · Internal" : ""}</p>
                    <p className="mt-0.5 whitespace-pre-wrap">{comment.body}</p>
                    <time className="mt-1 block text-muted-foreground" dateTime={comment.created_at}>{formatExceptionDate(comment.created_at)}</time>
                  </div>
                ))}
              </div>}
        </section>

        <section className="space-y-2 border-t pt-3" aria-labelledby="exception-attachments-heading">
          <h3 id="exception-attachments-heading" className="flex items-center gap-2 text-sm font-semibold"><Download className="h-4 w-4" /> Attachments</h3>
          {attachments.isLoading ? <p role="status" className="text-xs text-muted-foreground">Loading attachment details…</p> : attachments.isError ? (
            <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Attachment details could not be loaded. Reopen this case to try again.</span>
              <Button type="button" size="sm" variant="outline" onClick={() => attachments.refetch()}>Try again</Button>
            </div>
          ) : (attachments.data ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No attachments recorded.</p>
          ) : (
            <ul className="space-y-2" aria-label="Recorded exception attachments">
              {(attachments.data ?? []).map((attachment) => (
                <li key={attachment.id} className="rounded border bg-muted/20 p-2 text-xs">
                  <p className="break-words font-medium">{attachment.filename}</p>
                  <p className="mt-1 text-muted-foreground">
                    {[attachment.mime_type, formatAttachmentSize(attachment.size_bytes), attachment.created_at ? formatExceptionDate(attachment.created_at) : null, attachment.uploader_id ? "Added by a team member" : null].filter(Boolean).join(" · ") || "Attachment details unavailable"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2 border-t pt-3" aria-labelledby="exception-history-heading">
          <h3 id="exception-history-heading" className="flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4" /> Activity</h3>
          {history.isLoading ? <p className="text-xs text-muted-foreground">Loading activity…</p> : history.isError ?
            <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Activity could not be loaded. Reopen this case to try again.</span>
              <Button type="button" size="sm" variant="outline" onClick={() => history.refetch()}>Try again</Button>
            </div> :
            (history.data ?? []).length === 0 ? <p className="text-xs text-muted-foreground">No workflow activity recorded.</p> :
              <div className="max-h-36 space-y-2 overflow-y-auto">
                {(history.data ?? []).map((event: any) => (
                  <div key={event.id} className="rounded border p-2 text-xs">
                    <p className="font-medium">{event.from_state ? `${stageLabel(event.from_state)} → ` : ""}{stageLabel(event.to_state)}</p>
                    <p className="text-muted-foreground">{event.transition_type}{event.actor_user_id ? " · Team member" : " · System"}</p>
                    {event.reason && <p className="mt-1">{event.reason}</p>}
                    <time className="mt-1 block text-muted-foreground" dateTime={event.occurred_at}>{formatExceptionDate(event.occurred_at)}</time>
                  </div>
                ))}
              </div>}
        </section>

        {canWrite && (
          <div className="space-y-3 border-t pt-3">
            <div>
              <label className="text-xs font-medium">Resolution</label>
              <Select value={target} onValueChange={(v) => setTarget(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="investigating">Investigating</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="wont_fix">Won't fix</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium">Note</label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={onClose}>Close</Button>
          {canWrite && <Button onClick={onSave} disabled={pending}>Save queue status and note</Button>}
        </div>
        </CardContent>
    </Card>
  );
}

function formatAttachmentSize(sizeBytes?: number | null) {
  if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes) || sizeBytes < 0) return null;
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extractSides(payload: any): { label: string; rows: Array<Record<string, any>> }[] {
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.sides)) {
    return payload.sides.map((s: any, i: number) => ({
      label: s?.label ?? `Side ${String.fromCharCode(65 + i)}`,
      rows: [s?.row ?? s].filter((row): row is Record<string, any> => !!row && typeof row === "object" && !Array.isArray(row)),
    }));
  }
  if (payload.members && typeof payload.members === "object" && !Array.isArray(payload.members)) {
    return Object.entries(payload.members).map(([sideId, members]) => ({
      label: sideId,
      rows: Array.isArray(members)
        ? members.filter((row): row is Record<string, any> => !!row && typeof row === "object" && !Array.isArray(row))
        : members && typeof members === "object" && !Array.isArray(members)
          ? [members as Record<string, any>]
          : [],
    }));
  }
  const sideKeys = ["left", "right", "a", "b", "c", "source", "target", "expected", "actual"];
  const found = sideKeys.filter((k) => payload[k] && typeof payload[k] === "object");
  if (found.length >= 2) {
    return found.map((k) => ({
      label: k[0].toUpperCase() + k.slice(1),
      rows: Array.isArray(payload[k])
        ? payload[k].filter((row: unknown): row is Record<string, any> => !!row && typeof row === "object" && !Array.isArray(row))
        : [payload[k] as Record<string, any>],
    }));
  }
  return [];
}

function InspectorField({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
  return <div className={className}><p className="text-xs text-muted-foreground">{label}</p><p className="mt-0.5 break-words text-sm">{children}</p></div>;
}

function queueStatusLabel(status?: string | null): string {
  switch (status) {
    case "open": return "Open";
    case "investigating": return "Investigating";
    case "resolved": return "Resolved";
    case "wont_fix": return "Won't fix";
    default: return "Not recorded";
  }
}

function stageLabel(stage?: string | null): string {
  switch (stage) {
    case "new": return "New";
    case "assigned": return "Assigned";
    case "investigating": return "Investigating";
    case "pending_counterparty": return "Pending counterparty";
    case "resolved": return "Resolved";
    case "written_off": return "Written off";
    default: return "Not recorded";
  }
}

function assigneeLabel(assigneeId?: string | null, members?: any[], failed?: boolean): string {
  if (!assigneeId) return "Unassigned";
  if (failed) return "Owner details unavailable";
  const member = members?.find((row) => row.user_id === assigneeId);
  return member?.profile?.full_name ?? member?.profile?.email ?? (member ? "Assigned" : "Assigned member");
}

function formatExceptionDate(value?: string | null): string {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not recorded" : date.toLocaleString();
}

function sevVariant(s: string): any {
  if (s === "critical" || s === "high") return "destructive";
  if (s === "low") return "secondary";
  return "default";
}

function flattenEx(x: any) {
  return {
    case_id: x.public_case_id ?? "Not recorded",
    severity: x.severity,
    status: x.status,
    side: x.side ?? "",
    recon: x.run?.definition?.name ?? "",
    match_issue: x.match_issue?.label ?? "Other exception",
    created_at: x.created_at,
  };
}
