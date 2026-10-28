import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { notifyUserError } from "@/lib/user-feedback";
import { USER_FACING_ERRORS } from "@/lib/user-facing-errors";
import { reportPlatformError } from "@/lib/error-reporting";
import {
  Activity, AlertTriangle, Bot, Boxes, Coins, Fingerprint, Gauge,
  KeyRound, Layers, Network, Route as RouteIcon, ShieldCheck, ShieldAlert,
  Sparkles, TrendingUp, Zap, PlayCircle, BarChart3, LayoutGrid, DollarSign, Radar, HeartPulse,
} from "lucide-react";
import {
  AiStatusMatrixTab, AiUsageAnalyticsTab, AiTokenAnalyticsTab,
  AiCostCenterTab, AiRiskComplianceTab, AiOperationsTab,
} from "@/components/ai-control-plane-analytics";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  listProviderRegistry, listProviderInstances, listModelCatalog,
  listGovernanceToggles, getAgentGovernance, listRoutingPolicies,
  listAiQuotas, listAdminAudit, getExecutiveDashboard,
  upsertProviderInstance, setProviderStatus, upsertModelCatalog, setModelStatus,
  setGovernanceToggle, setAgentGovernance, upsertRoutingPolicy, upsertAiQuota,
  listVaultSecrets,
  type ProviderRegistry, type ProviderInstance, type ModelCatalogEntry,
  type GovernanceToggle, type AgentGovernance, type RoutingPolicy,
  type AiQuota, type AiAdminAuditRow,
} from "@/lib/ai-control-plane.functions";
import { cn } from "@/lib/utils";

// ================================================================
// Executive Dashboard
// ================================================================
function ExecutiveDashboard() {
  const fn = useServerFn(getExecutiveDashboard);
  const { data, isLoading } = useQuery({ queryKey: ["ai-cp-exec"], queryFn: () => fn() });
  const d = data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={Boxes} label="Provider instances" value={d?.providers.total ?? "…"} sub={`${d?.providers.active ?? 0} active · ${d?.providers.healthy ?? 0} healthy`} tone="primary" />
        <KpiCard icon={Sparkles} label="Model catalog" value={d?.models.total ?? "…"} sub={`${d?.models.approved ?? 0} approved`} tone="accent" />
        <KpiCard icon={Coins} label="Cost (30d)" value={d ? `$${d.usage.cost_month_usd.toFixed(2)}` : "…"} sub={d ? `$${d.usage.cost_day_usd.toFixed(2)} today` : ""} tone="success" />
        <KpiCard icon={Activity} label="Tokens (30d)" value={d ? formatTokens(d.usage.tokens_month) : "…"} sub={d ? `${formatTokens(d.usage.tokens_day)} today` : ""} tone="info" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <RiskCard icon={ShieldAlert} label="HITL pending" value={d?.risk.hitl_pending ?? 0} tone="warning" />
        <RiskCard icon={AlertTriangle} label="Drift alerts open" value={d?.risk.drift_alerts_open ?? 0} tone="warning" />
        <RiskCard icon={Zap} label="Kill switches engaged" value={d?.risk.kill_switches_engaged ?? 0} tone="destructive" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <BreakdownCard title="Cost by provider (30d)" rows={d?.cost_breakdown.by_provider ?? []} isLoading={isLoading} />
        <BreakdownCard title="Cost by model (30d)" rows={d?.cost_breakdown.by_model ?? []} isLoading={isLoading} />
        <BreakdownCard title="Cost by tenant (30d)" rows={d?.cost_breakdown.by_tenant ?? []} isLoading={isLoading} truncateLabel />
      </div>
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, sub, tone }: { icon: any; label: string; value: any; sub?: string; tone: "primary" | "accent" | "success" | "info" }) {
  const toneMap = { primary: "text-primary", accent: "text-accent-foreground", success: "text-emerald-500", info: "text-sky-500" };
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-3xl font-semibold mt-1">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <Icon className={cn("h-8 w-8", toneMap[tone])} />
        </div>
      </CardContent>
    </Card>
  );
}

function RiskCard({ icon: Icon, label, value, tone }: { icon: any; label: string; value: number; tone: "warning" | "destructive" }) {
  const bg = tone === "destructive" ? "bg-destructive/10 text-destructive" : "bg-amber-500/10 text-amber-600 dark:text-amber-400";
  return (
    <Card>
      <CardContent className="pt-6 flex items-center gap-4">
        <div className={cn("h-12 w-12 rounded-lg flex items-center justify-center", bg)}>
          <Icon className="h-6 w-6" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function BreakdownCard({ title, rows, isLoading, truncateLabel }: { title: string; rows: Array<{ label: string; value: number }>; isLoading?: boolean; truncateLabel?: boolean }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && rows.length === 0 && <p className="text-sm text-muted-foreground">No usage yet.</p>}
        {rows.map((r) => (
          <div key={r.label} className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className={cn("truncate", truncateLabel && "max-w-[10rem]")}>{r.label}</span>
              <span className="tabular-nums">${r.value.toFixed(2)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-primary" style={{ width: `${(r.value / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ================================================================
// Governance
// ================================================================
const GOV_KEYS: Array<{ key: string; label: string; kind: "bool" | "enum" | "int"; options?: string[]; description: string }> = [
  { key: "enable_ai_platform",       label: "AI platform",              kind: "bool", description: "Master switch. When off, all AI features are disabled platform-wide." },
  { key: "enable_copilot",           label: "Copilot",                  kind: "bool", description: "In-app Copilot chat and inline assistance." },
  { key: "enable_autonomous_agents", label: "Autonomous agents",        kind: "bool", description: "Agents may run without a human in the loop, within their governance ceiling." },
  { key: "enable_agentic_workflows", label: "Agentic workflows",        kind: "bool", description: "Multi-step, tool-using workflows." },
  { key: "enable_recommendations",   label: "AI recommendations",       kind: "bool", description: "Inline suggestions and next-best-action prompts." },
  { key: "enable_auto_remediation",  label: "Auto remediation",         kind: "bool", description: "Agents may fix issues automatically instead of only suggesting fixes." },
  { key: "enable_external_providers",label: "External AI providers",    kind: "bool", description: "Allow calls to third-party AI providers." },
  { key: "enable_byo_llm",           label: "Bring-your-own LLM",       kind: "bool", description: "Tenants may configure their own LLM endpoints and credentials." },
  { key: "prompt_logging",           label: "Prompt logging",           kind: "enum", options: ["disabled","optional","mandatory"], description: "Whether prompts are logged for audit." },
  { key: "pii_detection",            label: "PII detection",            kind: "enum", options: ["disabled","monitor","block"], description: "Detect personal data in prompts and responses." },
  { key: "pii_redaction",            label: "PII redaction",            kind: "enum", options: ["disabled","recommended","mandatory"], description: "Automatically redact detected PII." },
  { key: "sensitive_data_protection",label: "Sensitive data protection",kind: "bool", description: "Extra scanning for regulated data classes (PHI, PCI, financial identifiers)." },
  { key: "residency_enforcement",    label: "Data residency",           kind: "bool", description: "Enforce region routing to keep data inside allowed jurisdictions." },
  { key: "human_approval",           label: "Human approval",           kind: "enum", options: ["never","high_risk","always"], description: "When a human must approve an AI-initiated action." },
  { key: "audit_retention_days",     label: "Audit retention (days)",   kind: "int",  description: "How long AI audit records are retained." },
];

function GovernanceTab({ tenantId }: { tenantId: string | null }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listGovernanceToggles);
  const setFn = useServerFn(setGovernanceToggle);
  const agentGetFn = useServerFn(getAgentGovernance);
  const agentSetFn = useServerFn(setAgentGovernance);

  const scope = tenantId ? "tenant" : "platform";
  const togglesQ = useQuery({
    queryKey: ["ai-cp-gov", scope, tenantId],
    queryFn: () => listFn({ data: { tenant_id: tenantId ?? null } }),
  });
  const agentQ = useQuery({
    queryKey: ["ai-cp-agent-gov", scope, tenantId],
    queryFn: () => agentGetFn({ data: { tenant_id: tenantId ?? null } }),
  });

  const map = useMemo(() => {
    const m = new Map<string, GovernanceToggle>();
    (togglesQ.data ?? []).forEach((t) => m.set(t.key, t));
    return m;
  }, [togglesQ.data]);

  const setMut = useMutation({
    mutationFn: (args: { key: string; value: any }) =>
      setFn({ data: { scope: scope as any, tenant_id: tenantId ?? null, key: args.key, value: args.value } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-cp-gov"] });
      toast.success("Policy updated");
    },
    onError: (e: any) => notifyUserError(e, "AI policy matrix"),
  });

  const agentMut = useMutation({
    mutationFn: (patch: Partial<AgentGovernance>) =>
      agentSetFn({ data: { ...(agentQ.data ?? {}), ...patch, scope: scope as any, tenant_id: tenantId ?? null } as any }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-cp-agent-gov"] });
      toast.success("Agent governance updated");
    },
    onError: (e: any) => notifyUserError(e, "agent governance"),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>AI policy matrix</CardTitle>
          <CardDescription>{scope === "platform" ? "Platform-wide defaults. Tenants inherit these and may override within allowed ranges." : "Tenant overrides. Locked controls are enforced by the platform."}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {GOV_KEYS.map((def) => {
              const row = map.get(def.key);
              const val = row?.value;
              return (
                <div key={def.key} className="rounded-lg border p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{def.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{def.description}</p>
                    </div>
                    {def.kind === "bool" && (
                      <Switch
                        checked={val === true}
                        onCheckedChange={(v) => setMut.mutate({ key: def.key, value: v })}
                        disabled={setMut.isPending}
                      />
                    )}
                  </div>
                  {def.kind === "enum" && (
                    <Select value={typeof val === "string" ? val : ""} onValueChange={(v) => setMut.mutate({ key: def.key, value: v })}>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        {def.options!.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                  {def.kind === "int" && (
                    <Input
                      type="number"
                      value={typeof val === "number" ? val : ""}
                      onChange={(e) => setMut.mutate({ key: def.key, value: Number(e.target.value) })}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Autonomous agent ceilings</CardTitle>
          <CardDescription>Hard limits any agent inherits regardless of workflow config.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>Autonomy ceiling</Label>
            <Select value={agentQ.data?.autonomy_ceiling ?? "suggestion_only"} onValueChange={(v) => agentMut.mutate({ autonomy_ceiling: v as any })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="suggestion_only">Suggestion only</SelectItem>
                <SelectItem value="assisted">Assisted execution</SelectItem>
                <SelectItem value="semi_autonomous">Semi-autonomous</SelectItem>
                <SelectItem value="fully_autonomous">Fully autonomous</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Max runtime (seconds)</Label>
            <Input type="number" defaultValue={agentQ.data?.max_runtime_seconds ?? 300} onBlur={(e) => agentMut.mutate({ max_runtime_seconds: Number(e.target.value) })} />
          </div>
          <div className="space-y-2">
            <Label>Max actions per run</Label>
            <Input type="number" defaultValue={agentQ.data?.max_actions_per_run ?? 25} onBlur={(e) => agentMut.mutate({ max_actions_per_run: Number(e.target.value) })} />
          </div>
          <div className="space-y-2">
            <Label>Max concurrent agents</Label>
            <Input type="number" defaultValue={agentQ.data?.max_concurrent_agents ?? 5} onBlur={(e) => agentMut.mutate({ max_concurrent_agents: Number(e.target.value) })} />
          </div>
          <div className="space-y-2">
            <Label>Approval threshold ($)</Label>
            <Input type="number" step="0.01" defaultValue={agentQ.data?.approval_threshold_usd ?? 10} onBlur={(e) => agentMut.mutate({ approval_threshold_usd: Number(e.target.value) })} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ================================================================
// Providers
// ================================================================
function ProvidersTab({ tenantId }: { tenantId: string | null }) {
  const qc = useQueryClient();
  const regFn = useServerFn(listProviderRegistry);
  const listFn = useServerFn(listProviderInstances);
  const upsertFn = useServerFn(upsertProviderInstance);
  const statusFn = useServerFn(setProviderStatus);
  const vaultFn = useServerFn(listVaultSecrets);

  const regQ = useQuery({ queryKey: ["ai-cp-reg"], queryFn: () => regFn() });
  const instQ = useQuery({
    queryKey: ["ai-cp-inst", tenantId],
    queryFn: () => listFn({ data: { tenant_id: tenantId ?? null } }),
  });
  const vaultQ = useQuery({
    queryKey: ["ai-cp-vault", tenantId],
    queryFn: () => vaultFn({ data: { tenant_id: tenantId ?? null } }),
  });

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<ProviderInstance>>({ provider_code: "", display_name: "", auth_method: "api_key", status: "draft" });
  const selectedReg = regQ.data?.find((r) => r.code === draft.provider_code);

  const saveMut = useMutation({
    mutationFn: () => upsertFn({ data: { ...draft, tenant_id: tenantId ?? null } as any }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ai-cp-inst"] }); toast.success("Provider saved"); setOpen(false); setDraft({ provider_code: "", display_name: "", auth_method: "api_key", status: "draft" }); },
    onError: (e: any) => notifyUserError(e, "AI provider configuration"),
  });

  const statusMut = useMutation({
    mutationFn: (args: { id: string; status: ProviderInstance["status"] }) => statusFn({ data: args }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ai-cp-inst"] }); toast.success("Status updated"); },
    onError: (e: any) => notifyUserError(e, "AI provider status"),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Provider registry</h2>
          <p className="text-sm text-muted-foreground">Onboardable provider templates. Add or retire without a deployment.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Boxes className="h-4 w-4 mr-2" />Add provider instance</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Add provider instance</DialogTitle>
              <DialogDescription>Metadata only. Credentials live in the encrypted vault and are never displayed once saved.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Provider</Label>
                <Select value={draft.provider_code ?? ""} onValueChange={(v) => setDraft({ ...draft, provider_code: v })}>
                  <SelectTrigger><SelectValue placeholder="Choose provider template" /></SelectTrigger>
                  <SelectContent>
                    {(regQ.data ?? []).map((r) => (
                      <SelectItem key={r.code} value={r.code}>{r.display_name} <span className="text-xs text-muted-foreground ml-2">({r.kind})</span></SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Display name</Label>
                <Input value={draft.display_name ?? ""} onChange={(e) => setDraft({ ...draft, display_name: e.target.value })} placeholder="Production Azure Muse (EU)" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <Label>Endpoint</Label>
                  <Input value={draft.endpoint ?? ""} onChange={(e) => setDraft({ ...draft, endpoint: e.target.value })} placeholder={selectedReg?.default_endpoint_template ?? ""} />
                </div>
                <div className="space-y-2">
                  <Label>Region</Label>
                  <Input value={draft.region ?? ""} onChange={(e) => setDraft({ ...draft, region: e.target.value })} placeholder="eu-west-1" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <Label>Auth method</Label>
                  <Select value={draft.auth_method ?? "api_key"} onValueChange={(v) => setDraft({ ...draft, auth_method: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(selectedReg?.auth_methods ?? ["api_key"]).map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>API version</Label>
                  <Input value={draft.api_version ?? ""} onChange={(e) => setDraft({ ...draft, api_version: e.target.value })} placeholder="2024-06-01" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Vault secret</Label>
                <Select value={draft.vault_secret_id ?? ""} onValueChange={(v) => setDraft({ ...draft, vault_secret_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Bind an already-stored vault secret" /></SelectTrigger>
                  <SelectContent>
                    {(vaultQ.data ?? []).map((s: any) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} <span className="text-xs text-muted-foreground ml-2">{s.masked_preview ?? "•••"}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Only masked previews are shown. Raw secret values never leave the vault.</p>
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Textarea value={draft.notes ?? ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} rows={2} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => saveMut.mutate()} disabled={!draft.provider_code || !draft.display_name || saveMut.isPending}>Save as draft</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Available templates</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {(regQ.data ?? []).map((r: ProviderRegistry) => (
              <div key={r.code} className="rounded-lg border p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <p className="font-medium">{r.display_name}</p>
                  <Badge variant="secondary" className="text-xs capitalize">{r.kind}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">Auth: {r.auth_methods.join(" · ")}</p>
                {r.docs_url && <a href={r.docs_url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">Docs →</a>}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Configured instances</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Region</TableHead>
                <TableHead>Auth</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Health</TableHead>
                <TableHead className="w-32"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(instQ.data ?? []).length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">No provider instances yet.</TableCell></TableRow>
              )}
              {(instQ.data ?? []).map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.display_name}</TableCell>
                  <TableCell><code className="text-xs">{p.provider_code}</code></TableCell>
                  <TableCell>{p.region ?? "—"}</TableCell>
                  <TableCell><code className="text-xs">{p.auth_method}</code></TableCell>
                  <TableCell><StatusBadge status={p.status} /></TableCell>
                  <TableCell><HealthBadge status={p.health_status} /></TableCell>
                  <TableCell className="text-right">
                    <Select value={p.status} onValueChange={(v) => statusMut.mutate({ id: p.id, status: v as any })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">draft</SelectItem>
                        <SelectItem value="active">active</SelectItem>
                        <SelectItem value="disabled">disabled</SelectItem>
                        <SelectItem value="retired">retired</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: "bg-muted text-muted-foreground",
    active: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    disabled: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    retired: "bg-destructive/10 text-destructive",
  };
  return <span className={cn("px-2 py-0.5 rounded text-xs font-medium", map[status] ?? "")}>{status}</span>;
}
function HealthBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    healthy: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    degraded: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    down: "bg-destructive/10 text-destructive",
    unknown: "bg-muted text-muted-foreground",
  };
  return <span className={cn("px-2 py-0.5 rounded text-xs font-medium", map[status] ?? "")}>{status}</span>;
}

// ================================================================
// Models
// ================================================================
function ModelsTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listModelCatalog);
  const instFn = useServerFn(listProviderInstances);
  const upsertFn = useServerFn(upsertModelCatalog);
  const statusFn = useServerFn(setModelStatus);

  const modelsQ = useQuery({ queryKey: ["ai-cp-models"], queryFn: () => listFn() });
  const instQ = useQuery({ queryKey: ["ai-cp-inst-all"], queryFn: () => instFn({ data: {} }) });

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<ModelCatalogEntry>>({ approval_status: "proposed", availability_status: "available" });

  const saveMut = useMutation({
    mutationFn: () => upsertFn({ data: draft as any }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ai-cp-models"] }); toast.success("Model saved"); setOpen(false); setDraft({ approval_status: "proposed", availability_status: "available" }); },
    onError: (e: any) => notifyUserError(e, "AI model catalogue"),
  });

  const statusMut = useMutation({
    mutationFn: (args: { id: string; approval_status?: any; availability_status?: any }) => statusFn({ data: args }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ai-cp-models"] }); },
    onError: (e: any) => notifyUserError(e, "AI model approval"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Model catalog</h2>
          <p className="text-sm text-muted-foreground">Dynamic model registry. Add, retire, or replace without a deploy.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Sparkles className="h-4 w-4 mr-2" />Add model</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Add model</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Provider instance</Label>
                <Select value={draft.provider_instance_id ?? ""} onValueChange={(v) => setDraft({ ...draft, provider_instance_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
                  <SelectContent>
                    {(instQ.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.display_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2"><Label>Model key</Label><Input value={draft.model_key ?? ""} onChange={(e) => setDraft({ ...draft, model_key: e.target.value })} placeholder="gpt-5.6-terra" /></div>
                <div className="space-y-2"><Label>Display name</Label><Input value={draft.display_name ?? ""} onChange={(e) => setDraft({ ...draft, display_name: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-2"><Label>Context</Label><Input type="number" value={draft.context_window ?? ""} onChange={(e) => setDraft({ ...draft, context_window: Number(e.target.value) })} /></div>
                <div className="space-y-2"><Label>Max in</Label><Input type="number" value={draft.max_input_tokens ?? ""} onChange={(e) => setDraft({ ...draft, max_input_tokens: Number(e.target.value) })} /></div>
                <div className="space-y-2"><Label>Max out</Label><Input type="number" value={draft.max_output_tokens ?? ""} onChange={(e) => setDraft({ ...draft, max_output_tokens: Number(e.target.value) })} /></div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => saveMut.mutate()} disabled={!draft.provider_instance_id || !draft.model_key || !draft.display_name || saveMut.isPending}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Context</TableHead>
                <TableHead>Approval</TableHead>
                <TableHead>Availability</TableHead>
                <TableHead className="w-40"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(modelsQ.data ?? []).length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No models registered yet.</TableCell></TableRow>
              )}
              {(modelsQ.data ?? []).map((m) => (
                <TableRow key={m.id}>
                  <TableCell><span className="font-medium">{m.display_name}</span><br /><code className="text-xs text-muted-foreground">{m.model_key}</code></TableCell>
                  <TableCell>{m.version ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">{m.context_window?.toLocaleString() ?? "—"}</TableCell>
                  <TableCell>
                    <Select value={m.approval_status} onValueChange={(v) => statusMut.mutate({ id: m.id, approval_status: v })}>
                      <SelectTrigger className="h-8 text-xs w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="proposed">proposed</SelectItem>
                        <SelectItem value="approved">approved</SelectItem>
                        <SelectItem value="retired">retired</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select value={m.availability_status} onValueChange={(v) => statusMut.mutate({ id: m.id, availability_status: v })}>
                      <SelectTrigger className="h-8 text-xs w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="available">available</SelectItem>
                        <SelectItem value="limited">limited</SelectItem>
                        <SelectItem value="deprecated">deprecated</SelectItem>
                        <SelectItem value="unavailable">unavailable</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ================================================================
// Routing / Operations
// ================================================================
function RoutingTab({ tenantId }: { tenantId: string | null }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listRoutingPolicies);
  const modelsFn = useServerFn(listModelCatalog);
  const upsertFn = useServerFn(upsertRoutingPolicy);

  const scope = tenantId ? "tenant" : "platform";
  const policiesQ = useQuery({ queryKey: ["ai-cp-routing", scope, tenantId], queryFn: () => listFn({ data: { tenant_id: tenantId ?? null } }) });
  const modelsQ = useQuery({ queryKey: ["ai-cp-models"], queryFn: () => modelsFn() });

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Partial<RoutingPolicy>>({ strategy: "cost", chain: [], enabled: true });

  const saveMut = useMutation({
    mutationFn: () => upsertFn({ data: { ...draft, scope: scope as any, tenant_id: tenantId ?? null } as any }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ai-cp-routing"] }); toast.success("Routing policy saved"); setOpen(false); setDraft({ strategy: "cost", chain: [], enabled: true }); },
    onError: (e: any) => notifyUserError(e, "AI routing policy"),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Routing & fallback</h2>
          <p className="text-sm text-muted-foreground">Unlimited fallback chains with strategy-driven selection.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><RouteIcon className="h-4 w-4 mr-2" />New policy</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>New routing policy</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-2"><Label>Name</Label><Input value={draft.name ?? ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Global cost-optimised" /></div>
              <div className="space-y-2">
                <Label>Strategy</Label>
                <Select value={draft.strategy ?? "cost"} onValueChange={(v) => setDraft({ ...draft, strategy: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["cost","latency","availability","region","compliance","risk","workload","round_robin","manual"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Fallback chain (unlimited)</Label>
                <div className="space-y-1">
                  {((draft.chain as any[]) ?? []).map((step: any, i: number) => (
                    <div key={i} className="flex items-center gap-2">
                      <Badge variant="outline">{i + 1}</Badge>
                      <span className="text-sm flex-1">{modelsQ.data?.find((m) => m.id === step.model_catalog_id)?.display_name ?? step.model_catalog_id}</span>
                      <Button variant="ghost" size="sm" onClick={() => setDraft({ ...draft, chain: (draft.chain as any[]).filter((_, j) => j !== i) })}>×</Button>
                    </div>
                  ))}
                  <Select value="" onValueChange={(v) => setDraft({ ...draft, chain: [...((draft.chain as any[]) ?? []), { model_catalog_id: v }] })}>
                    <SelectTrigger><SelectValue placeholder="Add model to chain" /></SelectTrigger>
                    <SelectContent>
                      {(modelsQ.data ?? []).map((m) => <SelectItem key={m.id} value={m.id}>{m.display_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => saveMut.mutate()} disabled={!draft.name || ((draft.chain as any[]) ?? []).length === 0 || saveMut.isPending}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Strategy</TableHead><TableHead>Chain length</TableHead><TableHead>Priority</TableHead><TableHead>Enabled</TableHead></TableRow></TableHeader>
            <TableBody>
              {(policiesQ.data ?? []).length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">No routing policies yet.</TableCell></TableRow>
              )}
              {(policiesQ.data ?? []).map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell><code className="text-xs">{p.strategy}</code></TableCell>
                  <TableCell className="tabular-nums">{Array.isArray(p.chain) ? p.chain.length : 0}</TableCell>
                  <TableCell className="tabular-nums">{p.priority}</TableCell>
                  <TableCell>{p.enabled ? <Badge>on</Badge> : <Badge variant="secondary">off</Badge>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ================================================================
// Cost & Quotas
// ================================================================
function CostTab() {
  const listFn = useServerFn(listAiQuotas);
  const upsertFn = useServerFn(upsertAiQuota);
  const qc = useQueryClient();
  const quotasQ = useQuery({ queryKey: ["ai-cp-quotas"], queryFn: () => listFn() });
  const mut = useMutation({
    mutationFn: (patch: Partial<AiQuota> & { tenant_id: string }) => upsertFn({ data: patch as any }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["ai-cp-quotas"] }); toast.success("Quota updated"); },
    onError: (e: any) => notifyUserError(e, "AI quotas"),
  });

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Quotas & consumption controls</h2>
      <p className="text-sm text-muted-foreground">Per-tenant ceilings. Rates come from the dynamic model pricing table.</p>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Tenant</TableHead><TableHead>Monthly tokens</TableHead><TableHead>Daily tokens</TableHead><TableHead>Agent runs</TableHead><TableHead>Budget ($)</TableHead><TableHead>Override</TableHead></TableRow></TableHeader>
            <TableBody>
              {(quotasQ.data ?? []).length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No tenant quotas configured yet.</TableCell></TableRow>
              )}
              {(quotasQ.data ?? []).map((q: AiQuota) => (
                <TableRow key={q.id}>
                  <TableCell className="font-mono text-xs">{q.tenant_id.slice(0, 8)}…</TableCell>
                  <TableCell><Input type="number" className="h-8" defaultValue={q.monthly_token_limit ?? ""} onBlur={(e) => mut.mutate({ tenant_id: q.tenant_id, monthly_token_limit: Number(e.target.value) })} /></TableCell>
                  <TableCell><Input type="number" className="h-8" defaultValue={q.daily_token_limit ?? ""} onBlur={(e) => mut.mutate({ tenant_id: q.tenant_id, daily_token_limit: Number(e.target.value) })} /></TableCell>
                  <TableCell><Input type="number" className="h-8" defaultValue={q.agent_execution_limit ?? ""} onBlur={(e) => mut.mutate({ tenant_id: q.tenant_id, agent_execution_limit: Number(e.target.value) })} /></TableCell>
                  <TableCell><Input type="number" step="0.01" className="h-8" defaultValue={q.budget_limit_usd ?? ""} onBlur={(e) => mut.mutate({ tenant_id: q.tenant_id, budget_limit_usd: Number(e.target.value) })} /></TableCell>
                  <TableCell><Switch checked={q.override_active} onCheckedChange={(v) => mut.mutate({ tenant_id: q.tenant_id, override_active: v })} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ================================================================
// Secret Vault (read-only picker + link out)
// ================================================================
function VaultPickerTab({ tenantId }: { tenantId: string | null }) {
  const listFn = useServerFn(listVaultSecrets);
  const q = useQuery({ queryKey: ["ai-cp-vault", tenantId], queryFn: () => listFn({ data: { tenant_id: tenantId ?? null } }) });
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Secret vault (bindings)</h2>
        <p className="text-sm text-muted-foreground">Secrets bound to AI provider instances. Raw values never leave the vault — only masked previews are ever shown.</p>
      </div>
      <Alert>
        <KeyRound className="h-4 w-4" />
        <AlertTitle>Pluggable backends</AlertTitle>
        <AlertDescription>Azure Key Vault · AWS Secrets Manager · HashiCorp Vault · GCP Secret Manager · Internal Encrypted Vault. Backend selection is per-secret and configured in the Vault (BYOK-KMS) console.</AlertDescription>
      </Alert>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Class</TableHead><TableHead>KEK provider</TableHead><TableHead>Masked</TableHead><TableHead>Version</TableHead><TableHead>Rotated</TableHead></TableRow></TableHeader>
            <TableBody>
              {(q.data ?? []).length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No secrets stored for this scope.</TableCell></TableRow>
              )}
              {(q.data ?? []).map((s: any) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell><code className="text-xs">{s.secret_class}</code></TableCell>
                  <TableCell><code className="text-xs">{s.kek_provider}</code></TableCell>
                  <TableCell className="font-mono text-xs">{s.masked_preview ?? (s.last4 ? `••••${s.last4}` : "•••")}</TableCell>
                  <TableCell className="tabular-nums">{s.version}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{s.rotated_at ? new Date(s.rotated_at).toLocaleDateString() : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ================================================================
// Audit
// ================================================================
function AuditTab({ tenantId }: { tenantId: string | null }) {
  const fn = useServerFn(listAdminAudit);
  const q = useQuery({ queryKey: ["ai-cp-audit", tenantId], queryFn: () => fn({ data: { limit: 200, tenant_id: tenantId ?? null } }) });
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">AI admin audit</h2>
        <p className="text-sm text-muted-foreground">Every provider, model, routing, secret, quota, and governance change — with before/after diffs (secrets redacted).</p>
      </div>
      <Card>
        <CardContent className="p-0">
          <ScrollArea className="h-[600px]">
            <Table>
              <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Actor</TableHead><TableHead>Action</TableHead><TableHead>Entity</TableHead><TableHead>Context</TableHead></TableRow></TableHeader>
              <TableBody>
                {(q.data ?? []).length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">No AI admin events yet.</TableCell></TableRow>
                )}
                {(q.data ?? []).map((r: AiAdminAuditRow) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-xs whitespace-nowrap">{new Date(r.occurred_at).toLocaleString()}</TableCell>
                    <TableCell className="font-mono text-xs">{r.actor_id?.slice(0, 8) ?? "system"}</TableCell>
                    <TableCell><code className="text-xs">{r.action}</code></TableCell>
                    <TableCell className="text-xs">{r.entity_type} <span className="text-muted-foreground">{r.entity_id?.slice(0, 8)}</span></TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-md truncate">{JSON.stringify(r.context)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

// ================================================================
// Inference Simulator — dry-run + live proxy through the new resolver
// ================================================================
function InferenceSimulator({ tenantId }: { tenantId: string | null }) {
  const [requestClass, setRequestClass] = useState<"chat" | "embedding" | "image" | "tool" | "agent" | "other">("chat");
  const [modelKey, setModelKey] = useState("");
  const [prompt, setPrompt] = useState("Say hello in one sentence.");
  const [mode, setMode] = useState<"dry" | "live">("dry");
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true); setResult(null);
    try {
      if (mode === "dry") {
        const { simulateInferenceRoute } = await import("@/lib/ai-inference.functions");
        const r = await simulateInferenceRoute({ data: {
          tenant_id: tenantId, request_class: requestClass,
          requested_model_key: modelKey || undefined,
        } });
        setResult({ kind: "dry", ...r });
      } else {
        const { executeInference } = await import("@/lib/ai-inference.functions");
        const r = await executeInference({ data: {
          tenant_id: tenantId, request_class: requestClass,
          requested_model_key: modelKey || undefined,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 256, temperature: 0.2,
        } });
        setResult({ kind: "live", ...r });
      }
    } catch (error) {
      reportPlatformError(error, { source: "user_feedback", surface: "AI inference simulator" });
      setResult({ kind: "error", title: USER_FACING_ERRORS.service.title,
        error: USER_FACING_ERRORS.service.message, action: USER_FACING_ERRORS.service.action });
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><PlayCircle className="h-5 w-5 text-primary" /> Inference Simulator</CardTitle>
          <CardDescription>
            Exercise the new metadata-driven routing resolver end-to-end. <strong>Dry-run</strong> shows which policy + chain entry + provider instance + model would be selected without touching upstream. <strong>Live</strong> proxies a real chat completion through the resolver (secret is unwrapped from the vault, upstream is called, usage is recorded).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <Label>Request class</Label>
              <Select value={requestClass} onValueChange={(v) => setRequestClass(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["chat","embedding","image","tool","agent","other"].map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Model key (optional)</Label>
              <Input value={modelKey} onChange={(e) => setModelKey(e.target.value)} placeholder="e.g. gpt-4o-mini" />
            </div>
            <div>
              <Label>Mode</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="dry">Dry-run (resolve only)</SelectItem>
                  <SelectItem value="live">Live (proxy upstream)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={run} disabled={busy} className="w-full">
                <PlayCircle className="h-4 w-4 mr-1" />{busy ? "Running…" : "Run"}
              </Button>
            </div>
          </div>
          {mode === "live" && (
            <div>
              <Label>Prompt</Label>
              <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} />
            </div>
          )}
        </CardContent>
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {result.kind === "error" ? USER_FACING_ERRORS.service.title : result.kind === "dry" ? "Selected AI route (dry-run)" : result.ok ? "AI response completed" : "AI request needs attention"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {result.kind === "dry" && result.ok && (
              <div className="space-y-2 text-sm">
                <div><span className="text-muted-foreground">Policy:</span> {result.resolved.policy_name ?? "—"} <span className="text-muted-foreground">routing step {Number(result.resolved.chain_index) + 1}</span></div>
                <div><span className="text-muted-foreground">Provider:</span> {result.resolved.provider_display}</div>
                <div><span className="text-muted-foreground">Model:</span> <code>{result.resolved.model_key}</code></div>
              </div>
            )}
            {result.kind === "live" && (
              <div className="space-y-2 text-sm">
                <div className="flex flex-wrap gap-4">
                  <Badge variant={result.ok ? "default" : "destructive"}>{result.ok ? "Completed" : "Needs attention"}</Badge>
                  <span className="text-muted-foreground">{result.latency_ms} ms</span>
                  {result.route && (
                    <>
                      <Badge variant="outline"><code>{result.route.model_key}</code></Badge>
                      <Badge variant="outline">{result.route.provider_display}</Badge>
                    </>
                  )}
                  {result.usage && (
                    <span className="text-muted-foreground">
                      tokens: {result.usage.prompt_tokens ?? result.usage.input_tokens ?? 0} in / {result.usage.completion_tokens ?? result.usage.output_tokens ?? 0} out
                    </span>
                  )}
                </div>
                {result.content && (
                  <div>
                    <Label className="text-xs">Response</Label>
                    <pre className="text-xs bg-muted p-3 rounded whitespace-pre-wrap max-h-96 overflow-auto">{result.content}</pre>
                  </div>
                )}
                {result.error && <Alert variant="destructive" role="alert"><AlertTitle>{result.title ?? USER_FACING_ERRORS.service.title}</AlertTitle><AlertDescription>{result.error} {result.action ?? USER_FACING_ERRORS.service.action}{result.reference_id ? ` Error Reference ID: ${result.reference_id}` : ""}</AlertDescription></Alert>}
              </div>
            )}
            {(result.kind === "error" || (result.ok === false && result.kind !== "live")) && (
              <Alert variant="destructive" role="alert"><AlertTitle>{result.title ?? USER_FACING_ERRORS.service.title}</AlertTitle><AlertDescription>{result.error ?? USER_FACING_ERRORS.service.message} {result.action ?? USER_FACING_ERRORS.service.action}{result.reference_id ? ` Error Reference ID: ${result.reference_id}` : ""}</AlertDescription></Alert>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
export function AiControlPlane({ tenantId = null }: { tenantId?: string | null }) {
  const [tab, setTab] = useState("dashboard");
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><Layers className="h-6 w-6 text-primary" /> AI Control Plane</h1>
          <p className="text-sm text-muted-foreground max-w-3xl mt-1">
            One console for every AI decision — providers, models, routing, cost, security, governance, and audit.
            Every provider, model, and routing rule is metadata; nothing is hardcoded. Every credential lives in the encrypted vault and is masked forever after save.
          </p>
        </div>
        <Badge variant="outline" className="whitespace-nowrap">{tenantId ? "Tenant scope" : "Platform scope"}</Badge>
      </div>
      <Separator />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="dashboard"><Gauge className="h-4 w-4 mr-1" />Executive</TabsTrigger>
          <TabsTrigger value="status"><LayoutGrid className="h-4 w-4 mr-1" />Status Matrix</TabsTrigger>
          <TabsTrigger value="usage"><BarChart3 className="h-4 w-4 mr-1" />Usage Analytics</TabsTrigger>
          <TabsTrigger value="tokens"><TrendingUp className="h-4 w-4 mr-1" />Token Analytics</TabsTrigger>
          <TabsTrigger value="costcenter"><DollarSign className="h-4 w-4 mr-1" />Cost Center</TabsTrigger>
          <TabsTrigger value="risk"><Radar className="h-4 w-4 mr-1" />Risk & Compliance</TabsTrigger>
          <TabsTrigger value="ops"><HeartPulse className="h-4 w-4 mr-1" />Operations</TabsTrigger>
          <TabsTrigger value="governance"><ShieldCheck className="h-4 w-4 mr-1" />Governance</TabsTrigger>
          <TabsTrigger value="providers"><Boxes className="h-4 w-4 mr-1" />Providers</TabsTrigger>
          <TabsTrigger value="models"><Sparkles className="h-4 w-4 mr-1" />Models</TabsTrigger>
          <TabsTrigger value="routing"><Network className="h-4 w-4 mr-1" />Routing</TabsTrigger>
          <TabsTrigger value="cost"><Coins className="h-4 w-4 mr-1" />Quotas</TabsTrigger>
          <TabsTrigger value="vault"><KeyRound className="h-4 w-4 mr-1" />Vault</TabsTrigger>
          <TabsTrigger value="audit"><Fingerprint className="h-4 w-4 mr-1" />Audit</TabsTrigger>
          <TabsTrigger value="simulator"><PlayCircle className="h-4 w-4 mr-1" />Simulator</TabsTrigger>
        </TabsList>
        <TabsContent value="dashboard" className="mt-6"><ExecutiveDashboard /></TabsContent>
        <TabsContent value="status" className="mt-6"><AiStatusMatrixTab tenantId={tenantId} /></TabsContent>
        <TabsContent value="usage" className="mt-6"><AiUsageAnalyticsTab tenantId={tenantId} /></TabsContent>
        <TabsContent value="tokens" className="mt-6"><AiTokenAnalyticsTab tenantId={tenantId} /></TabsContent>
        <TabsContent value="costcenter" className="mt-6"><AiCostCenterTab tenantId={tenantId} /></TabsContent>
        <TabsContent value="risk" className="mt-6"><AiRiskComplianceTab tenantId={tenantId} /></TabsContent>
        <TabsContent value="ops" className="mt-6"><AiOperationsTab tenantId={tenantId} /></TabsContent>
        <TabsContent value="governance" className="mt-6"><GovernanceTab tenantId={tenantId} /></TabsContent>
        <TabsContent value="providers" className="mt-6"><ProvidersTab tenantId={tenantId} /></TabsContent>
        <TabsContent value="models" className="mt-6"><ModelsTab /></TabsContent>
        <TabsContent value="routing" className="mt-6"><RoutingTab tenantId={tenantId} /></TabsContent>
        <TabsContent value="cost" className="mt-6"><CostTab /></TabsContent>
        <TabsContent value="vault" className="mt-6"><VaultPickerTab tenantId={tenantId} /></TabsContent>
        <TabsContent value="audit" className="mt-6"><AuditTab tenantId={tenantId} /></TabsContent>
        <TabsContent value="simulator" className="mt-6"><InferenceSimulator tenantId={tenantId} /></TabsContent>
      </Tabs>
    </div>
  );
}
