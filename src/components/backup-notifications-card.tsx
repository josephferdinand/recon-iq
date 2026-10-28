// Platform · Backup notification channels management.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  listBackupNotificationChannels,
  upsertBackupNotificationChannel,
  deleteBackupNotificationChannel,
  testBackupNotificationChannel,
  NOTIFY_EVENTS,
  type NotificationChannel,
} from "@/lib/backup-notifications.functions";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription, DialogTrigger,
} from "@/components/ui/dialog";
import { Bell, PlusCircle, Send, Trash2, Pencil, Mail, Webhook, MessageSquare } from "lucide-react";
import { toast } from "sonner";

const typeIcon = (t: string) =>
  t === "email" ? <Mail className="h-3.5 w-3.5" />
    : t === "slack" ? <MessageSquare className="h-3.5 w-3.5" />
    : <Webhook className="h-3.5 w-3.5" />;

type FormState = {
  id?: string;
  channel_type: "email" | "webhook" | "slack";
  label: string;
  target: string;
  enabled: boolean;
  notify_on: string[];
  secret: string;
};

const empty: FormState = {
  channel_type: "email",
  label: "",
  target: "",
  enabled: true,
  notify_on: ["sla_breach", "backup_failed", "restore_failed"],
  secret: "",
};

export function BackupNotificationsCard() {
  const qc = useQueryClient();
  const listFn = useServerFn(listBackupNotificationChannels);
  const upsertFn = useServerFn(upsertBackupNotificationChannel);
  const deleteFn = useServerFn(deleteBackupNotificationChannel);
  const testFn = useServerFn(testBackupNotificationChannel);

  const q = useQuery({ queryKey: ["backup-notif-channels"], queryFn: () => listFn() });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(empty);

  const upsert = useMutation({
    mutationFn: () => upsertFn({ data: {
      id: form.id,
      channel_type: form.channel_type,
      label: form.label,
      target: form.target,
      enabled: form.enabled,
      notify_on: form.notify_on as any,
      secret: form.secret || null,
    } }),
    onSuccess: () => {
      toast.success("Channel saved");
      setOpen(false);
      setForm(empty);
      qc.invalidateQueries({ queryKey: ["backup-notif-channels"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Channel deleted");
      qc.invalidateQueries({ queryKey: ["backup-notif-channels"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const test = useMutation({
    mutationFn: (id: string) => testFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Test alert dispatched");
      qc.invalidateQueries({ queryKey: ["backup-notif-channels"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = q.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4" /> SLA & failure notifications
          </CardTitle>
          <CardDescription>
            Send email, Slack, or generic webhook alerts when the platform SLA is breached
            or a backup / restore event fails. Every channel is audit-logged.
          </CardDescription>
        </div>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setForm(empty); }}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={() => setForm(empty)}>
              <PlusCircle className="mr-2 h-4 w-4" /> Add channel
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{form.id ? "Edit channel" : "New notification channel"}</DialogTitle>
              <DialogDescription>
                Choose a channel type and which events should fan out to this target.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Type</Label>
                  <Select value={form.channel_type} onValueChange={(v: any) => setForm({ ...form, channel_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="email">Email</SelectItem>
                      <SelectItem value="slack">Slack Incoming Webhook</SelectItem>
                      <SelectItem value="webhook">Generic webhook (JSON POST)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Label</Label>
                  <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })}
                    placeholder="e.g. #ops-alerts" />
                </div>
              </div>
              <div>
                <Label>
                  {form.channel_type === "email" ? "Email address"
                    : form.channel_type === "slack" ? "Slack webhook URL"
                    : "Webhook URL"}
                </Label>
                <Input value={form.target} onChange={(e) => setForm({ ...form, target: e.target.value })}
                  placeholder={form.channel_type === "email" ? "alerts@example.com" : "https://hooks.slack.com/..."} />
              </div>
              {form.channel_type === "webhook" && (
                <div>
                  <Label>HMAC secret (optional)</Label>
                  <Input value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })}
                    placeholder="Signs the body as sha256 X-FVI-Signature header" />
                </div>
              )}
              <div>
                <Label>Notify on</Label>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {NOTIFY_EVENTS.map((e) => (
                    <label key={e} className="flex items-center gap-2 rounded-md border p-2 text-xs">
                      <Checkbox
                        checked={form.notify_on.includes(e)}
                        onCheckedChange={(v) => {
                          const set = new Set(form.notify_on);
                          if (v) set.add(e); else set.delete(e);
                          setForm({ ...form, notify_on: Array.from(set) });
                        }}
                      />
                      <span className="font-mono">{e}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <Label>Enabled</Label>
                  <p className="text-xs text-muted-foreground">Disabled channels never dispatch.</p>
                </div>
                <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                onClick={() => upsert.mutate()}
                disabled={upsert.isPending || !form.label || !form.target || form.notify_on.length === 0}
              >
                {upsert.isPending ? "Saving…" : "Save channel"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-0">
        {q.isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            No channels configured yet. Add an email, Slack webhook, or generic webhook to receive alerts.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2">Label</th>
                  <th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2">Target</th>
                  <th className="px-4 py-2">Events</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Last dispatch</th>
                  <th className="px-4 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c: NotificationChannel) => (
                  <tr key={c.id} className="border-b">
                    <td className="px-4 py-2 font-medium">{c.label}</td>
                    <td className="px-4 py-2">
                      <Badge variant="outline" className="gap-1">{typeIcon(c.channel_type)}{c.channel_type}</Badge>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs max-w-[16rem] truncate" title={c.target}>{c.target}</td>
                    <td className="px-4 py-2 text-xs">
                      <div className="flex flex-wrap gap-1">
                        {c.notify_on.map((e) => <Badge key={e} variant="secondary" className="text-[10px]">{e}</Badge>)}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {c.enabled
                        ? <Badge variant="outline" className="border-primary/40 text-primary">enabled</Badge>
                        : <Badge variant="outline" className="text-muted-foreground">disabled</Badge>}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {c.last_dispatched_at ? (
                        <>
                          <div>{new Date(c.last_dispatched_at).toLocaleString()}</div>
                          <div className={c.last_status === "ok" ? "text-primary" : "text-destructive"}>
                            {c.last_status}{c.last_error ? ` · ${c.last_error}` : ""}
                          </div>
                        </>
                      ) : <span className="text-muted-foreground">never</span>}
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => test.mutate(c.id)} title="Send test alert">
                        <Send className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => {
                        setForm({
                          id: c.id,
                          channel_type: c.channel_type,
                          label: c.label,
                          target: c.target,
                          enabled: c.enabled,
                          notify_on: c.notify_on,
                          secret: c.secret ?? "",
                        });
                        setOpen(true);
                      }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => {
                        if (confirm(`Delete channel "${c.label}"?`)) del.mutate(c.id);
                      }}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
