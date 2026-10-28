import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  listEventCatalog,
  listApiSurfaces,
  listPlugins,
  upsertPlugin,
  togglePlugin,
  deletePlugin,
  simulatePluginExecution,
  listPluginExecutions,
  listSandboxLinks,
  createSandboxLink,
  refreshSandbox,
  deleteSandboxLink,
  generateIacExport,
  listIacExports,
  getIacExportContent,
} from "@/lib/devplatform.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Code2, Download, FlaskConical, Plug, Radio, RefreshCw, Trash2, Workflow } from "lucide-react";

type DevPlatformTabProps = { tenantId: string; canWrite: boolean };

export function DevPlatformTab({ tenantId, canWrite }: DevPlatformTabProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-semibold tracking-tight">Developer Platform</h2>
        <p className="text-sm text-muted-foreground">
          Lifecycle events, Plugin SDK, sandbox tenants, and Infrastructure-as-Code export.
        </p>
      </div>
      <Tabs defaultValue="events" className="space-y-4">
        <TabsList>
          <TabsTrigger value="events"><Radio className="mr-2 h-4 w-4" />Event Catalog</TabsTrigger>
          <TabsTrigger value="api"><Workflow className="mr-2 h-4 w-4" />API Surface</TabsTrigger>
          <TabsTrigger value="plugins"><Plug className="mr-2 h-4 w-4" />Plugin SDK</TabsTrigger>
          <TabsTrigger value="sandbox"><FlaskConical className="mr-2 h-4 w-4" />Sandbox Tenants</TabsTrigger>
          <TabsTrigger value="iac"><Code2 className="mr-2 h-4 w-4" />IaC Export</TabsTrigger>
        </TabsList>
        <TabsContent value="events"><EventCatalogPanel /></TabsContent>
        <TabsContent value="api"><ApiSurfacePanel /></TabsContent>
        <TabsContent value="plugins"><PluginsPanel tenantId={tenantId} canWrite={canWrite} /></TabsContent>
        <TabsContent value="sandbox"><SandboxPanel tenantId={tenantId} canWrite={canWrite} /></TabsContent>
        <TabsContent value="iac"><IacPanel tenantId={tenantId} canWrite={canWrite} /></TabsContent>
      </Tabs>
    </div>
  );
}

function EventCatalogPanel() {
  const fn = useServerFn(listEventCatalog);
  const { data } = useQuery({ queryKey: ["dev-events"], queryFn: () => fn() });
  const grouped = (data ?? []).reduce<Record<string, typeof data>>((acc, e) => {
    acc[e.category] = acc[e.category] ?? [];
    acc[e.category]!.push(e);
    return acc;
  }, {} as Record<string, typeof data>);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Lifecycle event catalog</CardTitle>
        <CardDescription>
          {data?.length ?? 0} events available. Subscribe via Webhooks tab. Includes break, recon,
          agent, AIDP, security, and resilience lifecycle hooks.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {Object.entries(grouped).map(([cat, events]) => (
          <div key={cat}>
            <h4 className="mb-2 text-sm font-medium text-muted-foreground uppercase tracking-wide">{cat}</h4>
            <div className="space-y-1">
              {(events ?? []).map((e) => (
                <div key={e.event_key} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <div className="flex items-center gap-3">
                    <code className="font-mono text-xs">{e.event_key}</code>
                    <span className="text-muted-foreground">{e.description}</span>
                  </div>
                  <Badge variant={e.stability === "stable" ? "default" : "secondary"}>{e.stability}</Badge>
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ApiSurfacePanel() {
  const fn = useServerFn(listApiSurfaces);
  const { data } = useQuery({ queryKey: ["dev-api"], queryFn: () => fn() });
  return (
    <Card>
      <CardHeader>
        <CardTitle>API surface — REST · GraphQL · gRPC · SDKs</CardTitle>
        <CardDescription>Parity matrix across protocols. {data?.length ?? 0} surfaces tracked.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Protocol</TableHead>
              <TableHead>Resource</TableHead>
              <TableHead>Operation</TableHead>
              <TableHead>Endpoint</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data ?? []).map((s) => (
              <TableRow key={s.id}>
                <TableCell><Badge variant="outline" className="uppercase">{s.protocol}</Badge></TableCell>
                <TableCell>{s.resource}</TableCell>
                <TableCell className="font-mono text-xs">{s.operation}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{s.endpoint}</TableCell>
                <TableCell>
                  <Badge variant={s.status === "ga" ? "default" : s.status === "planned" || s.status === "deprecated" ? "secondary" : "outline"}>
                    {s.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function PluginsPanel({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listPlugins);
  const upsertFn = useServerFn(upsertPlugin);
  const toggleFn = useServerFn(togglePlugin);
  const delFn = useServerFn(deletePlugin);
  const simFn = useServerFn(simulatePluginExecution);
  const { data } = useQuery({ queryKey: ["plugins", tenantId], queryFn: () => listFn({ data: { tenantId } }) });
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    name: "",
    slug: "",
    kind: "matcher" as const,
    description: "",
    source_code: "export default function(ctx, row) {\n  // return { matched: true, score: 1 };\n  return null;\n}\n",
  });

  const create = useMutation({
    mutationFn: () =>
      upsertFn({
        data: {
          tenant_id: tenantId,
          name: draft.name,
          slug: draft.slug,
          kind: draft.kind,
          version: "0.1.0",
          description: draft.description,
          source_code: draft.source_code,
          entry_point: "default",
          status: "draft" as const,
          enabled: false,
        },
      }),
    onSuccess: () => {
      toast.success("Plugin created");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["plugins", tenantId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Plugin SDK</CardTitle>
            <CardDescription>Custom matchers, enrichers, validators, transformers, and UI panels. Executed in a sandboxed isolate with CPU/memory/timeout limits.</CardDescription>
          </div>
          {canWrite && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild><Button><Plug className="mr-2 h-4 w-4" />New plugin</Button></DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader><DialogTitle>Create plugin</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Name</Label><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
                    <div><Label>Slug</Label><Input value={draft.slug} onChange={(e) => setDraft({ ...draft, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} /></div>
                  </div>
                  <div>
                    <Label>Kind</Label>
                    <Select value={draft.kind} onValueChange={(v) => setDraft({ ...draft, kind: v as typeof draft.kind })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="matcher">Matcher</SelectItem>
                        <SelectItem value="enricher">Enricher</SelectItem>
                        <SelectItem value="validator">Validator</SelectItem>
                        <SelectItem value="transformer">Transformer</SelectItem>
                        <SelectItem value="panel">UI Panel</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Description</Label><Input value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></div>
                  <div>
                    <Label>TypeScript source (sandboxed)</Label>
                    <Textarea rows={10} className="font-mono text-xs" value={draft.source_code} onChange={(e) => setDraft({ ...draft, source_code: e.target.value })} />
                    <p className="mt-1 text-xs text-muted-foreground">No <code>process</code>, <code>require</code>, <code>import()</code>, <code>eval</code>, <code>fetch</code>, or DOM access. CPU 500ms · 64MB · 2s timeout.</p>
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={() => create.mutate()} disabled={create.isPending || !draft.name || !draft.slug}>Create</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead><TableHead>Kind</TableHead><TableHead>Version</TableHead>
                <TableHead>Status</TableHead><TableHead>Enabled</TableHead><TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data ?? []).map((p) => (
                <TableRow key={p.id}>
                  <TableCell><div className="font-medium">{p.name}</div><code className="text-xs text-muted-foreground">{p.slug}</code></TableCell>
                  <TableCell><Badge variant="outline">{p.kind}</Badge></TableCell>
                  <TableCell className="font-mono text-xs">{p.version}</TableCell>
                  <TableCell><Badge variant={p.status === "enabled" ? "default" : "secondary"}>{p.status}</Badge></TableCell>
                  <TableCell>
                    {canWrite ? (
                      <Switch
                        checked={p.enabled}
                        onCheckedChange={async (v) => {
                          await toggleFn({ data: { id: p.id, enabled: v } });
                          qc.invalidateQueries({ queryKey: ["plugins", tenantId] });
                        }}
                      />
                    ) : (
                      <Badge variant={p.enabled ? "default" : "secondary"}>{p.enabled ? "on" : "off"}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button size="sm" variant="outline" onClick={async () => {
                      const r = await simFn({ data: { pluginId: p.id, tenantId, input: "{}" } });
                      toast[r.status === "ok" ? "success" : "error"](`${r.status} · ${r.duration_ms}ms${r.error ? " · " + r.error : ""}`);
                    }}>Simulate</Button>
                    {canWrite && (
                      <Button size="sm" variant="ghost" onClick={async () => {
                        if (!confirm("Delete plugin?")) return;
                        await delFn({ data: { id: p.id } });
                        qc.invalidateQueries({ queryKey: ["plugins", tenantId] });
                      }}><Trash2 className="h-4 w-4" /></Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(!data || data.length === 0) && (
                <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No plugins yet</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function SandboxPanel({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listSandboxLinks);
  const createFn = useServerFn(createSandboxLink);
  const refreshFn = useServerFn(refreshSandbox);
  const delFn = useServerFn(deleteSandboxLink);
  const { data } = useQuery({ queryKey: ["sandboxes", tenantId], queryFn: () => listFn({ data: { tenantId } }) });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("CI Sandbox");
  const [purpose, setPurpose] = useState<"ci-cd" | "uat" | "training" | "perf">("ci-cd");
  const [seed, setSeed] = useState<"empty" | "masked" | "synthetic">("masked");

  const create = useMutation({
    mutationFn: () => createFn({ data: { prodTenantId: tenantId, sandboxName: name, purpose, dataSeed: seed } }),
    onSuccess: () => {
      toast.success("Sandbox tenant provisioned");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["sandboxes", tenantId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Sandbox tenants</CardTitle>
          <CardDescription>Auto-provisioned sibling tenants for CI/CD, UAT, training, and performance testing. Same region as production.</CardDescription>
        </div>
        {canWrite && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><FlaskConical className="mr-2 h-4 w-4" />Provision sandbox</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Provision sandbox tenant</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
                <div>
                  <Label>Purpose</Label>
                  <Select value={purpose} onValueChange={(v) => setPurpose(v as typeof purpose)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ci-cd">CI/CD</SelectItem>
                      <SelectItem value="uat">UAT</SelectItem>
                      <SelectItem value="training">Training</SelectItem>
                      <SelectItem value="perf">Performance</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Data seed</Label>
                  <Select value={seed} onValueChange={(v) => setSeed(v as typeof seed)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="empty">Empty</SelectItem>
                      <SelectItem value="masked">Masked production copy</SelectItem>
                      <SelectItem value="synthetic">Synthetic</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter><Button onClick={() => create.mutate()} disabled={create.isPending}>Provision</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow><TableHead>Sandbox</TableHead><TableHead>Purpose</TableHead><TableHead>Seed</TableHead><TableHead>API base</TableHead><TableHead>Last refreshed</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>
            {(data ?? []).map((l) => {
              const st = (l as { sandbox_tenant?: { name?: string; slug?: string } }).sandbox_tenant;
              return (
                <TableRow key={l.id}>
                  <TableCell><div className="font-medium">{st?.name ?? "—"}</div><code className="text-xs text-muted-foreground">{st?.slug}</code></TableCell>
                  <TableCell><Badge variant="outline">{l.purpose}</Badge></TableCell>
                  <TableCell>{l.data_seed}</TableCell>
                  <TableCell><code className="text-xs">{l.api_base_url}</code></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{l.last_refreshed_at ? new Date(l.last_refreshed_at).toLocaleString() : "Never"}</TableCell>
                  <TableCell className="text-right space-x-2">
                    {canWrite && (
                      <>
                        <Button size="sm" variant="outline" onClick={async () => {
                          await refreshFn({ data: { linkId: l.id } });
                          qc.invalidateQueries({ queryKey: ["sandboxes", tenantId] });
                          toast.success("Refresh scheduled");
                        }}><RefreshCw className="h-4 w-4" /></Button>
                        <Button size="sm" variant="ghost" onClick={async () => {
                          if (!confirm("Delete sandbox link?")) return;
                          await delFn({ data: { linkId: l.id } });
                          qc.invalidateQueries({ queryKey: ["sandboxes", tenantId] });
                        }}><Trash2 className="h-4 w-4" /></Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {(!data || data.length === 0) && (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No sandbox tenants</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function IacPanel({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listIacExports);
  const genFn = useServerFn(generateIacExport);
  const getFn = useServerFn(getIacExportContent);
  const { data } = useQuery({ queryKey: ["iac", tenantId], queryFn: () => listFn({ data: { tenantId } }) });
  const [kind, setKind] = useState<"terraform" | "pulumi-ts" | "pulumi-py" | "crossplane">("terraform");
  const [scope, setScope] = useState<"tenant" | "rules" | "users" | "full">("full");

  const generate = useMutation({
    mutationFn: () => genFn({ data: { tenantId, kind, scope } }),
    onSuccess: () => { toast.success("IaC export generated"); qc.invalidateQueries({ queryKey: ["iac", tenantId] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Infrastructure-as-Code export</CardTitle>
        <CardDescription>Render this tenant's configuration as Terraform, Pulumi (TS/Py), or Crossplane manifests. SHA-256 anchored.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {canWrite && (
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Label>Provider</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="terraform">Terraform</SelectItem>
                  <SelectItem value="pulumi-ts">Pulumi (TypeScript)</SelectItem>
                  <SelectItem value="pulumi-py">Pulumi (Python)</SelectItem>
                  <SelectItem value="crossplane">Crossplane</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1">
              <Label>Scope</Label>
              <Select value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="tenant">Tenant only</SelectItem>
                  <SelectItem value="rules">Recon rules</SelectItem>
                  <SelectItem value="users">Users</SelectItem>
                  <SelectItem value="full">Full</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={() => generate.mutate()} disabled={generate.isPending}><Download className="mr-2 h-4 w-4" />Generate</Button>
          </div>
        )}
        <Table>
          <TableHeader><TableRow><TableHead>Kind</TableHead><TableHead>Scope</TableHead><TableHead>Resources</TableHead><TableHead>SHA-256</TableHead><TableHead>Generated</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
          <TableBody>
            {(data ?? []).map((x) => (
              <TableRow key={x.id}>
                <TableCell><Badge variant="outline">{x.kind}</Badge></TableCell>
                <TableCell>{x.scope}</TableCell>
                <TableCell>{x.resource_count}</TableCell>
                <TableCell className="font-mono text-xs">{x.sha256.slice(0, 16)}…</TableCell>
                <TableCell className="text-xs text-muted-foreground">{new Date(x.generated_at).toLocaleString()}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" onClick={async () => {
                    const r = await getFn({ data: { id: x.id } });
                    const blob = new Blob([r.content], { type: "text/plain" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `reconiq-${x.kind}-${x.id.slice(0, 8)}.${x.kind === "terraform" ? "tf" : x.kind === "pulumi-py" ? "py" : x.kind === "crossplane" ? "yaml" : "ts"}`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}><Download className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {(!data || data.length === 0) && (
              <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">No exports yet</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// Suppress unused import warning — used for plugin execution history dialog if expanded later.
void listPluginExecutions;
