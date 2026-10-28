import { createFileRoute, useParams, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { BackButton } from "@/components/back-button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Copy, Download, Loader2, RefreshCw, ScrollText, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { listErpVaultAuditLog, ERP_VAULT_AUDIT_ACTIONS } from "@/lib/erp-vault-audit.functions";

export const Route = createFileRoute("/_authenticated/$slug/tenant/settings/erp-connectors/audit")({
  head: () => ({ meta: [
    { title: "ERP credential vault — audit log" },
    { name: "description", content: "Immutable audit trail of credential vault create, rotate, delete, test and connector attach actions with actor and correlation IDs." },
  ] }),
  component: ErpVaultAuditPage,
});

const ACTION_GROUPS: Record<string, { label: string; tone: "default" | "secondary" | "outline" | "destructive" }> = {
  "vault.secret.create":         { label: "create",   tone: "default" },
  "vault.secret.created":        { label: "create",   tone: "default" },
  "vault.secret.rotate":         { label: "rotate",   tone: "secondary" },
  "vault.secret.rotated":        { label: "rotate",   tone: "secondary" },
  "vault.secret.rotate.verified":{ label: "rotate ✓", tone: "secondary" },
  "vault.secret.rotate.reverted":{ label: "rotate ↺", tone: "destructive" },
  "vault.secret.delete":         { label: "delete",   tone: "destructive" },
  "vault.secret.deleted":        { label: "delete",   tone: "destructive" },
  "vault.secret.rollback":       { label: "rollback", tone: "destructive" },
  "vault.secret.tested":         { label: "test",     tone: "outline" },
  "vault.kms.create":            { label: "kms+",     tone: "default" },
  "vault.kms.update":            { label: "kms ~",    tone: "secondary" },
  "vault.kms.delete":            { label: "kms −",    tone: "destructive" },
  "vault.kms.test":              { label: "kms test", tone: "outline" },
  "erp_connector.created":       { label: "attach",   tone: "default" },
  "erp_connector.updated":       { label: "update",   tone: "secondary" },
  "erp_connector.deleted":       { label: "detach",   tone: "destructive" },
  "erp_connector.tested":        { label: "conn test",tone: "outline" },
};

function ErpVaultAuditPage() {
  const { slug } = useParams({ from: "/_authenticated/$slug/tenant/settings/erp-connectors/audit" });
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [since, setSince] = useState<string>("");
  const [resourceId, setResourceId] = useState<string>("");
  const [detail, setDetail] = useState<any | null>(null);

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

  const listFn = useServerFn(listErpVaultAuditLog);
  const q = useQuery({
    queryKey: ["erp-vault-audit", tenantId, actionFilter, search, since, resourceId],
    enabled: !!tenantId,
    queryFn: () => listFn({ data: {
      tenant_id: tenantId!,
      include_platform: true,
      actions: actionFilter === "all" ? undefined : [actionFilter],
      search: search.trim() || undefined,
      since: since ? new Date(since).toISOString() : undefined,
      resource_id: resourceId.trim() || undefined,
      limit: 300,
    } }),
  });

  const rows = q.data?.rows ?? [];

  const exportCsv = useMemo(() => () => {
    const header = ["occurred_at","actor_email","actor_user_id","scope","tenant_slug","action","resource_type","resource_id","connector_id","secret_id","version","fingerprint","run_id","request_id","client_ip"];
    const escape = (v: any) => {
      if (v == null) return "";
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };
    const lines = [header.join(",")];
    for (const r of rows) {
      lines.push([
        r.occurred_at, r.actor_email, r.actor_user_id, r.scope, r.tenant_slug,
        r.action, r.resource_type, r.resource_id,
        r.correlation?.connector_id, r.correlation?.secret_id, r.correlation?.version,
        r.correlation?.fingerprint, r.correlation?.run_id, r.correlation?.request_id,
        r.client_ip,
      ].map(escape).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `erp-vault-audit-${slug}-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [rows, slug]);

  const copy = (v: string | null | undefined) => {
    if (!v) return;
    navigator.clipboard.writeText(v).then(() => toast.success("Copied"));
  };

  return (
    <div className="container max-w-7xl mx-auto py-6 space-y-4">
      <BackButton />
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <ScrollText className="h-5 w-5" />
            ERP credential vault — audit log
          </h1>
          <p className="text-sm text-muted-foreground">
            Immutable trail of every create, rotate, delete, test and connector attach action. Hash-chained rows are enforced server-side by RLS.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/$slug/tenant/settings/erp-connectors" params={{ slug }}>
              ← ERP connectors
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
            {q.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
            <Download className="h-4 w-4 mr-1" /> CSV
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
          <CardDescription>
            Platform-scoped events (KMS bindings, platform secrets) are included when relevant to this tenant.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <Label className="text-xs">Action</Label>
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                {ERP_VAULT_AUDIT_ACTIONS.map((a) => (
                  <SelectItem key={a} value={a}>{a}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Search (actor / action / resource)</Label>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="alice@… or rotate" className="pl-7" />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Resource ID</Label>
            <Input value={resourceId} onChange={(e) => setResourceId(e.target.value)} placeholder="secret / connector / binding UUID" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Since</Label>
            <Input type="datetime-local" value={since} onChange={(e) => setSince(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {q.isLoading ? "Loading…" : `${rows.length} event${rows.length === 1 ? "" : "s"}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[170px]">When</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>Correlation</TableHead>
                  <TableHead className="w-[80px]">Client</TableHead>
                  <TableHead className="w-[80px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r: any) => {
                  const g = ACTION_GROUPS[r.action] ?? { label: r.action, tone: "outline" as const };
                  return (
                    <TableRow key={r.id} className="align-top">
                      <TableCell className="text-xs font-mono text-muted-foreground">
                        {new Date(r.occurred_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="font-medium">{r.actor_email ?? "—"}</div>
                        <div className="font-mono text-muted-foreground truncate max-w-[180px]" title={r.actor_user_id ?? ""}>
                          {r.actor_user_id ? r.actor_user_id.slice(0, 8) + "…" : "system"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={g.tone}>{g.label}</Badge>
                        <div className="text-[10px] text-muted-foreground font-mono mt-1">{r.action}</div>
                        <div className="text-[10px] text-muted-foreground">{r.scope}{r.tenant_slug ? ` · ${r.tenant_slug}` : ""}</div>
                      </TableCell>
                      <TableCell className="text-xs">
                        <div>{r.resource_type ?? "—"}</div>
                        <button
                          className="font-mono text-[11px] text-muted-foreground hover:text-foreground truncate max-w-[220px] block text-left"
                          onClick={() => copy(r.resource_id)}
                          title={r.resource_id ?? ""}
                        >
                          {r.resource_id ?? "—"}
                        </button>
                      </TableCell>
                      <TableCell className="text-[11px] font-mono space-y-0.5">
                        {r.correlation?.connector_id && (
                          <div><span className="text-muted-foreground">conn:</span> {r.correlation.connector_id.slice(0,8)}…</div>
                        )}
                        {r.correlation?.secret_id && (
                          <div><span className="text-muted-foreground">sec:</span> {r.correlation.secret_id.slice(0,8)}…</div>
                        )}
                        {r.correlation?.version != null && (
                          <div><span className="text-muted-foreground">v:</span> {r.correlation.from_version ? `${r.correlation.from_version}→` : ""}{r.correlation.version}</div>
                        )}
                        {r.correlation?.fingerprint && (
                          <div><span className="text-muted-foreground">fp:</span> {String(r.correlation.fingerprint).slice(0,12)}…</div>
                        )}
                        {r.correlation?.run_id && (
                          <div><span className="text-muted-foreground">run:</span> {String(r.correlation.run_id).slice(0,8)}…</div>
                        )}
                        {r.correlation?.request_id && (
                          <div><span className="text-muted-foreground">req:</span> {String(r.correlation.request_id).slice(0,10)}…</div>
                        )}
                      </TableCell>
                      <TableCell className="text-[11px] font-mono text-muted-foreground">
                        {r.client_ip ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => setDetail(r)}>Details</Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!q.isLoading && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-10">
                      No matching audit events.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!detail} onOpenChange={(v) => { if (!v) setDetail(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ScrollText className="h-4 w-4" />
              Audit event #{detail?.id}
            </DialogTitle>
            <DialogDescription>
              Full context payload. Every field is hash-chained into the append-only ledger.
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-2 text-xs">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">when</span><div className="font-mono">{new Date(detail.occurred_at).toISOString()}</div></div>
                <div><span className="text-muted-foreground">actor</span><div className="font-mono">{detail.actor_email ?? "—"} · {detail.actor_user_id ?? "system"}</div></div>
                <div><span className="text-muted-foreground">action</span><div className="font-mono">{detail.action}</div></div>
                <div><span className="text-muted-foreground">scope</span><div className="font-mono">{detail.scope} · {detail.tenant_slug ?? "(platform)"}</div></div>
                <div className="col-span-2"><span className="text-muted-foreground">resource</span><div className="font-mono">{detail.resource_type} · {detail.resource_id}</div></div>
                <div className="col-span-2"><span className="text-muted-foreground">user_agent</span><div className="font-mono break-all">{detail.user_agent ?? "—"}</div></div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-muted-foreground">context</span>
                  <Button variant="ghost" size="sm" onClick={() => copy(JSON.stringify(detail.context, null, 2))}>
                    <Copy className="h-3.5 w-3.5 mr-1" /> Copy JSON
                  </Button>
                </div>
                <pre className="rounded border bg-muted/40 p-2 overflow-auto max-h-80 text-[11px]">
                  {JSON.stringify(detail.context, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
