import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { BackButton } from "@/components/back-button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { DatabaseBackup, ShieldCheck, ShieldAlert, History, PlusCircle, RefreshCw, Save } from "lucide-react";
import {
  getPlatformBackupStatus,
  updatePlatformBackupConfig,
  listBackupEvents,
  recordBackupEvent,
} from "@/lib/platform-backup.functions";
import { BackupCadenceCard } from "@/components/backup-cadence-card";
import { BackupNotificationsCard } from "@/components/backup-notifications-card";


export const Route = createFileRoute("/_authenticated/platform-backup")({
  head: () => ({
    meta: [
      { title: "Backup & recovery — ReconIQ Platform" },
      { name: "description", content: "PITR status, snapshot retention, latest backups, and full audit trail of restore events." },
    ],
  }),
  component: PlatformBackupPage,
  errorComponent: ({ error }) => (
    <main className="mx-auto max-w-3xl p-8">
      <BackButton />
      <h1 className="mt-6 text-2xl font-bold">Backup & recovery</h1>
      <p className="mt-2 text-destructive">{error instanceof Error ? error.message : "An unexpected error occurred."}</p>
    </main>
  ),
});

function fmt(ts?: string | null) {
  if (!ts) return "—";
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

function PlatformBackupPage() {
  return <PlatformBackupPanel showHeader />;
}

export function PlatformBackupPanel({ showHeader = true }: { showHeader?: boolean } = {}) {
  const qc = useQueryClient();
  const statusFn = useServerFn(getPlatformBackupStatus);
  const updateFn = useServerFn(updatePlatformBackupConfig);
  const listFn = useServerFn(listBackupEvents);
  const recordFn = useServerFn(recordBackupEvent);

  const cfg = useQuery({ queryKey: ["platform-backup-config"], queryFn: () => statusFn() });
  const events = useQuery({ queryKey: ["platform-backup-events"], queryFn: () => listFn({ data: { limit: 100 } }) });

  const [form, setForm] = useState<any>(null);
  const initial = cfg.data;
  const draft = form ?? initial;

  const dirty = useMemo(() => {
    if (!form || !initial) return false;
    return JSON.stringify({ ...form, updated_at: undefined, updated_by: undefined })
      !== JSON.stringify({ ...initial, updated_at: undefined, updated_by: undefined, change_note: undefined });
  }, [form, initial]);

  const save = useMutation({
    mutationFn: () => updateFn({
      data: {
        pitr_enabled: !!draft.pitr_enabled,
        retention_days: Number(draft.retention_days),
        daily_snapshot_retention_days: Number(draft.daily_snapshot_retention_days),
        latest_snapshot_at: draft.latest_snapshot_at || null,
        latest_pitr_window_start: draft.latest_pitr_window_start || null,
        latest_pitr_window_end: draft.latest_pitr_window_end || null,
        provider: draft.provider || "meta-cloud",
        provider_notes: draft.provider_notes || null,
        snapshot_sla_hours: Number(draft.snapshot_sla_hours ?? 26),
        alerts_enabled: !!(draft.alerts_enabled ?? true),
        change_note: draft.change_note || undefined,
      },
    }),
    onSuccess: () => {
      toast.success("Backup configuration updated and audited");
      setForm(null);
      qc.invalidateQueries({ queryKey: ["platform-backup-config"] });
      qc.invalidateQueries({ queryKey: ["platform-backup-events"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Update failed"),
  });

  const record = useMutation({
    mutationFn: (payload: any) => recordFn({ data: payload }),
    onSuccess: () => {
      toast.success("Backup event recorded");
      qc.invalidateQueries({ queryKey: ["platform-backup-events"] });
      qc.invalidateQueries({ queryKey: ["platform-backup-config"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to record event"),
  });

  return (
    <main className={showHeader ? "mx-auto max-w-6xl px-4 py-10" : ""}>
      {showHeader ? <BackButton /> : null}
      <header className={showHeader ? "mt-6 mb-8" : "mb-6"}>
        {showHeader ? (
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">Platform · Reliability</p>
        ) : null}
        <h1 className={`${showHeader ? "mt-2 text-3xl" : "text-2xl"} font-bold tracking-tight text-foreground flex items-center gap-2`}>
          <DatabaseBackup className={showHeader ? "h-7 w-7 text-primary" : "h-6 w-6 text-primary"} aria-hidden />
          Backup & recovery
        </h1>
        <p className="mt-2 max-w-3xl text-muted-foreground text-sm">
          Point-In-Time Recovery status, snapshot retention windows, most-recent backup timestamps, and a
          full audit trail of restore lifecycle events (request → approve → start → complete). Only Platform
          Super Admins can view or edit this page. Every change is written to <code>audit_log</code>.
        </p>
      </header>

      {cfg.isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : cfg.isError ? (
        <p className="text-destructive">{(cfg.error as Error).message}</p>
      ) : (
        <>
          {/* Status header cards */}
          <div className="grid gap-4 md:grid-cols-3 mb-6">
            <StatusCard
              icon={draft.pitr_enabled ? <ShieldCheck className="h-5 w-5" /> : <ShieldAlert className="h-5 w-5" />}
              label="Point-In-Time Recovery"
              tone={draft.pitr_enabled ? "ok" : "warn"}
              value={draft.pitr_enabled ? "Enabled" : "Disabled"}
              sub={draft.pitr_enabled
                ? `Window ${fmt(draft.latest_pitr_window_start)} → ${fmt(draft.latest_pitr_window_end)}`
                : "Daily snapshots only — no sub-day recovery"}
            />
            <StatusCard
              icon={<History className="h-5 w-5" />}
              label="Retention"
              tone="info"
              value={`${draft.retention_days} days`}
              sub={`Daily snapshots retained ${draft.daily_snapshot_retention_days} days · Provider: ${draft.provider}`}
            />
            <StatusCard
              icon={<DatabaseBackup className="h-5 w-5" />}
              label="Latest snapshot"
              tone="info"
              value={fmt(draft.latest_snapshot_at)}
              sub={draft.updated_at ? `Config last updated ${fmt(draft.updated_at)}` : ""}
            />
          </div>

          {/* Cadence chart + SLA alert */}
          <div className="mb-6">
            <BackupCadenceCard events={(events.data as any[]) ?? []} config={draft} />
          </div>

          {/* Config editor */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-base">Backup configuration</CardTitle>
              <CardDescription>
                Reflects the current backend backup posture. Values here should be kept in sync with what
                Meta ops has enabled on the underlying database (PITR add-on tier + snapshot schedule).
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="flex items-center justify-between rounded-lg border p-3 md:col-span-2">
                <div>
                  <Label className="text-sm">PITR enabled</Label>
                  <p className="text-xs text-muted-foreground">Toggle after Meta ops confirms the add-on is active on the backend.</p>
                </div>
                <Switch aria-label="PITR enabled" checked={!!draft.pitr_enabled} onCheckedChange={(v) => setForm({ ...(form ?? initial), pitr_enabled: v })} />
              </div>

              <Field label="PITR retention window (days)">
                <Input aria-label="PITR retention window in days" type="number" min={1} max={90} value={draft.retention_days ?? 7}
                  onChange={(e) => setForm({ ...(form ?? initial), retention_days: Number(e.target.value) })} />
              </Field>
              <Field label="Daily snapshot retention (days)">
                <Input aria-label="Daily snapshot retention in days" type="number" min={1} max={90} value={draft.daily_snapshot_retention_days ?? 7}
                  onChange={(e) => setForm({ ...(form ?? initial), daily_snapshot_retention_days: Number(e.target.value) })} />
              </Field>

              <Field label="Latest snapshot at (ISO 8601)">
                <Input aria-label="Latest snapshot timestamp" type="datetime-local" value={toLocalInput(draft.latest_snapshot_at)}
                  onChange={(e) => setForm({ ...(form ?? initial), latest_snapshot_at: fromLocalInput(e.target.value) })} />
              </Field>
              <Field label="Provider">
                <Select value={draft.provider ?? "meta-cloud"} onValueChange={(v) => setForm({ ...(form ?? initial), provider: v })}>
                  <SelectTrigger aria-label="Backup provider"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="meta-cloud">Meta Cloud (managed)</SelectItem>
                    <SelectItem value="supabase">Supabase (direct)</SelectItem>
                    <SelectItem value="self-hosted">Self-hosted Postgres</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field label="PITR window start">
                <Input aria-label="PITR window start" type="datetime-local" value={toLocalInput(draft.latest_pitr_window_start)}
                  onChange={(e) => setForm({ ...(form ?? initial), latest_pitr_window_start: fromLocalInput(e.target.value) })} />
              </Field>
              <Field label="PITR window end">
                <Input aria-label="PITR window end" type="datetime-local" value={toLocalInput(draft.latest_pitr_window_end)}
                  onChange={(e) => setForm({ ...(form ?? initial), latest_pitr_window_end: fromLocalInput(e.target.value) })} />
              </Field>

              <Field label="Provider notes" className="md:col-span-2">
                <Textarea aria-label="Backup provider notes" rows={2} value={draft.provider_notes ?? ""} onChange={(e) => setForm({ ...(form ?? initial), provider_notes: e.target.value })} />
              </Field>

              <Field label="Snapshot SLA (hours)">
                <Input aria-label="Snapshot SLA in hours" type="number" min={1} max={720} value={draft.snapshot_sla_hours ?? 26}
                  onChange={(e) => setForm({ ...(form ?? initial), snapshot_sla_hours: Number(e.target.value) })} />
              </Field>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label className="text-sm">Alerts enabled</Label>
                  <p className="text-xs text-muted-foreground">Show red banner when SLA breaches or events fail.</p>
                </div>
                <Switch aria-label="Backup alerts enabled" checked={!!(draft.alerts_enabled ?? true)}
                  onCheckedChange={(v) => setForm({ ...(form ?? initial), alerts_enabled: v })} />
              </div>

              <Field label="Change note (recorded in audit log)" className="md:col-span-2">
                <Input aria-label="Backup configuration change note" placeholder="e.g. Enabled 28-day PITR add-on via Meta ops ticket #4821"
                  value={draft.change_note ?? ""} onChange={(e) => setForm({ ...(form ?? initial), change_note: e.target.value })} />
              </Field>

              <div className="md:col-span-2 flex items-center gap-2 justify-end">
                <Button variant="outline" onClick={() => setForm(null)} disabled={!dirty || save.isPending}>Cancel</Button>
                <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
                  <Save className="mr-2 h-4 w-4" /> {save.isPending ? "Saving…" : "Save & audit"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Notification channels */}
          <div className="mb-6">
            <BackupNotificationsCard />
          </div>



          {/* Events */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">Backup & recovery audit trail</CardTitle>
                <CardDescription>
                  Every snapshot, restore, and config change. Also mirrored to the platform-wide
                  <Link to="/security-appendix" className="ml-1 underline">audit log</Link>.
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => events.refetch()}>
                  <RefreshCw className="mr-2 h-4 w-4" /> Refresh
                </Button>
                <RecordEventDialog onSubmit={(p) => record.mutate(p)} pending={record.isPending} />
              </div>
            </CardHeader>
            <CardContent>
              {events.isLoading ? (
                <p className="text-muted-foreground">Loading events…</p>
              ) : (events.data ?? []).length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  No backup or restore events yet. Config changes and manually recorded restore events will appear here.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>When</TableHead>
                        <TableHead>Event</TableHead>
                        <TableHead>Actor</TableHead>
                        <TableHead>Target recovery</TableHead>
                        <TableHead>Restored at</TableHead>
                        <TableHead>Scope</TableHead>
                        <TableHead>Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(events.data as any[]).map((e) => (
                        <TableRow key={e.id}>
                          <TableCell className="whitespace-nowrap text-xs">{fmt(e.created_at)}</TableCell>
                          <TableCell><Badge variant="outline">{e.event_type}</Badge></TableCell>
                          <TableCell className="text-xs">{e.actor_email ?? e.actor_id?.slice(0, 8)}</TableCell>
                          <TableCell className="text-xs">{fmt(e.target_recovery_at)}</TableCell>
                          <TableCell className="text-xs">{fmt(e.restored_at)}</TableCell>
                          <TableCell className="text-xs">{e.scope ?? "—"}</TableCell>
                          <TableCell className="text-xs max-w-[24rem] truncate" title={e.notes ?? ""}>{e.notes ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}

function StatusCard({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub?: string; tone: "ok" | "warn" | "info" }) {
  const toneCls = tone === "ok" ? "border-primary/40 bg-primary/5"
    : tone === "warn" ? "border-destructive/40 bg-destructive/5"
    : "border-border";
  return (
    <Card className={toneCls}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground font-medium">
          {icon} {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold text-foreground">{value}</p>
        {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
      </CardContent>
    </Card>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function toLocalInput(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v: string) {
  if (!v) return null;
  return new Date(v).toISOString();
}

function RecordEventDialog({ onSubmit, pending }: { onSubmit: (p: any) => void; pending: boolean }) {
  const [open, setOpen] = useState(false);
  const [event_type, setType] = useState("restore_requested");
  const [target_recovery_at, setTarget] = useState("");
  const [restored_at, setRestored] = useState("");
  const [scope, setScope] = useState("");
  const [notes, setNotes] = useState("");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><PlusCircle className="mr-2 h-4 w-4" /> Record event</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Record backup / recovery event</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <Field label="Event type">
            <Select value={event_type} onValueChange={setType}>
              <SelectTrigger aria-label="Backup event type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="snapshot_recorded">snapshot_recorded</SelectItem>
                <SelectItem value="restore_requested">restore_requested</SelectItem>
                <SelectItem value="restore_approved">restore_approved</SelectItem>
                <SelectItem value="restore_started">restore_started</SelectItem>
                <SelectItem value="restore_completed">restore_completed</SelectItem>
                <SelectItem value="restore_failed">restore_failed</SelectItem>
                <SelectItem value="pitr_enabled">pitr_enabled</SelectItem>
                <SelectItem value="pitr_disabled">pitr_disabled</SelectItem>
                <SelectItem value="test_drill">test_drill</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Target recovery timestamp (what point-in-time was requested)">
            <Input aria-label="Target recovery timestamp" type="datetime-local" value={target_recovery_at} onChange={(e) => setTarget(e.target.value)} />
          </Field>
          <Field label="Restored at (when the restore finished)">
            <Input aria-label="Restore completion timestamp" type="datetime-local" value={restored_at} onChange={(e) => setRestored(e.target.value)} />
          </Field>
          <Field label="Scope (e.g. tenant slug, whole-DB, single table)">
            <Input aria-label="Backup event scope" value={scope} onChange={(e) => setScope(e.target.value)} placeholder="whole-db" />
          </Field>
          <Field label="Notes / justification (required for restores)">
            <Textarea aria-label="Backup event notes and justification" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Restore requested by CISO after ransomware drill" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={pending} onClick={() => {
            onSubmit({
              event_type,
              target_recovery_at: target_recovery_at ? new Date(target_recovery_at).toISOString() : null,
              restored_at: restored_at ? new Date(restored_at).toISOString() : null,
              scope: scope || null,
              notes: notes || null,
            });
            setOpen(false);
            setTarget(""); setRestored(""); setScope(""); setNotes("");
          }}>{pending ? "Recording…" : "Record"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
