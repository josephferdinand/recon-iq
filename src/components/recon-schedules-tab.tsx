import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { formatUserMessage, mapKnownFailure, type UserMessage, type UserMessageCategory } from "@/lib/user-message";
import { isValidReconCron } from "@/lib/recon-cron";
import {
  listReconSchedules,
  upsertReconSchedule,
  deleteReconSchedule,
  triggerReconScheduleNow,
  listScheduleRuns,
} from "@/lib/recon-schedules.functions";
import { listRecons } from "@/lib/recons.functions";
import { ALL_RECON_SCHEDULE_PRESETS, RECON_SCHEDULE_PRESETS } from "@/lib/recon-schedule-presets";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Play, Trash2, Clock, History, AlertCircle, CheckCircle2, Pencil } from "lucide-react";

function scheduleWriteFailure(error: unknown, action: string, actionId: string, actionLabel: string): UserMessage {
  const candidate = error && typeof error === "object" ? error as { code?: unknown; status?: unknown } : {};
  const code = typeof candidate.code === "string" ? candidate.code : undefined;
  const status = typeof candidate.status === "number" ? candidate.status : undefined;
  const mapped = mapKnownFailure(code, status);
  const definite = ["input", "business", "auth", "session", "mfa"].includes(mapped.category);
  const category: UserMessageCategory = definite ? mapped.category : "unknown_write_outcome";
  return formatUserMessage({ ...mapped, category, action, code, status, availableActions: category === "unknown_write_outcome" ? [{ id: actionId, label: actionLabel }] : [] });
}

export function ReconSchedulesTab({
  tenantId,
  canWrite,
}: {
  tenantId: string;
  canWrite: boolean;
}) {
  const qc = useQueryClient();
  const fetchSchedules = useServerFn(listReconSchedules);
  const fetchRecons = useServerFn(listRecons);
  const upsertFn = useServerFn(upsertReconSchedule);
  const deleteFn = useServerFn(deleteReconSchedule);
  const triggerFn = useServerFn(triggerReconScheduleNow);

  const schedQ = useQuery({
    queryKey: ["recon-schedules", tenantId],
    queryFn: () => fetchSchedules({ data: { tenant_id: tenantId } }),
  });
  const reconsQ = useQuery({
    queryKey: ["recons", tenantId],
    queryFn: () => fetchRecons({ data: { tenant_id: tenantId } }),
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [scheduleMessage, setScheduleMessage] = useState<UserMessage | null>(null);
  const [scheduleMessageContext, setScheduleMessageContext] = useState<"page" | "form">("page");
  const [scheduleFieldErrors, setScheduleFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [historyScheduleId, setHistoryScheduleId] = useState<string | null>(null);
  const [historyOpenRequested, setHistoryOpenRequested] = useState(false);
  const [scheduleReadbackConfirmed, setScheduleReadbackConfirmed] = useState(false);
  const [form, setForm] = useState({
    definition_id: "",
    name: "",
    cron_expression: "0 * * * *",
    enabled: true,
  });

  const reset = () => {
    setForm({ definition_id: "", name: "", cron_expression: "0 * * * *", enabled: true });
    setEditing(null);
  };

  const mSave = useMutation({
    mutationFn: () =>
      upsertFn({
        data: {
          ...(editing ? { id: editing.id } : {}),
          tenant_id: tenantId,
          ...form,
        },
      }),
    onSuccess: () => {
      setScheduleMessage(null);
      setScheduleFieldErrors({});
      toast.success(editing ? "Schedule updated" : "Schedule created");
      setOpen(false);
      reset();
      qc.invalidateQueries({ queryKey: ["recon-schedules", tenantId] });
    },
    onError: (error) => {
      setScheduleMessageContext("form");
      setScheduleMessage(scheduleWriteFailure(error, "save this reconciliation schedule", "refresh-schedules", "Refresh schedule list before retrying"));
    },
  });

  const mDelete = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id, tenant_id: tenantId } }),
    onSuccess: () => {
      setScheduleMessage(null);
      toast.success("Schedule deleted");
      qc.invalidateQueries({ queryKey: ["recon-schedules", tenantId] });
    },
    onError: (error) => {
      setScheduleMessageContext("page");
      setScheduleMessage(scheduleWriteFailure(error, "delete this reconciliation schedule", "refresh-schedules", "Refresh schedules"));
    },
  });

  const mTrigger = useMutation({
    mutationFn: (id: string) => triggerFn({ data: { id, tenant_id: tenantId } }),
    onSuccess: (r, id) => {
      if (r.ok) toast.success(`Ran: ${r.matched} matched · ${r.exceptions} exceptions`);
      else {
        setScheduleMessageContext("page");
        setHistoryScheduleId(id);
        setScheduleMessage(scheduleWriteFailure(r, "run this reconciliation schedule", "open-schedule-history", "Open schedule history before deciding whether to run again"));
      }
      qc.invalidateQueries({ queryKey: ["recon-schedules", tenantId] });
      qc.invalidateQueries({ queryKey: ["recon-runs", tenantId] });
      qc.invalidateQueries({ queryKey: ["schedule-runs", id] });
    },
    onError: (error, id) => {
      setScheduleMessageContext("page");
      setHistoryScheduleId(id);
      setScheduleMessage(scheduleWriteFailure(error, "run this reconciliation schedule", "open-schedule-history", "Open schedule history before deciding whether to run again"));
    },
  });

  const openCreate = () => {
    reset();
    setScheduleFieldErrors({});
    setScheduleMessage(null);
    setScheduleReadbackConfirmed(false);
    setOpen(true);
  };
  const openEdit = (s: any) => {
    setScheduleFieldErrors({});
    setScheduleMessage(null);
    setScheduleReadbackConfirmed(false);
    setEditing(s);
    setForm({
      definition_id: s.definition_id,
      name: s.name,
      cron_expression: s.cron_expression,
      enabled: s.enabled,
    });
    setOpen(true);
  };

  function submitScheduleSave() {
    const fields: Array<{ field: string; issue: "required" | "invalid_format" | "too_long" }> = [];
    if (!form.definition_id) fields.push({ field: "Reconciliation", issue: "required" });
    if (!form.name.trim()) fields.push({ field: "Schedule name", issue: "required" });
    else if (form.name.trim().length > 120) fields.push({ field: "Schedule name", issue: "too_long" });
    if (!form.cron_expression.trim()) fields.push({ field: "Cron expression", issue: "required" });
    else if (form.cron_expression.length < 5 || form.cron_expression.length > 120 || !isValidReconCron(form.cron_expression)) fields.push({ field: "Cron expression", issue: "invalid_format" });
    if (fields.length) {
      const message = formatUserMessage({ category: "input", action: "save this reconciliation schedule", fields: fields.map((field) => ({ ...field, limit: field.issue === "too_long" ? 120 : undefined })) });
      setScheduleFieldErrors(message.fieldErrors);
      setScheduleMessageContext("form");
      setScheduleMessage(message);
      return;
    }
    setScheduleFieldErrors({});
    setScheduleMessage(null);
    mSave.mutate();
  }

  function scheduleMessageView(context: typeof scheduleMessageContext) {
    if (!scheduleMessage || scheduleMessageContext !== context) return null;
    return <div role="alert" aria-live="assertive" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"><p className="font-medium">{scheduleMessage.title}</p><p className="mt-1">{scheduleMessage.humanMessage}</p>{context !== "form" ? Object.entries(scheduleMessage.fieldErrors).map(([field, copy]) => <p key={field} className="mt-1 text-destructive">{copy}</p>) : null}{scheduleReadbackConfirmed ? <p className="mt-1">The schedule list was refreshed. Review the schedule rows before submitting again.</p> : null}{scheduleMessage.nextActions.map((action) => <Button key={action.id} type="button" size="sm" variant="outline" className="mt-2 mr-2" onClick={() => { if (action.id === "refresh-schedules") { void schedQ.refetch().then((result) => { if (result.isSuccess) setScheduleReadbackConfirmed(true); }); } if (action.id === "open-schedule-history" && historyScheduleId) setHistoryOpenRequested(true); }}>{action.label}</Button>)}</div>;
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-4 w-4" /> Recon Orchestrator
            </CardTitle>
            <CardDescription>
              Manage recurring reconciliation schedules. Cadences use UTC; the orchestrator checks every minute and records each run in history.
            </CardDescription>
          </div>
          {canWrite ? (
            <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) { if (scheduleMessage?.category !== "unknown_write_outcome") reset(); setScheduleMessageContext("page"); } }}>
              <DialogTrigger asChild>
                <Button onClick={openCreate}><Plus className="mr-1 h-4 w-4" /> New schedule</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{editing ? "Edit schedule" : "New schedule"}</DialogTitle>
                </DialogHeader>
                {scheduleMessageView("form")}
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="recon-schedule-definition">Reconciliation</Label>
                    <Select
                      value={form.definition_id}
                      onValueChange={(v) => { setForm((f) => ({ ...f, definition_id: v })); setScheduleFieldErrors((current) => { const next = { ...current }; delete next.Reconciliation; return next; }); }}
                    >
                      <SelectTrigger id="recon-schedule-definition" aria-label="Reconciliation" aria-invalid={Boolean(scheduleFieldErrors.Reconciliation)}><SelectValue placeholder="Select a reconciliation" /></SelectTrigger>
                      <SelectContent>
                        {(reconsQ.data ?? []).map((r: any) => (
                          <SelectItem key={r.id} value={r.id}>
                            {r.name} <span className="text-muted-foreground">· {r.recon_type}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {reconsQ.isPending ? (
                      <p role="status" aria-live="polite" className="mt-1 text-xs text-muted-foreground">
                        Loading reconciliations…
                      </p>
                    ) : null}
                    {scheduleFieldErrors.Reconciliation ? <p role="alert" className="mt-1 text-xs text-destructive">{scheduleFieldErrors.Reconciliation}</p> : null}
                    {reconsQ.isError ? (
                      <div role="alert" className="mt-1 flex flex-wrap items-center gap-2 text-xs text-destructive">
                        <span>{reconsQ.data?.length === 0 ? "Refresh failed; the last successful read found no reconciliations." : reconsQ.data ? "Refresh failed; showing the last loaded reconciliation list." : "Reconciliation list is temporarily unavailable."}</span>
                        <Button size="sm" variant="outline" onClick={() => void reconsQ.refetch()}>
                          Try again
                        </Button>
                      </div>
                    ) : null}
                    {!reconsQ.isPending && !reconsQ.isError && reconsQ.data?.length === 0 ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        No reconciliations are available to schedule. Create a reconciliation first.
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <Label htmlFor="recon-schedule-name">Schedule name</Label>
                    <Input
                      id="recon-schedule-name"
                      value={form.name}
                      maxLength={120}
                      aria-invalid={Boolean(scheduleFieldErrors["Schedule name"])}
                      aria-describedby={scheduleFieldErrors["Schedule name"] ? "recon-schedule-name-error" : "recon-schedule-name-help"}
                      onChange={(e) => { setForm((f) => ({ ...f, name: e.target.value })); setScheduleFieldErrors((current) => { const next = { ...current }; delete next["Schedule name"]; return next; }); }}
                      placeholder="e.g. Daily ledger close"
                    />
                    <p id="recon-schedule-name-help" className="mt-1 text-xs text-muted-foreground">Use 1–120 characters.</p>
                    {scheduleFieldErrors["Schedule name"] ? <p id="recon-schedule-name-error" role="alert" className="mt-1 text-xs text-destructive">{scheduleFieldErrors["Schedule name"]}</p> : null}
                  </div>
                  <div>
                    <Label htmlFor="recon-schedule-preset">Cadence preset</Label>
                    <Select
                      value={ALL_RECON_SCHEDULE_PRESETS.find((p) => p.value === form.cron_expression)?.value ?? "custom"}
                      onValueChange={(v) => v !== "custom" && setForm((f) => ({ ...f, cron_expression: v }))}
                    >
                      <SelectTrigger id="recon-schedule-preset" aria-label="Cadence preset"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {RECON_SCHEDULE_PRESETS.map((group) => (
                          <SelectGroup key={group.group}>
                            <SelectLabel className="text-[10px] uppercase">{group.group}</SelectLabel>
                            {group.options.map((preset) => (
                              <SelectItem key={preset.value} value={preset.value}>{preset.label}</SelectItem>
                            ))}
                          </SelectGroup>
                        ))}
                        <SelectItem value="custom">Custom cron…</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="recon-schedule-cron">Cron expression (UTC)</Label>
                    <Input
                      id="recon-schedule-cron"
                      value={form.cron_expression}
                      maxLength={120}
                      aria-invalid={Boolean(scheduleFieldErrors["Cron expression"])}
                      aria-describedby={scheduleFieldErrors["Cron expression"] ? "recon-schedule-cron-error" : undefined}
                      onChange={(e) => { setForm((f) => ({ ...f, cron_expression: e.target.value })); setScheduleFieldErrors((current) => { const next = { ...current }; delete next["Cron expression"]; return next; }); }}
                      placeholder="e.g. 0 6 * * 1-5 — Demo Bank Nostro USD weekdays 06:00 UTC"
                      className="font-mono"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      5-field format: <code>min hour dom month dow</code>. All times are UTC. The orchestrator checks once per minute, so a run may start shortly after its scheduled time.
                    </p>
                    {scheduleFieldErrors["Cron expression"] ? <p id="recon-schedule-cron-error" role="alert" className="mt-1 text-xs text-destructive">{scheduleFieldErrors["Cron expression"]}</p> : null}
                  </div>
                  <div className="flex items-center justify-between rounded-md border p-3">
                    <div>
                      <Label htmlFor="recon-schedule-enabled">Enabled</Label>
                      <p className="text-xs text-muted-foreground">When off, the orchestrator skips this schedule.</p>
                    </div>
                    <Switch id="recon-schedule-enabled" checked={form.enabled} onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))} />
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => { setOpen(false); if (scheduleMessage?.category !== "unknown_write_outcome") reset(); setScheduleMessageContext("page"); }}>Cancel</Button>
                    <Button
                      disabled={mSave.isPending}
                      onClick={submitScheduleSave}
                    >
                      {editing ? "Save changes" : "Create schedule"}
                    </Button>
                  </DialogFooter>
                </div>
              </DialogContent>
            </Dialog>
          ) : null}
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {!open ? scheduleMessageView("page") : null}
          <table aria-label="Recurring reconciliation schedules" className="w-full min-w-[850px] text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Reconciliation</th>
                <th className="px-4 py-2">Cadence (UTC)</th>
                <th className="px-4 py-2">Schedule status</th>
                <th className="px-4 py-2">Last run</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {schedQ.isPending ? (
                <tr><td colSpan={6} role="status" aria-live="polite" className="px-4 py-8 text-center text-muted-foreground">Loading schedules…</td></tr>
              ) : null}
              {schedQ.isError && !schedQ.data ? (
                <tr>
                  <td colSpan={6} role="alert" className="px-4 py-8 text-center text-destructive">
                    <p>Schedule information is temporarily unavailable.</p>
                    <Button size="sm" variant="outline" className="mt-2" onClick={() => void schedQ.refetch()}>
                      Try again
                    </Button>
                  </td>
                </tr>
              ) : null}
              {schedQ.isError && schedQ.data ? (
                <tr>
                  <td colSpan={6} role="alert" className="px-4 py-3 text-center text-amber-800 dark:text-amber-200">
                    Schedule refresh failed. Below is the last successful result.
                    <Button size="sm" variant="outline" className="ml-2" onClick={() => void schedQ.refetch()}>
                      Try again
                    </Button>
                  </td>
                </tr>
              ) : null}
              {schedQ.data?.map((s: any) => (
                <tr key={s.id} className="border-b align-top">
                  <td className="px-4 py-3">
                    <span className="font-medium">{s.name}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {s.definition?.name ?? "—"}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{s.cron_expression}</td>
                  <td className="px-4 py-3">
                    {s.enabled ? <Badge>Enabled</Badge> : <div><Badge variant="outline">Paused</Badge><p className="mt-1 text-xs text-muted-foreground">Automatic dispatch is paused.</p></div>}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {s.last_run_at
                      ? formatUtcTimestamp(s.last_run_at)
                      : s.last_status
                        ? "Run time unavailable"
                        : "Never"}
                    {s.last_status === "failed" ? (
                      <div className="mt-1"><Badge variant="destructive"><AlertCircle className="mr-1 h-3 w-3" />Failed</Badge></div>
                    ) : s.last_status === "retry_scheduled" ? (
                      <div className="mt-1"><Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300"><Clock className="mr-1 h-3 w-3" />Retry queued</Badge></div>
                    ) : s.last_status === "completed" ? (
                      <div className="mt-1"><Badge variant="outline"><CheckCircle2 className="mr-1 h-3 w-3" />Completed</Badge></div>
                    ) : null}
                    {s.last_error ? (
                      <div className="mt-1 text-destructive line-clamp-2">A run issue was recorded. Open history to review it.</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex flex-wrap justify-end gap-1">
                      {canWrite ? (
                        <Button size="sm" variant="outline" onClick={() => openEdit(s)} aria-label={`Edit schedule ${s.name}`}>
                          <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                        </Button>
                      ) : null}
                      {canWrite ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={mTrigger.isPending}
                          onClick={() => mTrigger.mutate(s.id)}
                          aria-label={`Run schedule ${s.name} now`}
                        >
                          <Play className="mr-1 h-3.5 w-3.5" /> Run now
                        </Button>
                      ) : null}
                      <ScheduleRunsButton scheduleId={s.id} scheduleName={s.name} tenantId={tenantId} requestOpen={historyOpenRequested && historyScheduleId === s.id} onRequestOpened={() => setHistoryOpenRequested(false)} />
                      {canWrite ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          aria-label={`Delete schedule ${s.name}`}
                          disabled={mDelete.isPending}
                          onClick={() => {
                            if (confirm(`Delete schedule "${s.name}"?`)) mDelete.mutate(s.id);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {!schedQ.isPending && schedQ.data?.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                    {schedQ.isError
                      ? "The last successful read found no schedules."
                      : canWrite
                        ? "No recurring schedules are configured yet. Use New schedule to create one."
                        : "No recurring schedules are configured for this workspace."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function ScheduleRunsButton({ scheduleId, scheduleName, tenantId, requestOpen = false, onRequestOpened }: { scheduleId: string; scheduleName: string; tenantId: string; requestOpen?: boolean; onRequestOpened?: () => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!requestOpen) return;
    setOpen(true);
    onRequestOpened?.();
  }, [requestOpen, onRequestOpened]);
  const fetchRuns = useServerFn(listScheduleRuns);
  const runsQ = useQuery({
    queryKey: ["schedule-runs", scheduleId],
    queryFn: () => fetchRuns({ data: { schedule_id: scheduleId, tenant_id: tenantId } }),
    enabled: open,
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" aria-label={`View history for schedule ${scheduleName}`}><History className="mr-1 h-3.5 w-3.5" />History</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Orchestrator history</DialogTitle></DialogHeader>
        <div className="max-h-[60vh] overflow-auto">
          {runsQ.isPending ? <p role="status" aria-live="polite" className="p-4 text-sm text-muted-foreground">Loading schedule history…</p> : null}
          {runsQ.isError ? (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm text-destructive">
              <span>{runsQ.data?.length === 0 ? "History refresh failed; the last successful read found no runs." : runsQ.data ? "History refresh failed. Showing the last loaded records." : "Schedule history is temporarily unavailable."}</span>
              <Button size="sm" variant="outline" onClick={() => void runsQ.refetch()}>Try again</Button>
            </div>
          ) : null}
          <table className="w-full min-w-[650px] text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Scheduled / started</th>
                <th className="px-3 py-2">Trigger</th>
                <th className="px-3 py-2">Attempt</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Matched</th>
                <th className="px-3 py-2">Exceptions</th>
              </tr>
            </thead>
            <tbody>
              {runsQ.data?.map((r: any) => (
                <tr key={r.id} className="border-b">
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {formatUtcTimestamp(r.scheduled_for ?? r.started_at)}
                    {r.scheduled_for && r.scheduled_for !== r.started_at ? (
                      <div>Started {formatUtcTimestamp(r.started_at)}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2"><Badge variant="outline">{r.trigger}</Badge></td>
                  <td className="px-3 py-2 text-xs">{r.attempt ?? 1} / {r.max_attempts ?? 1}</td>
                  <td className="px-3 py-2">
                    <Badge variant={r.status === "completed" ? "default" : r.status === "failed" ? "destructive" : "outline"}>
                      {r.status}
                    </Badge>
                    {r.retry_after && !r.superseded_by_id ? (
                      <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                        Retry {formatUtcTimestamp(r.retry_after)}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-xs">{r.matched_count ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">{r.exception_count ?? "—"}</td>
                </tr>
              ))}
              {!runsQ.isPending && runsQ.data?.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  {runsQ.isError ? "The last successful history read found no runs." : "No runs recorded for this schedule yet."}
                </td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatUtcTimestamp(value: string) {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return "Time unavailable";
  return `${new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(timestamp)} UTC`;
}
