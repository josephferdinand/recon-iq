import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { notifyUserError } from "@/lib/user-feedback";
import {
  listWebhooks,
  createWebhook,
  toggleWebhook,
  deleteWebhook,
  listWebhookDeliveries,
  listWebhookOutbox,
  replayWebhookOutbox,
  getWebhookHealth,
} from "@/lib/webhooks.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Webhook, Trash2, Copy, RotateCcw, Activity } from "lucide-react";


const ALL_EVENTS = [
  "recon.run.completed",
  "exception.created",
  "exception.resolved",
  "signoff.certified",
  "aidp.extraction.completed",
  "agent.action.proposed",
  "agent.action.approved",
];

export function WebhooksTab({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const list = useServerFn(listWebhooks);
  const create = useServerFn(createWebhook);
  const toggle = useServerFn(toggleWebhook);
  const del = useServerFn(deleteWebhook);
  const listDeliveries = useServerFn(listWebhookDeliveries);

  const q = useQuery({
    queryKey: ["webhooks", tenantId],
    queryFn: () => list({ data: { tenantId } }),
  });

  const [name, setName] = useState("Demo Bank — Ops Slack relay");
  const [url, setUrl] = useState("https://hooks.demo-bank.example/fvi");
  const [events, setEvents] = useState<string[]>(["recon.run.completed", "exception.created"]);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [selectedSub, setSelectedSub] = useState<string | null>(null);

  const mCreate = useMutation({
    mutationFn: () => create({ data: { tenantId, name, url, events } }),
    onSuccess: (r) => {
      setRevealedSecret(r.secret);
      qc.invalidateQueries({ queryKey: ["webhooks", tenantId] });
      toast.success("Webhook created. Copy the signing secret now — it will not be shown again.");
    },
    onError: (e: Error) => notifyUserError(e, "webhook creation"),
  });

  const mToggle = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) => toggle({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["webhooks", tenantId] }),
    onError: (e: Error) => notifyUserError(e, "webhook status"),
  });

  const mDelete = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => {
      toast.success("Webhook deleted");
      qc.invalidateQueries({ queryKey: ["webhooks", tenantId] });
    },
    onError: (e: Error) => notifyUserError(e, "webhook removal"),
  });

  const deliveries = useQuery({
    queryKey: ["webhook-deliveries", selectedSub],
    queryFn: () => listDeliveries({ data: { subscriptionId: selectedSub!, limit: 25 } }),
    enabled: !!selectedSub,
  });

  const health = useQuery({
    queryKey: ["webhook-health", tenantId],
    queryFn: () => getWebhookHealth({ data: { tenantId } }),
    refetchInterval: 30_000,
  });

  const listOutbox = useServerFn(listWebhookOutbox);
  const replay = useServerFn(replayWebhookOutbox);
  const [outboxFilter, setOutboxFilter] = useState<"dead" | "failed" | "pending">("dead");
  const outbox = useQuery({
    queryKey: ["webhook-outbox", tenantId, outboxFilter],
    queryFn: () => listOutbox({ data: { tenantId, status: outboxFilter, limit: 50 } }),
  });
  const mReplay = useMutation({
    mutationFn: (id: string) => replay({ data: { outboxId: id } }),
    onSuccess: () => {
      toast.success("Re-enqueued for delivery");
      qc.invalidateQueries({ queryKey: ["webhook-outbox", tenantId] });
      qc.invalidateQueries({ queryKey: ["webhook-health", tenantId] });
    },
    onError: (e: Error) => notifyUserError(e, "webhook replay"),
  });


  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="h-4 w-4" /> Delivery health (last 24h)
          </CardTitle>
          <CardDescription>Rolling counters across all Demo Bank webhook subscriptions.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {[
              { k: "subscriptions", label: "Active subs", tone: "default" as const },
              { k: "delivered", label: "Delivered", tone: "default" as const },
              { k: "pending", label: "Pending", tone: "secondary" as const },
              { k: "failed", label: "Failed", tone: "destructive" as const },
              { k: "dead", label: "Dead-letter", tone: "destructive" as const },
            ].map((s) => (
              <div key={s.k} className="rounded-md border p-3">
                <div className="text-2xl font-semibold tabular-nums">
                  {Number((health.data as Record<string, number> | undefined)?.[s.k] ?? 0)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{s.label}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>

        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Webhook className="h-4 w-4" /> Outbound webhooks
          </CardTitle>
          <CardDescription>
            Deliver ReconIQ events to downstream systems (Slack, ServiceNow, Demo Bank EDA bus). Every payload is signed with
            HMAC-SHA256 using your subscription secret.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canWrite} />
            </div>
            <div className="space-y-1">
              <Label>Endpoint URL</Label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} disabled={!canWrite} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Events</Label>
            <div className="flex flex-wrap gap-2">
              {ALL_EVENTS.map((ev) => {
                const on = events.includes(ev);
                return (
                  <Badge
                    key={ev}
                    variant={on ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() =>
                      canWrite &&
                      setEvents((cur) => (cur.includes(ev) ? cur.filter((x) => x !== ev) : [...cur, ev]))
                    }
                  >
                    {ev}
                  </Badge>
                );
              })}
            </div>
          </div>
          <div className="flex justify-end">
            <Button disabled={!canWrite || mCreate.isPending} onClick={() => mCreate.mutate()}>
              Create webhook
            </Button>
          </div>
          {revealedSecret && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
              <div className="mb-1 font-medium">Signing secret (shown once)</div>
              <div className="flex items-center gap-2 font-mono text-xs">
                <code className="break-all">{revealedSecret}</code>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    navigator.clipboard.writeText(revealedSecret);
                    toast.success("Copied");
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Registered endpoints</CardTitle>
          <CardDescription>Toggle, inspect deliveries, or remove subscriptions.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(q.data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No webhooks yet for Demo Bank.</p>
          )}
          {(q.data ?? []).map((w) => (
            <div key={w.id} className="rounded-md border p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">{w.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{w.url}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(w.events ?? []).map((e: string) => (
                      <Badge key={e} variant="secondary" className="text-[10px]">
                        {e}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={w.enabled}
                    disabled={!canWrite}
                    onCheckedChange={(v) => mToggle.mutate({ id: w.id, enabled: v })}
                  />
                  <Button size="sm" variant="outline" onClick={() => setSelectedSub(w.id)}>
                    Deliveries
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!canWrite}
                    onClick={() => mDelete.mutate(w.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              {selectedSub === w.id && (
                <div className="mt-3 rounded bg-muted/30 p-2 text-xs">
                  {deliveries.isLoading && <span className="text-muted-foreground">Loading…</span>}
                  {deliveries.data?.length === 0 && (
                    <span className="text-muted-foreground">No deliveries yet.</span>
                  )}
                  {(deliveries.data ?? []).map((d) => (
                    <div key={d.id} className="flex items-center justify-between border-b py-1 last:border-0">
                      <span className="font-mono">{d.event}</span>
                      <span className="flex items-center gap-2">
                        <Badge variant={d.response_status && d.response_status < 300 ? "default" : "destructive"}>
                          {d.response_status ?? "pending"}
                        </Badge>
                        <span className="text-muted-foreground">attempt {d.attempt}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <RotateCcw className="h-4 w-4" /> Outbox & dead-letter
          </CardTitle>
          <CardDescription>
            Failed deliveries retry with exponential backoff up to 6 attempts before moving to dead-letter. Replay re-enqueues immediately.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {(["dead", "failed", "pending"] as const).map((s) => (
              <Badge
                key={s}
                variant={outboxFilter === s ? "default" : "outline"}
                className="cursor-pointer capitalize"
                onClick={() => setOutboxFilter(s)}
              >
                {s}
              </Badge>
            ))}
          </div>
          {outbox.isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
          {(outbox.data ?? []).length === 0 && !outbox.isLoading && (
            <p className="text-xs text-muted-foreground">No {outboxFilter} entries in the last window.</p>
          )}
          <div className="divide-y rounded-md border">
            {(outbox.data ?? []).map((o) => {
              return (
                <div key={o.id} className="flex items-start justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <div className="font-mono text-xs">{o.event}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      queued {new Date(o.created_at).toLocaleString()} · next {new Date(o.next_attempt_at).toLocaleString()}
                    </div>
                    {o.delivery_needs_attention && (
                      <div className="mt-1 text-xs text-destructive" role="status">
                        Delivery needs attention. Review the destination and retry when ready.
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      attempts {o.attempts}
                    </Badge>

                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canWrite || mReplay.isPending}
                      onClick={() => mReplay.mutate(o.id)}
                    >
                      <RotateCcw className="mr-1 h-3.5 w-3.5" /> Replay
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>

  );
}
