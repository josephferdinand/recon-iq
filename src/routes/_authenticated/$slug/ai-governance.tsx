import { createFileRoute, useParams, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getTenantBySlug } from "@/lib/tenants.functions";
import {
  listAiGovernanceOverview,
  upsertConfidenceThreshold,
  decideHitlItem,
  engageKillSwitch,
  releaseKillSwitch,
  evaluateModelDrift,
  acknowledgeDriftAlert,
  registerGovernedModel,
  approveGovernedModel,
} from "@/lib/ai-governance.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShieldAlert, ArrowLeft, Power, AlertTriangle, CheckCircle2, Activity } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/$slug/ai-governance")({
  component: AiGovernancePage,
  errorComponent: ({ error }) => (
    <div className="p-6 text-sm text-destructive">Failed to load: {error instanceof Error ? error.message : "An unexpected error occurred."}</div>
  ),
  notFoundComponent: () => <div className="p-6">Not found.</div>,
});

function AiGovernancePage() {
  const { slug } = useParams({ from: "/_authenticated/$slug/ai-governance" });
  const getTenant = useServerFn(getTenantBySlug);
  const tenantQ = useQuery({ queryKey: ["tenant", slug], queryFn: () => getTenant({ data: { slug } }) });
  const tenantId = tenantQ.data?.id;

  const overview = useServerFn(listAiGovernanceOverview);
  const data = useQuery({
    queryKey: ["ai-governance", tenantId],
    queryFn: () => overview({ data: { tenantId: tenantId! } }),
    enabled: !!tenantId,
  });

  if (!tenantId) return <div className="p-6 text-sm text-muted-foreground">Loading tenant…</div>;
  if (data.isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading governance…</div>;
  if (!data.data) return <div className="p-6 text-sm text-destructive">No data.</div>;

  const d = data.data;
  const openAlerts = d.alerts.filter((a: any) => a.status === "open").length;
  const pendingHitl = d.hitl.filter((h: any) => h.status === "pending").length;
  const killEngaged = d.killSwitches.some((k: any) => k.engaged);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/$slug/tenant" params={{ slug }}><ArrowLeft className="h-4 w-4" /> Back</Link>
        </Button>
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <ShieldAlert className="h-6 w-6" /> Responsible AI Governance
          </h1>
          <p className="text-sm text-muted-foreground">
            Human-in-the-loop gates, confidence thresholds, model & prompt logging, drift monitoring, and kill switch.
          </p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Link to="/$slug/ai-governance/finops" params={{ slug }} className="rounded-lg border border-border/60 p-4 hover:bg-muted/40">
          <div className="text-sm font-semibold">AI Cost &amp; Usage Analytics</div>
          <div className="text-xs text-muted-foreground">FinOps KPIs, breakdowns by provider / model / feature / user.</div>
        </Link>
        <Link to="/$slug/ai-governance/failover" params={{ slug }} className="rounded-lg border border-border/60 p-4 hover:bg-muted/40">
          <div className="text-sm font-semibold">Failover &amp; Model Management</div>
          <div className="text-xs text-muted-foreground">Primary + Fallback1 + Fallback2 per feature, validation console.</div>
        </Link>
        <Link to="/$slug/ai-governance/approvals" params={{ slug }} className="rounded-lg border border-border/60 p-4 hover:bg-muted/40">
          <div className="text-sm font-semibold">Approval Workflows</div>
          <div className="text-xs text-muted-foreground">Dual-approval, four-eyes, governance / security / compliance gates.</div>
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard label="Governed models" value={d.models.length} icon={<Activity className="h-4 w-4" />} />
        <StatCard label="Prompt log entries" value={d.promptLogCount} icon={<Activity className="h-4 w-4" />} />
        <StatCard label="Pending HITL" value={pendingHitl} tone={pendingHitl > 0 ? "warn" : "ok"} icon={<AlertTriangle className="h-4 w-4" />} />
        <StatCard label="Open drift alerts" value={openAlerts} tone={openAlerts > 0 ? "warn" : "ok"} icon={<AlertTriangle className="h-4 w-4" />} />
      </div>

      <KillSwitchCard tenantId={tenantId} kill={d.killSwitches} engaged={killEngaged} />

      <Tabs defaultValue="thresholds" className="space-y-4">
        <TabsList>
          <TabsTrigger value="thresholds">Confidence thresholds</TabsTrigger>
          <TabsTrigger value="hitl">HITL queue ({pendingHitl})</TabsTrigger>
          <TabsTrigger value="models">Model registry</TabsTrigger>
          <TabsTrigger value="drift">Drift monitoring</TabsTrigger>
        </TabsList>

        <TabsContent value="thresholds">
          <ThresholdsTab tenantId={tenantId} rows={d.thresholds} />
        </TabsContent>
        <TabsContent value="hitl">
          <HitlTab rows={d.hitl} tenantId={tenantId} />
        </TabsContent>
        <TabsContent value="models">
          <ModelsTab tenantId={tenantId} rows={d.models} />
        </TabsContent>
        <TabsContent value="drift">
          <DriftTab tenantId={tenantId} models={d.models} alerts={d.alerts} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone?: "ok" | "warn" }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className={`text-2xl font-semibold ${tone === "warn" ? "text-destructive" : ""}`}>{value}</div>
        </div>
        <div className="text-muted-foreground">{icon}</div>
      </CardContent>
    </Card>
  );
}

function KillSwitchCard({ tenantId, kill, engaged }: { tenantId: string; kill: any[]; engaged: boolean }) {
  const qc = useQueryClient();
  const engage = useServerFn(engageKillSwitch);
  const release = useServerFn(releaseKillSwitch);
  const [reason, setReason] = useState("");
  const [scope, setScope] = useState("global");
  const engageM = useMutation({
    mutationFn: () => engage({ data: { tenantId, scope, reason } }),
    onSuccess: () => { toast.success("Kill switch engaged"); setReason(""); qc.invalidateQueries({ queryKey: ["ai-governance", tenantId] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const releaseM = useMutation({
    mutationFn: (s: string) => release({ data: { tenantId, scope: s } }),
    onSuccess: () => { toast.success("Kill switch released"); qc.invalidateQueries({ queryKey: ["ai-governance", tenantId] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className={engaged ? "border-destructive" : ""}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Power className={`h-4 w-4 ${engaged ? "text-destructive" : ""}`} />
          AI Kill Switch
          {engaged && <Badge variant="destructive">ENGAGED</Badge>}
        </CardTitle>
        <CardDescription>
          Halts all AI inference for the selected scope. Engagement and release are audit-logged and require tenant admin.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 md:grid-cols-[160px,1fr,auto]">
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="global">Global (all AI)</SelectItem>
              <SelectItem value="copilot">Copilot only</SelectItem>
              <SelectItem value="agent">Agent only</SelectItem>
              <SelectItem value="aidp">AIDP only</SelectItem>
              <SelectItem value="schema_map">Schema mapping</SelectItem>
            </SelectContent>
          </Select>
          <Input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button variant="destructive" disabled={reason.length < 3 || engageM.isPending} onClick={() => engageM.mutate()}>
            Engage
          </Button>
        </div>
        {kill.length > 0 && (
          <div className="space-y-2 rounded border p-3 text-sm">
            {kill.map((k: any) => (
              <div key={k.id} className="flex items-center justify-between gap-3">
                <div>
                  <span className="font-medium">{k.scope}</span>
                  {k.engaged ? (
                    <Badge variant="destructive" className="ml-2">engaged</Badge>
                  ) : (
                    <Badge variant="secondary" className="ml-2">released</Badge>
                  )}
                  <div className="text-xs text-muted-foreground">{k.reason}</div>
                </div>
                {k.engaged && (
                  <Button size="sm" variant="outline" onClick={() => releaseM.mutate(k.scope)}>
                    Release
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const DEFAULT_SCOPES = ["copilot", "agent", "aidp", "schema_map"];

function ThresholdsTab({ tenantId, rows }: { tenantId: string; rows: any[] }) {
  const qc = useQueryClient();
  const upsert = useServerFn(upsertConfidenceThreshold);
  const m = useMutation({
    mutationFn: (v: any) => upsert({ data: v }),
    onSuccess: () => { toast.success("Threshold saved"); qc.invalidateQueries({ queryKey: ["ai-governance", tenantId] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const byScope = new Map(rows.map((r) => [r.scope, r]));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Confidence thresholds & HITL gates</CardTitle>
        <CardDescription>
          Per-scope minimum confidence. Below <code>hitl_below</code> → routed to human review. Below <code>block_below</code> → blocked outright.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {DEFAULT_SCOPES.map((scope) => {
          const r = byScope.get(scope) ?? { scope, min_confidence: 0.85, hitl_below: 0.7, block_below: 0.5, enabled: true };
          return <ThresholdRow key={scope} tenantId={tenantId} initial={r} onSave={m.mutate} saving={m.isPending} />;
        })}
      </CardContent>
    </Card>
  );
}

function ThresholdRow({ tenantId, initial, onSave, saving }: { tenantId: string; initial: any; onSave: (v: any) => void; saving: boolean }) {
  const [v, setV] = useState({ ...initial });
  return (
    <div className="grid items-end gap-3 rounded border p-3 md:grid-cols-[120px,1fr,1fr,1fr,80px,auto]">
      <div>
        <Label className="text-xs">Scope</Label>
        <div className="mt-2 text-sm font-medium">{v.scope}</div>
      </div>
      <NumberField label="min_confidence" value={v.min_confidence} onChange={(x) => setV({ ...v, min_confidence: x })} />
      <NumberField label="hitl_below" value={v.hitl_below} onChange={(x) => setV({ ...v, hitl_below: x })} />
      <NumberField label="block_below" value={v.block_below} onChange={(x) => setV({ ...v, block_below: x })} />
      <div>
        <Label className="text-xs">Enabled</Label>
        <Switch aria-label={`${v.scope} threshold enabled`} className="mt-2" checked={v.enabled} onCheckedChange={(x) => setV({ ...v, enabled: x })} />
      </div>
      <Button size="sm" disabled={saving} onClick={() => onSave({
        tenantId, scope: v.scope, minConfidence: Number(v.min_confidence),
        hitlBelow: Number(v.hitl_below), blockBelow: Number(v.block_below), enabled: !!v.enabled,
      })}>Save</Button>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input aria-label={label} type="number" min={0} max={1} step={0.01} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function HitlTab({ rows, tenantId }: { rows: any[]; tenantId: string }) {
  const qc = useQueryClient();
  const decide = useServerFn(decideHitlItem);
  const m = useMutation({
    mutationFn: (v: any) => decide({ data: v }),
    onSuccess: () => { toast.success("Decision recorded"); qc.invalidateQueries({ queryKey: ["ai-governance", tenantId] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const [rationale, setRationale] = useState<Record<string, string>>({});
  const pending = rows.filter((r) => r.status === "pending");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Human-in-the-loop queue</CardTitle>
        <CardDescription>Low-confidence or policy-gated AI actions awaiting human approval.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {pending.length === 0 && <div className="text-sm text-muted-foreground">Nothing pending.</div>}
        {pending.map((r) => (
          <div key={r.id} className="space-y-2 rounded border p-3 text-sm">
            <div className="flex items-center justify-between">
              <div className="font-medium">{r.scope}</div>
              <Badge variant="outline">conf {r.confidence ?? "n/a"}</Badge>
            </div>
            <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{JSON.stringify(r.payload, null, 2)}</pre>
            <Textarea
              placeholder="Decision rationale"
              value={rationale[r.id] ?? ""}
              onChange={(e) => setRationale({ ...rationale, [r.id]: e.target.value })}
            />
            <div className="flex gap-2">
              <Button size="sm" disabled={!rationale[r.id] || m.isPending}
                onClick={() => m.mutate({ id: r.id, decision: "approved", rationale: rationale[r.id] })}>
                <CheckCircle2 className="h-4 w-4" /> Approve
              </Button>
              <Button size="sm" variant="destructive" disabled={!rationale[r.id] || m.isPending}
                onClick={() => m.mutate({ id: r.id, decision: "rejected", rationale: rationale[r.id] })}>
                Reject
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ModelsTab({ tenantId, rows }: { tenantId: string; rows: any[] }) {
  const qc = useQueryClient();
  const register = useServerFn(registerGovernedModel);
  const approve = useServerFn(approveGovernedModel);
  const [name, setName] = useState(""); const [provider, setProvider] = useState("google");
  const [modelId, setModelId] = useState("google/gemini-3-flash-preview");
  const [risk, setRisk] = useState("medium");
  const [template, setTemplate] = useState("");
  const reg = useMutation({
    mutationFn: () => register({ data: { tenantId, name, provider, modelId, promptTemplate: template || undefined, riskTier: risk as any } }),
    onSuccess: () => { toast.success("Model registered (draft)"); setName(""); setTemplate(""); qc.invalidateQueries({ queryKey: ["ai-governance", tenantId] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const app = useMutation({
    mutationFn: (id: string) => approve({ data: { id } }),
    onSuccess: () => { toast.success("Model approved for production"); qc.invalidateQueries({ queryKey: ["ai-governance", tenantId] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Register governed model</CardTitle>
          <CardDescription>Model + prompt template are hashed and version-tracked.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label>Provider</Label><Input value={provider} onChange={(e) => setProvider(e.target.value)} /></div>
          <div><Label>Model ID</Label><Input value={modelId} onChange={(e) => setModelId(e.target.value)} /></div>
          <div>
            <Label>Risk tier</Label>
            <Select value={risk} onValueChange={setRisk}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["low","medium","high","critical"].map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label>Prompt template</Label>
            <Textarea value={template} onChange={(e) => setTemplate(e.target.value)} rows={4} />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <Button disabled={!name || reg.isPending} onClick={() => reg.mutate()}>Register</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Registered models</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {rows.length === 0 && <div className="text-sm text-muted-foreground">No models yet.</div>}
          {rows.map((m: any) => (
            <div key={m.id} className="flex items-center justify-between rounded border p-3 text-sm">
              <div>
                <div className="font-medium">{m.name} <span className="text-xs text-muted-foreground">v{m.version}</span></div>
                <div className="text-xs text-muted-foreground">{m.provider} · {m.model_id} · {m.risk_tier}</div>
                {m.prompt_hash && <div className="font-mono text-[10px] text-muted-foreground">sha256:{m.prompt_hash.slice(0,16)}…</div>}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={m.status === "approved" ? "default" : m.status === "retired" ? "secondary" : "outline"}>{m.status}</Badge>
                {m.status === "draft" && (
                  <Button size="sm" disabled={app.isPending} onClick={() => app.mutate(m.id)}>Approve</Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function DriftTab({ tenantId, models, alerts }: { tenantId: string; models: any[]; alerts: any[] }) {
  const qc = useQueryClient();
  const evalDrift = useServerFn(evaluateModelDrift);
  const ack = useServerFn(acknowledgeDriftAlert);
  const evalM = useMutation({
    mutationFn: (id: string) => evalDrift({ data: { modelId: id, windowHours: 24 } }),
    onSuccess: () => { toast.success("Drift evaluated"); qc.invalidateQueries({ queryKey: ["ai-governance", tenantId] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const ackM = useMutation({
    mutationFn: (id: string) => ack({ data: { id } }),
    onSuccess: () => { toast.success("Acknowledged"); qc.invalidateQueries({ queryKey: ["ai-governance", tenantId] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Drift evaluation</CardTitle><CardDescription>Computes 24h window vs baseline; emits alert if avg confidence moved &gt;15%.</CardDescription></CardHeader>
        <CardContent className="space-y-2">
          {models.length === 0 && <div className="text-sm text-muted-foreground">Register a model first.</div>}
          {models.map((m) => (
            <div key={m.id} className="flex items-center justify-between rounded border p-3 text-sm">
              <div>{m.name} <span className="text-xs text-muted-foreground">v{m.version}</span></div>
              <Button size="sm" variant="outline" disabled={evalM.isPending} onClick={() => evalM.mutate(m.id)}>Evaluate drift</Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Drift alerts</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {alerts.length === 0 && <div className="text-sm text-muted-foreground">No drift alerts.</div>}
          {alerts.map((a: any) => (
            <div key={a.id} className="flex items-center justify-between rounded border p-3 text-sm">
              <div>
                <div className="font-medium">{a.metric} · {a.severity}</div>
                <div className="text-xs text-muted-foreground">
                  baseline {Number(a.baseline_value).toFixed(3)} → observed {Number(a.observed_value).toFixed(3)} ({Number(a.delta_pct).toFixed(1)}%)
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={a.status === "open" ? "destructive" : "secondary"}>{a.status}</Badge>
                {a.status === "open" && (
                  <Button size="sm" variant="outline" disabled={ackM.isPending} onClick={() => ackM.mutate(a.id)}>Acknowledge</Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
