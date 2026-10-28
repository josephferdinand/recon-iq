import { createFileRoute, useParams, Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { BackButton } from "@/components/back-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plug, PlayCircle, RefreshCw, Trash2, Save, ShieldCheck, Unlink, History, ScrollText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { listErpConnectors, upsertErpConnector, testErpConnector, deleteErpConnector, getErpConnectorMetadata, ERP_CONNECTOR_KINDS } from "@/lib/erp-connectors.functions";
import { ErpVaultCard } from "@/components/erp-vault-card";
import { ErpConnectorTestHistory } from "@/components/erp-connector-test-history";

export const Route = createFileRoute("/_authenticated/$slug/tenant/settings/erp-connectors")({
  head: () => ({ meta: [
    { title: "ERP Connectors — SAP, Oracle, Tally, Finacle, Flexcube" },
    { name: "description", content: "Configure ERP connectors for reconciliation ingestion with OAuth/API credential handling and canonical output schemas." },
  ] }),
  component: ErpConnectorsPage,
});

type Kind = typeof ERP_CONNECTOR_KINDS[number];

function ErpConnectorsPage() {
  const { slug } = useParams({ from: "/_authenticated/$slug/tenant/settings/erp-connectors" });
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [historyFor, setHistoryFor] = useState<{ id: string; name: string } | null>(null);

  // Resolve tenant_id from slug (browser client is fine here — public tenants row).
  useQuery({
    queryKey: ["tenant-id", slug],
    queryFn: async () => {
      const { data } = await supabase.from("tenants").select("id").eq("slug", slug).maybeSingle();
      const id = (data as any)?.id ?? null;
      setTenantId(id);
      return id;
    },
    staleTime: 60_000,
  });

  const listFn = useServerFn(listErpConnectors);
  const upsertFn = useServerFn(upsertErpConnector);
  const testFn = useServerFn(testErpConnector);
  const delFn = useServerFn(deleteErpConnector);
  const metaFn = useServerFn(getErpConnectorMetadata);

  const meta = useQuery({ queryKey: ["erp-meta"], queryFn: () => metaFn() });
  const list = useQuery({
    queryKey: ["erp-connectors", tenantId],
    queryFn: () => listFn({ data: { tenant_id: tenantId! } }),
    enabled: !!tenantId,
  });

  const upsertMut = useMutation({
    mutationFn: (payload: any) => upsertFn({ data: payload }),
    onSuccess: () => { toast.success("Connector saved."); setEditing(null); list.refetch(); },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });
  const testMut = useMutation({
    mutationFn: (id: string) => testFn({ data: { connector_id: id } }),
    onSuccess: (res) => { toast[res.ok ? "success" : "error"](res.message); list.refetch(); },
    onError: (e: any) => toast.error(e?.message ?? "Test failed"),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => delFn({ data: { connector_id: id } }),
    onSuccess: () => { toast.success("Deleted."); list.refetch(); },
    onError: (e: any) => toast.error(e?.message ?? "Delete failed"),
  });

  const startNew = (kind: Kind) => {
    const d = meta.data?.defaults?.[kind];
    setEditing({
      tenant_id: tenantId,
      connector_kind: kind,
      display_name: d?.display_name ?? kind.toUpperCase(),
      auth_method: d?.auth_method ?? "oauth2",
      base_url: "",
      environment: "sandbox",
      scopes: d?.scopes ?? [],
      extra_config: d?.extra_config ?? {},
    });
  };

  const connectors = list.data?.connectors ?? [];
  const existingKinds = new Set(connectors.map((c: any) => c.connector_kind));

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <BackButton />
      <header className="mt-6 mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">Tenant settings</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Plug className="h-7 w-7 text-primary" aria-hidden />
            ERP Connectors
          </h1>
          <p className="mt-2 max-w-3xl text-muted-foreground">
            Configure SAP, Oracle, Tally, Finacle, and Flexcube feeds. Each connector supports
            OAuth 2.0, API key, basic, service-account, or SSH-key credentials. Secrets are stored
            in the app vault — this UI stores only the vault reference, never the raw secret.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild className="gap-2">
            <Link to="/$slug/tenant/settings/erp-connectors/audit" params={{ slug }}>
              <ScrollText className="h-4 w-4" aria-hidden /> Audit log
            </Link>
          </Button>
          <Button variant="outline" onClick={() => list.refetch()} className="gap-2">
            <RefreshCw className="h-4 w-4" aria-hidden /> Refresh
          </Button>
        </div>
      </header>

      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">Add a connector</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {ERP_CONNECTOR_KINDS.map((k) => (
            <Button key={k} variant={existingKinds.has(k) ? "ghost" : "secondary"}
              disabled={existingKinds.has(k) || !tenantId} onClick={() => startNew(k)}>
              {k.toUpperCase()}{existingKinds.has(k) ? " ✓" : ""}
            </Button>
          ))}
        </CardContent>
      </Card>

      {editing ? (
        <Card className="mb-6 border-primary/40">
          <CardHeader>
            <CardTitle className="text-base">
              {editing.id ? "Edit" : "New"} · {editing.connector_kind.toUpperCase()} connector
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Display name</Label>
              <Input value={editing.display_name} onChange={(e) => setEditing({ ...editing, display_name: e.target.value })} />
            </div>
            <div>
              <Label>Environment</Label>
              <Select value={editing.environment} onValueChange={(v) => setEditing({ ...editing, environment: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sandbox">Sandbox</SelectItem>
                  <SelectItem value="uat">UAT</SelectItem>
                  <SelectItem value="production">Production</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Auth method</Label>
              <Select value={editing.auth_method} onValueChange={(v) => setEditing({ ...editing, auth_method: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="oauth2">OAuth 2.0</SelectItem>
                  <SelectItem value="api_key">API Key</SelectItem>
                  <SelectItem value="basic">Basic Auth</SelectItem>
                  <SelectItem value="service_account">Service Account</SelectItem>
                  <SelectItem value="ssh_key">SSH Key</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Base URL</Label>
              <Input placeholder={meta.data?.defaults?.[editing.connector_kind as Kind]?.base_url_placeholder ?? ""}
                value={editing.base_url ?? ""} onChange={(e) => setEditing({ ...editing, base_url: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <Label>Scopes (comma-separated)</Label>
              <Input value={(editing.scopes ?? []).join(", ")}
                onChange={(e) => setEditing({ ...editing, scopes: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
            </div>
            <div className="md:col-span-2">
              <Label>Extra config (JSON)</Label>
              <Input value={JSON.stringify(editing.extra_config ?? {})} onChange={(e) => {
                try { setEditing({ ...editing, extra_config: JSON.parse(e.target.value) }); } catch { /* ignore invalid */ }
              }} />
            </div>
            <div className="md:col-span-2 rounded-md border border-border/60 bg-muted/30 p-3">
              <Label className="flex items-center gap-2 text-sm">
                <ShieldCheck className="h-4 w-4 text-primary" aria-hidden />
                Attached vault credential
              </Label>
              <p className="mt-1 text-xs text-muted-foreground">
                {editing.credential_vault_secret_id
                  ? <>Linked to vault secret <code className="font-mono">{editing.credential_vault_secret_id.slice(0, 8)}…</code>. Use the vault card below to change, rotate, or test.</>
                  : <>No credential linked yet. Add or select one in the vault card below, then click <em>Attach</em>.</>}
              </p>
              {editing.credential_vault_secret_id ? (
                <Button size="sm" variant="ghost" className="mt-2 gap-1"
                  onClick={() => setEditing({ ...editing, credential_vault_secret_id: null })}>
                  <Unlink className="h-3 w-3" /> Detach
                </Button>
              ) : null}
            </div>
            <div className="md:col-span-2 flex gap-2">
              <Button className="gap-2" disabled={upsertMut.isPending}
                onClick={() => upsertMut.mutate({
                  id: editing.id, tenant_id: tenantId,
                  connector_kind: editing.connector_kind, display_name: editing.display_name,
                  auth_method: editing.auth_method, base_url: editing.base_url || null,
                  environment: editing.environment, scopes: editing.scopes,
                  extra_config: editing.extra_config,
                  credential_vault_secret_id: editing.credential_vault_secret_id ?? null,
                })}>
                <Save className="h-4 w-4" aria-hidden /> {editing.id ? "Update" : "Create"}
              </Button>
              <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="mb-6">
        <ErpVaultCard
          tenantId={tenantId}
          selectedSecretId={editing?.credential_vault_secret_id ?? null}
          suggestedBaseUrl={editing?.base_url || null}
          onAttach={editing
            ? (s) => setEditing({ ...editing, credential_vault_secret_id: s.id })
            : undefined}
        />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Configured connectors ({connectors.length})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {list.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : connectors.length === 0 ? (
            <p className="text-sm text-muted-foreground">No connectors yet. Pick one above to begin.</p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Kind</TableHead><TableHead>Name</TableHead><TableHead>Env</TableHead>
                <TableHead>Auth</TableHead><TableHead>Base URL</TableHead><TableHead>Status</TableHead>
                <TableHead>Last test</TableHead><TableHead className="text-right">Actions</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {connectors.map((c: any) => (
                  <TableRow key={c.id}>
                    <TableCell><Badge>{c.connector_kind.toUpperCase()}</Badge></TableCell>
                    <TableCell>{c.display_name}</TableCell>
                    <TableCell><Badge variant="outline">{c.environment}</Badge></TableCell>
                    <TableCell className="text-xs">{c.auth_method}</TableCell>
                    <TableCell className="max-w-[280px] truncate font-mono text-xs">{c.base_url ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={c.status === "active" ? "default" : c.status === "error" ? "destructive" : "secondary"}>
                        {c.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {c.last_test_at ? new Date(c.last_test_at).toLocaleString() : "never"}
                    </TableCell>
                    <TableCell className="flex justify-end gap-1">
                      <Button size="sm" variant="outline" className="gap-1" disabled={testMut.isPending}
                        onClick={() => testMut.mutate(c.id)}>
                        <PlayCircle className="h-3 w-3" aria-hidden /> Test
                      </Button>
                      <Button
                        size="sm"
                        variant={historyFor?.id === c.id ? "default" : "ghost"}
                        className="gap-1"
                        onClick={() => setHistoryFor(historyFor?.id === c.id ? null : { id: c.id, name: c.display_name })}
                      >
                        <History className="h-3 w-3" aria-hidden /> History
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing({ ...c })}>Edit</Button>
                      <Button size="sm" variant="ghost" className="text-destructive"
                        onClick={() => { if (confirm(`Delete ${c.display_name}?`)) delMut.mutate(c.id); }}>
                        <Trash2 className="h-3 w-3" aria-hidden />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {historyFor ? (
        <ErpConnectorTestHistory
          connectorId={historyFor.id}
          connectorName={historyFor.name}
          onAfterRetry={() => list.refetch()}
        />
      ) : null}


      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">Canonical reconciliation output schema (v1.0)</CardTitle></CardHeader>
        <CardContent className="text-xs">
          <p className="mb-3 text-sm text-muted-foreground">
            Every connector normalizes source records to this shape before feeding the recon engine. Full spec:
            <a className="ml-1 text-primary underline" href="/api/appendix/erp-connector-output-schemas.md">erp_connector_output_schemas.md</a>.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="mb-2 font-semibold text-foreground">Common columns</h3>
              <ul className="list-disc pl-5 space-y-0.5 text-muted-foreground">
                {(meta.data?.schema?.common ?? []).map((c: any) => (
                  <li key={c.name}><span className="font-mono text-foreground">{c.name}</span> · {c.type}{c.required ? " · required" : ""}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-2 font-semibold text-foreground">Connector-specific columns</h3>
              <ul className="space-y-1 text-muted-foreground">
                {Object.entries(meta.data?.schema?.connector_specific ?? {}).map(([k, cols]) => (
                  <li key={k}><span className="font-mono text-foreground">{k}</span>: {(cols as string[]).join(", ")}</li>
                ))}
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
