import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listChatOps, upsertChatOps, deleteChatOps, testChatOps } from "@/lib/chat-ops.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { MessageSquare, Plus, Trash2, Send, Mail, Slack } from "lucide-react";
import { toast } from "sonner";

const EVENT_OPTIONS = [
  "recon.completed",
  "recon.failed",
  "exception.created",
  "exception.assigned",
  "break.escalated",
  "ticket.created",
];

export function ChatOpsTab({ tenantId, canWrite, tenantSlug }: { tenantId: string; canWrite: boolean; tenantSlug: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listChatOps);
  const upsert = useServerFn(upsertChatOps);
  const del = useServerFn(deleteChatOps);
  const test = useServerFn(testChatOps);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ platform: "slack", channel: "#nostro-ops", webhook_url: "", events: ["recon.failed", "exception.created"], enabled: true });

  const q = useQuery({ queryKey: ["chatops", tenantId], queryFn: () => list({ data: { tenant_id: tenantId } }) });
  const save = useMutation({
    mutationFn: () => upsert({ data: { tenant_id: tenantId, ...form } }),
    onSuccess: () => { toast.success("Subscription saved"); qc.invalidateQueries({ queryKey: ["chatops", tenantId] }); setOpen(false); },
    onError: (e: any) => toast.error(e.message),
  });

  const slackCmd = `${typeof window !== "undefined" ? window.location.origin : ""}/api/public/chat-ops/slack`;
  const emailAddr = `falcon-${tenantSlug}@chatops.fvi.app`;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><MessageSquare className="h-4 w-4" /> Chat-Ops</CardTitle>
          <CardDescription>
            Drive reconciliations from Slack slash commands and inbound email. Example: <code>/reconiq breaks open Demo Bank Nostro USD</code> (legacy <code>/fvi</code> commands also work) in Slack,
            or email <code>{emailAddr}</code> with subject <code>assign break BRK-2026-00214 to maria.lopez@demo-bank.example</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="rounded-md border p-3">
            <div className="flex items-center gap-2"><Slack className="h-4 w-4" /><span className="font-medium">Slack</span></div>
            <p className="mt-1 text-xs text-muted-foreground">Slash command request URL — paste into your Slack app config:</p>
            <code className="mt-1 block break-all rounded bg-muted px-2 py-1 text-xs">{slackCmd}</code>
            <p className="mt-2 text-xs text-muted-foreground">Set <code>SLACK_SIGNING_SECRET</code> as a tenant secret to verify inbound calls.</p>
          </div>
          <div className="rounded-md border p-3">
            <div className="flex items-center gap-2"><Mail className="h-4 w-4" /><span className="font-medium">Email triggers</span></div>
            <p className="mt-1 text-xs text-muted-foreground">Forward operational mail here to raise tickets and act on breaks:</p>
            <code className="mt-1 block break-all rounded bg-muted px-2 py-1 text-xs">{emailAddr}</code>
            <p className="mt-2 text-xs text-muted-foreground">Supported verbs: <code>assign</code>, <code>close</code>, <code>comment</code>, <code>escalate</code>.</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle>Outbound subscriptions</CardTitle>
            <CardDescription>Where ReconIQ sends recon and break events.</CardDescription>
          </div>
          {canWrite && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-3.5 w-3.5" /> Add</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>New chat-ops subscription</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Platform</Label>
                      <Select value={form.platform} onValueChange={(v) => setForm({ ...form, platform: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="slack">Slack</SelectItem>
                          <SelectItem value="teams">Microsoft Teams</SelectItem>
                          <SelectItem value="email">Email</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Channel / recipient</Label>
                      <Input value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })} placeholder="#nostro-ops or ops@demo-bank.example" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Webhook URL</Label>
                    <Input value={form.webhook_url} onChange={(e) => setForm({ ...form, webhook_url: e.target.value })} placeholder="https://hooks.slack.com/services/T0/B0/…" />
                  </div>
                  <div>
                    <Label className="text-xs">Events</Label>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {EVENT_OPTIONS.map((ev) => {
                        const on = form.events.includes(ev);
                        return (
                          <Badge key={ev} variant={on ? "default" : "outline"} className="cursor-pointer"
                            onClick={() => setForm({ ...form, events: on ? form.events.filter((e: string) => e !== ev) : [...form.events, ev] })}>
                            {ev}
                          </Badge>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex items-center justify-between rounded-md border p-2">
                    <Label className="text-xs">Enabled</Label>
                    <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {q.data?.length === 0 && (
            <p className="text-sm text-muted-foreground">No subscriptions yet. Example: send <code>recon.failed</code> to <code>#nostro-ops</code> in Slack.</p>
          )}
          {(q.data ?? []).map((s: any) => (
            <div key={s.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="uppercase text-[10px]">{s.platform}</Badge>
                  <span className="font-medium">{s.channel}</span>
                  {!s.enabled && <Badge variant="secondary" className="text-[10px]">paused</Badge>}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{(s.events ?? []).join(", ") || "no events"}</p>
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="outline" onClick={() => test({ data: { id: s.id, tenant_id: tenantId } }).then((r: any) => r.ok ? toast.success("Test delivered") : toast.error(r.reason ?? `HTTP ${r.status}`))}>
                  <Send className="h-3.5 w-3.5" />
                </Button>
                {canWrite && (
                  <Button size="sm" variant="ghost" onClick={() => del({ data: { id: s.id, tenant_id: tenantId } }).then(() => qc.invalidateQueries({ queryKey: ["chatops", tenantId] }))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
