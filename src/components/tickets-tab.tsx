import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listTickets, getTicket, createTicket, addTicketMessage, updateTicket, escalateTicket,
  listSla, upsertSla, TICKET_CATEGORIES, exportTicketAuditCsv, listAssignableUsers,
  listTicketFilterOptions,
} from "@/lib/tickets.functions";
import { toCsv, downloadCsv } from "@/lib/export-utils";
import JSZip from "jszip";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, LifeBuoy, ArrowUpRight, Timer, Paperclip, X, Filter, Tag, Download } from "lucide-react";
import { toast } from "sonner";
import { QueryErrorFeedback, safeActionErrorMessage } from "@/components/query-error-feedback";
import { formatUserMessage, mapKnownFailure, type UserMessage, type UserMessageCategory } from "@/lib/user-message";

function ticketWriteFailure(error: unknown, action: string, recovery: { id: string; label: string }): UserMessage {
  const candidate = error && typeof error === "object" ? error as { code?: unknown; status?: unknown } : {};
  const code = typeof candidate.code === "string" ? candidate.code : undefined;
  const status = typeof candidate.status === "number" ? candidate.status : undefined;
  const mapped = mapKnownFailure(code, status);
  const definite = ["input", "business", "auth", "session", "mfa"].includes(mapped.category);
  const category: UserMessageCategory = definite ? mapped.category : "unknown_write_outcome";
  return formatUserMessage({ ...mapped, category, action, code, status, availableActions: category === "unknown_write_outcome" ? [recovery] : [] });
}

const priorityColor: Record<string, string> = {
  low: "outline", normal: "secondary", high: "default", urgent: "destructive",
};

const CATEGORY_LABEL: Record<string, string> = {
  general_question: "General question",
  bug: "Bug / Issue",
  feature_request: "Feature request",
  design_feedback: "Design feedback",
  data_quality: "Data quality",
  integration: "Integration help",
  access_permissions: "Access / Permissions",
  billing: "Billing",
  security_concern: "Security concern",
  compliance: "Compliance",
  performance: "Performance",
  training: "Training",
  documentation: "Documentation",
  incident: "Incident",
  other: "Other",
};

const MAX_ATTACHMENT_BYTES = 1_500_000; // ~1.5 MB per file (data URL inline)
const MAX_ATTACHMENT_COUNT = 5;

type Attachment = { name: string; size?: number; type?: string; data_url?: string; url?: string };

// Renders a compact SLA countdown badge derived from the shared `computeSlaState`
// helper (see `src/lib/tickets.functions.ts`). Colours follow the semantic-token
// palette so it works in light + dark + tenant themes.
function SlaBadge({ sla }: { sla?: any }) {
  if (!sla || sla.resolution_status === "n/a") {
    return <span className="text-[11px] text-muted-foreground">—</span>;
  }
  const mins = sla.minutes_to_resolution_due as number | null;
  if (sla.resolution_status === "met") {
    return <Badge variant="outline" className="text-[10px]">met</Badge>;
  }
  if (sla.resolution_status === "breached") {
    const overdue = mins !== null && mins < 0 ? Math.abs(mins) : null;
    return (
      <Badge variant="destructive" className="text-[10px]">
        breached{overdue !== null ? ` · ${fmtMins(overdue)} over` : ""}
      </Badge>
    );
  }
  if (mins !== null && mins <= 60) {
    return <Badge className="bg-amber-500 text-[10px] text-amber-950 hover:bg-amber-500">due in {fmtMins(mins)}</Badge>;
  }
  return <Badge variant="secondary" className="text-[10px]">on track · {mins !== null ? fmtMins(mins) : "—"}</Badge>;
}

function fmtMins(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h < 24) return rest ? `${h}h ${rest}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const hr = h % 24;
  return hr ? `${d}d ${hr}h` : `${d}d`;
}

const PENDING_LABEL: Record<string, { label: string; tone: "warn" | "info" | "err" }> = {
  unassigned: { label: "Unassigned", tone: "warn" },
  no_first_response: { label: "No first response", tone: "warn" },
  waiting_customer: { label: "Waiting on customer", tone: "info" },
  first_response_breached: { label: "First-response SLA breached", tone: "err" },
  resolution_breached: { label: "Resolution SLA breached", tone: "err" },
};

function PendingActions({ actions }: { actions: string[] }) {
  if (!actions || actions.length === 0) {
    return <span className="text-[11px] text-muted-foreground">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {actions.map((a) => {
        const meta = PENDING_LABEL[a] ?? { label: a, tone: "info" as const };
        const cls =
          meta.tone === "err"
            ? "bg-destructive text-destructive-foreground"
            : meta.tone === "warn"
              ? "bg-amber-500 text-amber-950"
              : "bg-muted text-muted-foreground";
        return (
          <span key={a} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>
            {meta.label}
          </span>
        );
      })}
    </div>
  );
}

export function TicketsTab({
  mode, tenantId,
}: {
  mode: "tenant" | "platform" | "workspace";
  tenantId?: string;
}) {
  const qc = useQueryClient();
  const list = useServerFn(listTickets);
  const get = useServerFn(getTicket);
  const create = useServerFn(createTicket);
  const addMsg = useServerFn(addTicketMessage);
  const update = useServerFn(updateTicket);
  const escalate = useServerFn(escalateTicket);

  // Advanced filters — mirror the copilot list_support_tickets contract so
  // this UI and the Copilot command return identical result sets.
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [queueFilter, setQueueFilter] = useState<string>("all");
  const [slaFilter, setSlaFilter] = useState<"any" | "breached" | "due_soon" | "on_track">("any");
  const [mineOnly, setMineOnly] = useState(false);
  const [textQuery, setTextQuery] = useState("");
  // Actor-scoped narrowing so admins can zoom in on a specific tenant /
  // creator / assignee across the visible queue. Only tenant is exposed in
  // platform mode; the other two show in every view.
  const [tenantFilter, setTenantFilter] = useState<string>("all");
  const [createdByFilter, setCreatedByFilter] = useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");

  const filterOptionsFn = useServerFn(listTicketFilterOptions);
  const optionsQ = useQuery({
    queryKey: ["ticket-filter-options", mode, tenantId ?? null],
    queryFn: () => filterOptionsFn({
      data: {
        tenant_id: mode === "platform" ? undefined : (tenantId ?? undefined),
        scope: mode === "platform" ? "platform" : undefined,
      },
    }),
    staleTime: 60_000,
  });

  const queryParams = useMemo<any>(() => {
    const base: any = {};
    if (mode === "platform") {
      base.scope = "platform";
      if (tenantFilter !== "all") base.tenant_id = tenantFilter;
    } else if (mode === "tenant") {
      base.tenant_id = tenantId;
    } else {
      base.tenant_id = tenantId;
      base.mine = true;
    }
    if (statusFilter !== "all") base.status = statusFilter;
    if (categoryFilter !== "all") base.category = categoryFilter;
    if (priorityFilter !== "all") base.priority = priorityFilter;
    if (queueFilter !== "all") base.queue = queueFilter;
    if (slaFilter !== "any") base.sla_state = slaFilter;
    if (mineOnly && mode !== "workspace") base.mine = true;
    if (createdByFilter !== "all") base.created_by = createdByFilter;
    if (assigneeFilter !== "all") base.assignee_id = assigneeFilter;
    if (textQuery.trim().length >= 2) base.query = textQuery.trim();
    return base;
  }, [mode, tenantId, statusFilter, categoryFilter, priorityFilter, queueFilter, slaFilter, mineOnly, textQuery, tenantFilter, createdByFilter, assigneeFilter]);

  const q = useQuery({
    queryKey: ["tickets", mode, tenantId ?? null, statusFilter, categoryFilter, priorityFilter, queueFilter, slaFilter, mineOnly, textQuery, tenantFilter, createdByFilter, assigneeFilter],
    queryFn: () => list({ data: queryParams }),
  });

  // Compose form
  const defaultScope: "workspace" | "tenant" | "platform" =
    mode === "platform" ? "platform" : mode === "tenant" ? "tenant" : "workspace";
  const [openNew, setOpenNew] = useState(false);
  const [form, setForm] = useState<{
    scope: "workspace" | "tenant" | "platform";
    subject: string;
    body: string;
    priority: "low" | "normal" | "high" | "urgent";
    category: typeof TICKET_CATEGORIES[number];
    attachments: Attachment[];
  }>({
    scope: defaultScope,
    subject: "",
    body: "",
    priority: "normal",
    category: "general_question",
    attachments: [],
  });
  const [ticketMessage, setTicketMessage] = useState<UserMessage | null>(null);
  const [ticketMessageContext, setTicketMessageContext] = useState<"page" | "create" | "ticket">("page");
  const [uncertainTicketAction, setUncertainTicketAction] = useState<"create" | "reply" | "update" | "escalate" | null>(null);
  const [createFieldErrors, setCreateFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [replyError, setReplyError] = useState<string | null>(null);
  const [escalationError, setEscalationError] = useState<string | null>(null);

  const [openId, setOpenId] = useState<string | null>(null);
  const ticketQ = useQuery({
    queryKey: ["ticket", openId],
    queryFn: () => openId ? get({ data: { id: openId } }) : null,
    enabled: !!openId,
  });

  const mCreate = useMutation({
    mutationFn: () => create({ data: {
      scope: form.scope,
      tenant_id: form.scope === "platform" ? null : tenantId!,
      subject: form.subject,
      body: form.body,
      priority: form.priority,
      category: form.category,
      attachments: form.attachments,
    }}),
    onSuccess: () => {
      setTicketMessage(null);
      setUncertainTicketAction(null);
      setCreateFieldErrors({});
      toast.success("Ticket raised");
      setOpenNew(false);
      setForm({ scope: defaultScope, subject: "", body: "", priority: "normal", category: "general_question", attachments: [] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
    onError: (error) => {
      const message = ticketWriteFailure(error, "raise this support ticket", { id: "check-ticket-list", label: "Check the ticket list before submitting again" });
      setTicketMessageContext("create");
      setTicketMessage(message);
      if (message.category === "unknown_write_outcome") setUncertainTicketAction("create");
    },
  });

  function handleFiles(files: FileList | null) {
    if (!files) return;
    const next: Attachment[] = [...form.attachments];
    Array.from(files).forEach((file) => {
      if (next.length >= MAX_ATTACHMENT_COUNT) {
        setTicketMessage(formatUserMessage({ category: "input", action: "attach files to this ticket", fields: [{ field: "Attachments", issue: "too_large", limit: MAX_ATTACHMENT_COUNT }] }));
        setTicketMessageContext("create");
        return;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setTicketMessage(formatUserMessage({ category: "input", action: "attach files to this ticket", fields: [{ field: "Attachment size in bytes", issue: "too_large", limit: MAX_ATTACHMENT_BYTES }] }));
        setTicketMessageContext("create");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        next.push({ name: file.name, size: file.size, type: file.type, data_url: String(reader.result) });
        setForm((f) => ({ ...f, attachments: [...next] }));
        setTicketMessage(null);
      };
      reader.onerror = () => { setTicketMessageContext("create"); setTicketMessage(formatUserMessage({ category: "system", action: "read the selected ticket attachment" })); };
      reader.readAsDataURL(file);
    });
  }

  const [reply, setReply] = useState({ body: "", internal_note: false });
  const mReply = useMutation({
    mutationFn: () => addMsg({ data: { ticket_id: openId!, ...reply } }),
    onSuccess: () => {
      setTicketMessage(null);
      setUncertainTicketAction(null);
      setReplyError(null);
      setReply({ body: "", internal_note: false });
      qc.invalidateQueries({ queryKey: ["ticket", openId] });
    },
    onError: (error) => {
      const message = ticketWriteFailure(error, "send this ticket message", { id: "refresh-ticket", label: "Refresh ticket conversation before sending again" });
      setTicketMessageContext("ticket");
      setTicketMessage(message);
      if (message.category === "unknown_write_outcome") setUncertainTicketAction("reply");
    },
  });
  const mUpdate = useMutation({
    mutationFn: (patch: any) => update({ data: { id: openId!, ...patch } }),
    onSuccess: () => {
      setTicketMessage(null);
      setUncertainTicketAction(null);
      qc.invalidateQueries({ queryKey: ["ticket", openId] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
    onError: (error) => {
      const message = ticketWriteFailure(error, "update this ticket", { id: "refresh-ticket", label: "Refresh ticket status before changing it again" });
      setTicketMessageContext("ticket");
      setTicketMessage(message);
      if (message.category === "unknown_write_outcome") setUncertainTicketAction("update");
    },
  });
  const [escReason, setEscReason] = useState("");
  const mEsc = useMutation({
    mutationFn: () => escalate({ data: { id: openId!, reason: escReason } }),
    onSuccess: () => {
      setTicketMessage(null);
      setUncertainTicketAction(null);
      setEscalationError(null);
      toast.success("Escalated to platform");
      setEscReason("");
      qc.invalidateQueries({ queryKey: ["ticket", openId] });
      qc.invalidateQueries({ queryKey: ["tickets"] });
    },
    onError: (error) => {
      const message = ticketWriteFailure(error, "escalate this ticket to platform", { id: "refresh-ticket", label: "Refresh ticket status before escalating again" });
      setTicketMessageContext("ticket");
      setTicketMessage(message);
      if (message.category === "unknown_write_outcome") setUncertainTicketAction("escalate");
    },
  });

  // Scope options depend on entry mode
  const scopeOptions: { v: "workspace" | "tenant" | "platform"; label: string; desc: string }[] = (() => {
    if (mode === "platform") {
      return [{ v: "platform", label: "Platform", desc: "Goes directly to the platform queue (admins only)." }];
    }
    if (mode === "tenant") {
      return [
        { v: "tenant", label: "Tenant", desc: "Stays with tenant admins for your organization." },
        { v: "platform", label: "Platform", desc: "Send straight to the platform queue (admins only)." },
      ];
    }
    return [
      { v: "workspace", label: "Workspace", desc: "Personal ticket for this workspace; tenant admins can pick it up." },
      { v: "tenant", label: "Tenant", desc: "Visible to all tenant admins in your organization." },
    ];
  })();

  const canRaise = !!tenantId || mode === "platform";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <LifeBuoy className="h-4 w-4" />
              {mode === "platform" ? "Platform support queue" : mode === "tenant" ? "Tenant support queue" : "My tickets"}
            </CardTitle>
            <CardDescription>
              {mode === "platform"
                ? "Tickets raised on the platform, plus tenant escalations."
                : mode === "tenant"
                  ? "All tickets across your tenant — workspace, tenant, and any escalations."
                  : "Tickets you've raised from this workspace."}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground"><Filter className="h-3.5 w-3.5" /></div>
            <Input
              value={textQuery}
              onChange={(e) => setTextQuery(e.target.value)}
              placeholder="Search subject or ref (e.g. FVI-142)"
              className="h-8 w-[220px] text-xs"
            />
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {["open", "in_progress", "waiting_customer", "resolved", "closed"].map((s) => (
                  <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="h-8 w-[120px] text-xs"><SelectValue placeholder="Severity" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severities</SelectItem>
                {["low", "normal", "high", "urgent"].map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="h-8 w-[170px] text-xs"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {TICKET_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>{CATEGORY_LABEL[c]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={queueFilter} onValueChange={setQueueFilter}>
              <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue placeholder="Team" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All teams</SelectItem>
                <SelectItem value="tenant">Tenant queue</SelectItem>
                <SelectItem value="platform">Platform queue</SelectItem>
              </SelectContent>
            </Select>
            <Select value={slaFilter} onValueChange={(v) => setSlaFilter(v as any)}>
              <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue placeholder="SLA" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">SLA · any</SelectItem>
                <SelectItem value="breached">SLA · breached</SelectItem>
                <SelectItem value="due_soon">SLA · due ≤ 60m</SelectItem>
                <SelectItem value="on_track">SLA · on track</SelectItem>
              </SelectContent>
            </Select>
            {mode === "platform" && (
              <Select value={tenantFilter} onValueChange={setTenantFilter}>
                <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue placeholder="Tenant" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All tenants</SelectItem>
                  {(optionsQ.data?.tenants ?? []).map((t: any) => (
                    <SelectItem key={t.id} value={t.id}>{t.name ?? t.slug ?? t.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={createdByFilter} onValueChange={setCreatedByFilter}>
              <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue placeholder="Created by" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any creator</SelectItem>
                {(optionsQ.data?.creators ?? []).map((u: any) => (
                  <SelectItem key={u.id} value={u.id}>{u.full_name ?? u.email ?? u.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
              <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue placeholder="Assignee" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any assignee</SelectItem>
                {(optionsQ.data?.assignees ?? []).map((u: any) => (
                  <SelectItem key={u.id} value={u.id}>{u.full_name ?? u.email ?? u.id}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {mode !== "workspace" ? (
              <label className="flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] text-muted-foreground">
                <Switch checked={mineOnly} onCheckedChange={setMineOnly} />
                Mine
              </label>
            ) : null}
            <TicketAuditExportButton tenantId={tenantId ?? undefined} />
            {canRaise ? (
              <Dialog open={openNew} onOpenChange={setOpenNew}>
                <DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-4 w-4" />Raise ticket</Button></DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader><DialogTitle>Raise a support ticket</DialogTitle></DialogHeader>
                  <div className="space-y-4">
                    <div>
                      <Label>Route to</Label>
                      <div className="mt-1 grid gap-2 sm:grid-cols-2">
                        {scopeOptions.map((o) => (
                          <button
                            key={o.v}
                            type="button"
                            onClick={() => setForm((f) => ({ ...f, scope: o.v }))}
                            className={`rounded-md border p-3 text-left text-sm transition ${form.scope === o.v ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}
                          >
                            <div className="font-medium">{o.label}</div>
                            <div className="text-xs text-muted-foreground">{o.desc}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label>Category</Label>
                        <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v as any })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {TICKET_CATEGORIES.map((c) => (
                              <SelectItem key={c} value={c}>{CATEGORY_LABEL[c]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Priority</Label>
                        <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v as any })}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="low">Low</SelectItem>
                            <SelectItem value="normal">Normal</SelectItem>
                            <SelectItem value="high">High</SelectItem>
                            <SelectItem value="urgent">Urgent</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label>Subject</Label>
                      <Input
                        value={form.subject}
                        maxLength={160}
                        onChange={(e) => setForm({ ...form, subject: e.target.value })}
                        placeholder="e.g. Demo Bank Nostro USD break — Citi feed missing 2026-06-26"
                      />
                    </div>
                    <div>
                      <Label>Description</Label>
                      <Textarea
                        rows={6}
                        value={form.body}
                        maxLength={8000}
                        onChange={(e) => setForm({ ...form, body: e.target.value })}
                        placeholder="e.g. Demo Bank Nostro USD recon failed at 06:15 UTC — Citi MT940 feed empty. Expected ~1,200 lines. Steps: 1) opened ReconIQ Studio → DEMO-BANK-NOSTRO-USD-Daily 2) status = ingest_failed"
                      />
                      <div className="mt-1 text-right text-[10px] text-muted-foreground">{form.body.length}/8000</div>
                    </div>
                    <div>
                      <Label className="flex items-center gap-2"><Paperclip className="h-4 w-4" />Attachments</Label>
                      <Input
                        type="file"
                        multiple
                        onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
                        className="cursor-pointer"
                      />
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        Up to {MAX_ATTACHMENT_COUNT} files, {Math.round(MAX_ATTACHMENT_BYTES / 1024)} KB each.
                      </div>
                      {form.attachments.length > 0 ? (
                        <ul className="mt-2 space-y-1">
                          {form.attachments.map((a, i) => (
                            <li key={i} className="flex items-center justify-between rounded border bg-muted/30 px-2 py-1 text-xs">
                              <span className="truncate">{a.name} <span className="text-muted-foreground">({Math.round((a.size ?? 0) / 1024)} KB)</span></span>
                              <button type="button" onClick={() => setForm({ ...form, attachments: form.attachments.filter((_, j) => j !== i) })}>
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                    <Button
                      className="w-full"
                      disabled={form.subject.trim().length < 3 || form.body.trim().length < 3 || mCreate.isPending}
                      onClick={() => mCreate.mutate()}
                    >
                      {mCreate.isPending ? "Submitting…" : "Submit ticket"}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            ) : null}
          </div>
        </CardHeader>
        {optionsQ.isError ? <div className="px-4 pb-4"><QueryErrorFeedback error={optionsQ.error} onRetry={optionsQ.refetch} resource="Ticket filters" /></div> : null}
        {q.isError ? <div className="px-4 pb-4"><QueryErrorFeedback error={q.error} onRetry={q.refetch} resource="Support tickets" /></div> : null}
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Ref</th>
                <th className="px-4 py-2">Subject</th>
                {mode === "platform" ? <th className="px-4 py-2">Tenant</th> : null}
                <th className="px-4 py-2">Category</th>
                <th className="px-4 py-2">Priority</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Created by</th>
                <th className="px-4 py-2">Assigned to</th>
                <th className="px-4 py-2">SLA</th>
                <th className="px-4 py-2">Pending actions</th>
                <th className="px-4 py-2">Scope</th>
                <th className="px-4 py-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {(q.data ?? []).map((t: any) => (
                <tr key={t.id} className="cursor-pointer border-b hover:bg-muted/30" onClick={() => setOpenId(t.id)}>
                  <td className="px-4 py-2 font-mono text-xs">{t.ref}</td>
                  <td className="px-4 py-2 font-medium">{t.subject}</td>
                  {mode === "platform" ? (
                    <td className="px-4 py-2 text-xs">
                      {t.tenant ? (
                        <span title={t.tenant.slug}>{t.tenant.name}</span>
                      ) : <span className="text-muted-foreground">Platform</span>}
                    </td>
                  ) : null}
                  <td className="px-4 py-2"><span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Tag className="h-3 w-3" />{CATEGORY_LABEL[t.category] ?? t.category}</span></td>
                  <td className="px-4 py-2"><Badge variant={priorityColor[t.priority] as any}>{t.priority}</Badge></td>
                  <td className="px-4 py-2"><Badge variant="outline">{t.status}</Badge></td>
                  <td className="px-4 py-2 text-xs">
                    {t.created_by_profile
                      ? <span title={t.created_by_profile.email}>{t.created_by_profile.full_name ?? t.created_by_profile.email}</span>
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    {t.assignee_profile
                      ? <span title={t.assignee_profile.email}>{t.assignee_profile.full_name ?? t.assignee_profile.email}</span>
                      : <span className="text-muted-foreground italic">Unassigned</span>}
                  </td>
                  <td className="px-4 py-2"><SlaBadge sla={t.sla} /></td>
                  <td className="px-4 py-2"><PendingActions actions={t.sla?.pending_actions ?? []} /></td>
                  <td className="px-4 py-2"><Badge variant={t.scope === "platform" ? "default" : "outline"}>{t.scope}</Badge></td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(t.created_at).toLocaleString()}</td>
                </tr>
              ))}
              {q.isSuccess && q.data.length === 0 ? (
                <tr><td colSpan={mode === "platform" ? 12 : 11} className="px-4 py-8 text-center text-muted-foreground">No tickets match these filters.</td></tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-w-3xl">
          {ticketQ.isError ? (
            <QueryErrorFeedback error={ticketQ.error} onRetry={ticketQ.refetch} resource="Ticket details" />
          ) : ticketQ.data?.ticket ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className="font-mono text-sm text-muted-foreground">{(ticketQ.data.ticket as any).ref}</span>
                  {(ticketQ.data.ticket as any).subject}
                </DialogTitle>
              </DialogHeader>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge>{(ticketQ.data.ticket as any).status}</Badge>
                <Badge variant="outline">{(ticketQ.data.ticket as any).priority}</Badge>
                <Badge variant={(ticketQ.data.ticket as any).scope === "platform" ? "default" : "outline"}>{(ticketQ.data.ticket as any).scope}</Badge>
                <Badge variant="secondary">{CATEGORY_LABEL[(ticketQ.data.ticket as any).category] ?? (ticketQ.data.ticket as any).category}</Badge>
                {(ticketQ.data.ticket as any).tenant ? (
                  <Badge variant="outline">Tenant: {(ticketQ.data.ticket as any).tenant.name}</Badge>
                ) : null}
                {(ticketQ.data.ticket as any).created_by_profile ? (
                  <Badge variant="outline">
                    Created by: {(ticketQ.data.ticket as any).created_by_profile.full_name
                      ?? (ticketQ.data.ticket as any).created_by_profile.email}
                  </Badge>
                ) : null}
                <Badge variant="outline">
                  Assigned to: {(ticketQ.data.ticket as any).assignee_profile
                    ? ((ticketQ.data.ticket as any).assignee_profile.full_name
                       ?? (ticketQ.data.ticket as any).assignee_profile.email)
                    : "Unassigned"}
                </Badge>
                <span className="text-[11px] text-muted-foreground">
                  Created {new Date((ticketQ.data.ticket as any).created_at).toLocaleString()}
                </span>
              </div>
              <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border p-3">
                <div className="rounded bg-muted/40 p-2 text-sm whitespace-pre-wrap">{(ticketQ.data.ticket as any).body}</div>
                {Array.isArray((ticketQ.data.ticket as any).attachments) && (ticketQ.data.ticket as any).attachments.length > 0 ? (
                  <div className="rounded border bg-background p-2">
                    <div className="mb-1 text-[10px] uppercase text-muted-foreground">Attachments</div>
                    <ul className="space-y-1 text-xs">
                      {((ticketQ.data.ticket as any).attachments as Attachment[]).map((a, i) => (
                        <li key={i}>
                          {a.data_url || a.url ? (
                            <a href={a.data_url ?? a.url} download={a.name} className="text-primary underline">{a.name}</a>
                          ) : (a.name)}
                          {a.size ? <span className="ml-2 text-muted-foreground">({Math.round(a.size / 1024)} KB)</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {(ticketQ.data.messages ?? []).map((m: any) => (
                  <div key={m.id} className={`rounded p-2 text-sm whitespace-pre-wrap ${m.internal_note ? "border border-amber-500/40 bg-amber-500/5" : "bg-accent/30"}`}>
                    {m.internal_note ? <div className="mb-1 text-[10px] uppercase text-amber-600">Internal note</div> : null}
                    {m.body}
                    <div className="mt-1 text-[10px] text-muted-foreground">{new Date(m.created_at).toLocaleString()}</div>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <Textarea value={reply.body} onChange={(e) => setReply({ ...reply, body: e.target.value })} placeholder="e.g. Demo Bank Ops investigating — Citi feed delayed, ETA 14:00 UTC" rows={3} />
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs">
                    <Switch checked={reply.internal_note} onCheckedChange={(v) => setReply({ ...reply, internal_note: v })} />
                    Internal note (only tenant admins/platform see)
                  </label>
                  <Button size="sm" disabled={!reply.body} onClick={() => mReply.mutate()}>Send</Button>
                </div>
              </div>
              <div className="grid gap-2 border-t pt-3 md:grid-cols-4">
                <div>
                  <Label className="text-[10px] uppercase text-muted-foreground">Status</Label>
                  <Select value={(ticketQ.data.ticket as any).status} onValueChange={(v) => mUpdate.mutate({ status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["open", "in_progress", "waiting_customer", "resolved", "closed"].map((s) => (
                        <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px] uppercase text-muted-foreground">Priority</Label>
                  <Select value={(ticketQ.data.ticket as any).priority} onValueChange={(v) => mUpdate.mutate({ priority: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["low", "normal", "high", "urgent"].map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px] uppercase text-muted-foreground">Category</Label>
                  <Select value={(ticketQ.data.ticket as any).category} onValueChange={(v) => mUpdate.mutate({ category: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TICKET_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>{CATEGORY_LABEL[c]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px] uppercase text-muted-foreground">Assign to</Label>
                  <AssigneePicker
                    ticketId={openId!}
                    currentAssigneeId={(ticketQ.data.ticket as any).assignee_id ?? null}
                    onChange={(id) => mUpdate.mutate({ assignee_id: id })}
                  />
                </div>
                {(mode === "tenant" || mode === "workspace") && (ticketQ.data.ticket as any).queue === "tenant" ? (
                  <div className="flex gap-2 md:col-span-4">
                    <Input placeholder="e.g. Demo Bank SLA breach — escalating to Cash Ops Manager" value={escReason} onChange={(e) => setEscReason(e.target.value)} />
                    <Button variant="outline" disabled={!escReason} onClick={() => mEsc.mutate()}>
                      <ArrowUpRight className="mr-1 h-3.5 w-3.5" />Escalate to platform
                    </Button>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * RBAC-scoped assignee selector. Fetches candidates via `listAssignableUsers`,
 * which returns platform admins + tenant admins for the ticket's tenant.
 */
function AssigneePicker({
  ticketId, currentAssigneeId, onChange,
}: {
  ticketId: string;
  currentAssigneeId: string | null;
  onChange: (id: string | null) => void;
}) {
  const listUsers = useServerFn(listAssignableUsers);
  const q = useQuery({
    queryKey: ["ticket-assignees", ticketId],
    queryFn: () => listUsers({ data: { ticket_id: ticketId } }),
  });
  const users = (q.data ?? []) as any[];
  return (
    <div className="space-y-2">
      {q.isError ? <QueryErrorFeedback error={q.error} onRetry={q.refetch} resource="Ticket assignees" /> : null}
      <Select
        value={currentAssigneeId ?? "__unassigned"}
        onValueChange={(v) => onChange(v === "__unassigned" ? null : v)}
      >
        <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__unassigned">Unassigned</SelectItem>
          {users.map((u) => (
            <SelectItem key={u.id} value={u.id}>
              {u.full_name ?? u.email} <span className="text-muted-foreground">({u.email})</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function SlaTab({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listSla);
  const upsert = useServerFn(upsertSla);
  const q = useQuery({ queryKey: ["sla", tenantId], queryFn: () => list({ data: { tenant_id: tenantId } }) });

  const priorities = ["low", "normal", "high", "urgent"] as const;
  const defaults: Record<string, { fr: number; res: number }> = {
    low: { fr: 60 * 24, res: 60 * 24 * 5 },
    normal: { fr: 60 * 8, res: 60 * 24 * 2 },
    high: { fr: 60, res: 60 * 8 },
    urgent: { fr: 15, res: 60 * 4 },
  };

  const mSave = useMutation({
    mutationFn: (v: any) => upsert({ data: v }),
    onSuccess: () => { toast.success("SLA saved"); qc.invalidateQueries({ queryKey: ["sla", tenantId] }); },
    onError: (e: unknown) => toast.error(safeActionErrorMessage(e)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Timer className="h-4 w-4" />SLA policies</CardTitle>
        <CardDescription>First-response and resolution targets per priority (in minutes).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {q.isError ? <QueryErrorFeedback error={q.error} onRetry={q.refetch} resource="SLA policies" /> : null}
        {priorities.map((p) => {
          const row = (q.data ?? []).find((r: any) => r.priority === p);
          const fr = row?.first_response_mins ?? defaults[p].fr;
          const res = row?.resolution_mins ?? defaults[p].res;
          return (
            <div key={p} className="grid grid-cols-[120px_1fr_1fr_auto] items-end gap-3">
              <Badge variant="outline" className="justify-self-start uppercase">{p}</Badge>
              <div><Label className="text-xs">First response (min)</Label>
                <Input id={`fr-${p}`} type="number" defaultValue={fr} />
              </div>
              <div><Label className="text-xs">Resolution (min)</Label>
                <Input id={`res-${p}`} type="number" defaultValue={res} />
              </div>
              <Button size="sm" onClick={() => {
                const frv = Number((document.getElementById(`fr-${p}`) as HTMLInputElement).value);
                const rsv = Number((document.getElementById(`res-${p}`) as HTMLInputElement).value);
                mSave.mutate({ tenant_id: tenantId, priority: p, name: `${p} SLA`, first_response_mins: frv, resolution_mins: rsv });
              }}>Save</Button>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function TicketAuditExportButton({ tenantId, ticketId }: { tenantId?: string; ticketId?: string }) {
  const [busy, setBusy] = useState<null | "csv" | "zip">(null);
  const exportFn = useServerFn(exportTicketAuditCsv);
  const run = async (fmt: "csv" | "zip") => {
    setBusy(fmt);
    try {
      const res: any = await exportFn({
        data: { tenant_id: tenantId, ticket_id: ticketId, copilot_only: false },
      });
      const rows = res.rows as any[];
      const csv = toCsv(rows, [
        { key: "occurred_at", header: "Occurred At" },
        { key: "action", header: "Action" },
        { key: "actor_email", header: "Actor Email" },
        { key: "actor_user_id", header: "Actor User ID" },
        { key: "tenant_id", header: "Tenant ID" },
        { key: "tenant_slug", header: "Tenant" },
        { key: "scope", header: "Scope" },
        { key: "ticket_id", header: "Ticket ID" },
        { key: "ref", header: "Ref" },
        { key: "surface", header: "Surface" },
        { key: "thread_id", header: "Thread ID" },
        { key: "details", header: "Details JSON" },
      ]);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const base = `ticket-audit-${stamp}`;
      if (fmt === "csv") {
        downloadCsv(`${base}.csv`, csv);
      } else {
        const zip = new JSZip();
        zip.file(`${base}.csv`, csv);
        zip.file(
          `${base}.json`,
          JSON.stringify({ generated_at: new Date().toISOString(), count: rows.length, rows }, null, 2),
        );
        zip.file(
          "README.txt",
          `ReconIQ ticket audit export\nGenerated: ${new Date().toISOString()}\nRows: ${rows.length}\nFilters: tenant_id=${tenantId ?? "any-visible"} ticket_id=${ticketId ?? "all"}\n`,
        );
        const blob = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `${base}.zip`; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      toast.success(`Exported ${rows.length} audit rows`);
    } catch (e: unknown) {
      toast.error(safeActionErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex items-center gap-1">
      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run("csv")}>
        <Download className="mr-1 h-3.5 w-3.5" /> {busy === "csv" ? "…" : "Audit CSV"}
      </Button>
      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => run("zip")}>
        <Download className="mr-1 h-3.5 w-3.5" /> {busy === "zip" ? "…" : "ZIP"}
      </Button>
    </div>
  );
}
