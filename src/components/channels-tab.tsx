import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listChannels, upsertChannel, deleteChannel, testChannel } from "@/lib/channels.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Send, Bell } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/confirm-dialog";

const EVENTS = [
  "recon.completed", "recon.failed", "exception.created", "ticket.escalated",
  "ticket.created", "ticket.resolved", "connector.run", "channel.test",
];

export function ChannelsTab({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const list = useServerFn(listChannels);
  const upsert = useServerFn(upsertChannel);
  const del = useServerFn(deleteChannel);
  const test = useServerFn(testChannel);
  const { confirm, ConfirmDialog } = useConfirm();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const q = useQuery({ queryKey: ["channels", tenantId], queryFn: () => list({ data: { tenant_id: tenantId } }) });
  const save = useMutation({
    mutationFn: (v: any) => upsert({ data: v }),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["channels", tenantId] }); setOpen(false); setEditing(null); },
    onError: (e: any) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => del({ data: { id, tenant_id: tenantId } }),
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["channels", tenantId] }); },
  });
  const ping = useMutation({
    mutationFn: (id: string) => test({ data: { id, tenant_id: tenantId } }),
    onSuccess: (r) => toast[r.ok ? "success" : "error"](r.ok ? "Delivered" : r.detail),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2"><Bell className="h-4 w-4" /> Notification channels</CardTitle>
          <CardDescription>Slack, Microsoft Teams, email, and generic webhooks. Subscribe each to specific event kinds.</CardDescription>
        </div>
        {canWrite && (
          <Button size="sm" onClick={() => { setEditing({ channel_type: "slack", events: ["recon.completed", "ticket.escalated"], enabled: true }); setOpen(true); }}>
            <Plus className="mr-1 h-4 w-4" /> Add channel
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {(q.data ?? []).length === 0 && (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            No channels yet. Tip: add Slack #demo-bank-ops-alerts or PagerDuty “Demo Bank Cash Ops On-Call” to route breaks.
          </div>
        )}
        {(q.data ?? []).map((c: any) => (
          <div key={c.id} className="flex items-center justify-between rounded-md border p-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="uppercase text-[10px]">{c.channel_type}</Badge>
                <span className="font-medium">{c.name}</span>
                {c.enabled ? <Badge className="bg-emerald-600">On</Badge> : <Badge variant="secondary">Off</Badge>}
              </div>
              <div className="text-xs text-muted-foreground font-mono truncate max-w-md">{c.target}</div>
              <div className="flex flex-wrap gap-1">{(c.events ?? []).map((e: string) => <Badge key={e} variant="secondary" className="text-[10px]">{e}</Badge>)}</div>
              {c.last_delivery_status && <div className="text-[11px] text-muted-foreground">Last: {c.last_delivery_status}</div>}
            </div>
            {canWrite && (
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => ping.mutate(c.id)} disabled={ping.isPending}><Send className="mr-1 h-3 w-3" /> Test</Button>
                <Button size="sm" variant="ghost" onClick={() => { setEditing(c); setOpen(true); }}>Edit</Button>
                <Button size="sm" variant="ghost" aria-label="Delete" onClick={() => confirm({ title: "Delete channel?", description: c.name }).then((ok) => ok && remove.mutate(c.id))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        ))}
      </CardContent>

      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? "Edit" : "Add"} channel</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>Type</Label>
                  <Select value={editing.channel_type} onValueChange={(v) => setEditing({ ...editing, channel_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="slack">Slack incoming webhook</SelectItem>
                      <SelectItem value="teams">Microsoft Teams webhook</SelectItem>
                      <SelectItem value="email">Email</SelectItem>
                      <SelectItem value="webhook">Generic JSON webhook</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label>Name</Label>
                  <Input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="#demo-bank-ops-alerts" />
                </div>
              </div>
              <div className="space-y-1">
                <Label>{editing.channel_type === "email" ? "Email address" : "Webhook URL"}</Label>
                <Input value={editing.target ?? ""} onChange={(e) => setEditing({ ...editing, target: e.target.value })}
                  placeholder={editing.channel_type === "slack" ? "https://hooks.slack.com/services/T.../B.../..." :
                    editing.channel_type === "teams" ? "https://outlook.office.com/webhook/..." :
                    editing.channel_type === "email" ? "ops@acme.com" : "https://api.example.com/notify"} />
              </div>
              <div className="space-y-1"><Label>Events to deliver</Label>
                <div className="flex flex-wrap gap-2">
                  {EVENTS.map((ev) => {
                    const active = (editing.events ?? []).includes(ev);
                    return (
                      <button key={ev} type="button"
                        onClick={() => setEditing({ ...editing, events: active ? editing.events.filter((x: string) => x !== ev) : [...(editing.events ?? []), ev] })}
                        className={`rounded-md border px-2 py-1 text-xs ${active ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
                        {ev}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div className="text-sm font-medium">Enabled</div>
                <Switch checked={!!editing.enabled} onCheckedChange={(v) => setEditing({ ...editing, enabled: v })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate({ ...editing, tenant_id: tenantId })} disabled={save.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    {ConfirmDialog}
      </Card>
  );
}
