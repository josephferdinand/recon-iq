import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listResidencyDenials, exportResidencyDenials, listRlsDenials } from "@/lib/agent-review.functions";
import { listAllTenants } from "@/lib/tenants.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShieldAlert, Globe, Download, FileText, Lock } from "lucide-react";
import { exportCsv, exportPdf, type ExportColumn } from "@/lib/export-utils";


export function ResidencyDashboard() {
  const list = useServerFn(listResidencyDenials);
  const exportFn = useServerFn(exportResidencyDenials);
  const tenants = useServerFn(listAllTenants);

  const [tenantId, setTenantId] = useState<string>("all");
  const [model, setModel] = useState<string>("");
  const [hours, setHours] = useState<number>(24 * 7);

  const tenantsQ = useQuery({ queryKey: ["all-tenants"], queryFn: () => tenants({ data: {} as any }) });
  const eventsQ = useQuery({
    queryKey: ["residency-denials", tenantId, model, hours],
    queryFn: () => list({ data: {
      tenant_id: tenantId !== "all" ? tenantId : undefined,
      model: model || undefined,
      since_hours: hours, limit: 200,
    } }),
    refetchInterval: 15_000,
  });

  const rows = (eventsQ.data ?? []) as any[];
  const tList = (tenantsQ.data ?? []) as any[];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4 text-destructive" /> Residency enforcement denials
          <Badge variant="secondary">{rows.length}</Badge>
        </CardTitle>
        <CardDescription>
          Every AI Gateway call that violated a tenant's data-residency pin is blocked and logged as <code>security_events.event_type = residency_violation</code>
          with severity <strong>critical</strong>. Use this dashboard to spot misconfigured providers, wrong models, or unauthorized SDK paths.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Select value={tenantId} onValueChange={setTenantId}>
            <SelectTrigger className="w-56"><SelectValue placeholder="e.g. Demo Bank NA" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tenants</SelectItem>
              {tList.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input className="w-56" placeholder="e.g. gemini-3 — used by ReconIQ AIDP" value={model} onChange={(e) => setModel(e.target.value)} />
          <Select value={String(hours)} onValueChange={(v) => setHours(Number(v))}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="24">Last 24 hours</SelectItem>
              <SelectItem value="168">Last 7 days</SelectItem>
              <SelectItem value="720">Last 30 days</SelectItem>
              <SelectItem value="2160">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={rows.length === 0}
              onClick={async () => {
                try {
                  const data = await exportFn({ data: {
                    tenant_id: tenantId !== "all" ? tenantId : undefined,
                    model: model || undefined, since_hours: hours, limit: 5000, format: "csv",
                  }});
                  const cols: ExportColumn<any>[] = [
                    { key: "occurred_at", header: "When", value: (r) => new Date(r.occurred_at).toISOString() },
                    { key: "tenant", header: "Tenant", value: (r) => r.tenant?.name ?? r.tenant_id ?? "" },
                    { key: "surface", header: "Surface", value: (r) => r.details?.surface ?? "" },
                    { key: "model", header: "Model", value: (r) => r.details?.model ?? "" },
                    { key: "reason", header: "Reason", value: (r) => r.details?.reason ?? "" },
                    { key: "severity", header: "Severity" },
                  ];
                  exportCsv(`residency-denials-${Date.now()}.csv`, cols, data as any[]);
                } catch (e: any) { alert(e?.message ?? "Export forbidden"); }
              }}
            >
              <Download className="mr-1 h-3 w-3" /> CSV
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={rows.length === 0}
              onClick={async () => {
                try {
                  const data = await exportFn({ data: {
                    tenant_id: tenantId !== "all" ? tenantId : undefined,
                    model: model || undefined, since_hours: hours, limit: 5000, format: "pdf",
                  }});
                  const cols: ExportColumn<any>[] = [
                    { key: "occurred_at", header: "When", value: (r) => new Date(r.occurred_at).toLocaleString() },
                    { key: "tenant", header: "Tenant", value: (r) => r.tenant?.name ?? r.tenant_id ?? "" },
                    { key: "surface", header: "Surface", value: (r) => r.details?.surface ?? "" },
                    { key: "model", header: "Model", value: (r) => r.details?.model ?? "" },
                    { key: "reason", header: "Reason", value: (r) => r.details?.reason ?? "" },
                  ];
                  const subtitle =
                    `Tenant: ${tenantId === "all" ? "All" : (tList.find((t) => t.id === tenantId)?.name ?? tenantId)} · ` +
                    `Window: last ${hours}h${model ? ` · Model filter: ${model}` : ""}`;
                  exportPdf(`residency-denials-${Date.now()}.pdf`, "Residency enforcement denials", subtitle, cols, data as any[]);
                } catch (e: any) { alert(e?.message ?? "Export forbidden"); }
              }}
            >
              <FileText className="mr-1 h-3 w-3" /> PDF
            </Button>
          </div>
        </div>



        <div className="overflow-hidden rounded border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">Tenant</th>
                <th className="px-4 py-2">Surface</th>
                <th className="px-4 py-2">Model</th>
                <th className="px-4 py-2">Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b hover:bg-muted/10">
                  <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(r.occurred_at).toLocaleString()}</td>
                  <td className="px-4 py-2 text-xs">{r.tenant?.name ?? r.tenant_id?.slice(0, 8) ?? "—"}</td>
                  <td className="px-4 py-2 text-xs"><Badge variant="outline">{r.details?.surface ?? "—"}</Badge></td>
                  <td className="px-4 py-2 font-mono text-xs">{r.details?.model ?? "—"}</td>
                  <td className="px-4 py-2 text-xs text-rose-700"><Globe className="mr-1 inline h-3 w-3" />{r.details?.reason ?? "—"}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-sm text-emerald-700">
                  No residency violations in the selected window — your gateway enforcement is holding.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
      <RlsDenialsPanel tenantId={tenantId} hours={hours} tList={tList} />
    </Card>
  );
}

function RlsDenialsPanel({ tenantId, hours, tList }: { tenantId: string; hours: number; tList: any[] }) {
  const list = useServerFn(listRlsDenials);
  const [resource, setResource] = useState("");
  const q = useQuery({
    queryKey: ["rls-denials", tenantId, hours, resource],
    queryFn: () => list({ data: {
      tenant_id: tenantId !== "all" ? tenantId : undefined,
      since_hours: hours, resource: resource || undefined, limit: 200,
    } }),
    refetchInterval: 30_000,
  });
  const rows = (q.data ?? []) as any[];

  return (
    <CardContent className="space-y-3 border-t pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Lock className="h-4 w-4 text-amber-600" />
          Row-level security denials
          <Badge variant="secondary">{rows.length}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Server functions that hit a DB <code>permission denied</code> (RLS) log to
          <code className="ml-1">security_events.event_type = rls_denied</code>.
        </p>
        <Input
          className="ml-auto w-56"
          placeholder="e.g. falcon_nostro_usd_recon"
          value={resource}
          onChange={(e) => setResource(e.target.value)}
        />
      </div>
      <div className="overflow-hidden rounded border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-2">When</th>
              <th className="px-4 py-2">Tenant</th>
              <th className="px-4 py-2">User</th>
              <th className="px-4 py-2">Resource</th>
              <th className="px-4 py-2">PG code</th>
              <th className="px-4 py-2">Message</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b hover:bg-muted/10">
                <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(r.occurred_at).toLocaleString()}</td>
                <td className="px-4 py-2 text-xs">{r.tenant?.name ?? r.tenant_id?.slice(0, 8) ?? "—"}</td>
                <td className="px-4 py-2 font-mono text-xs">{r.user_id?.slice(0, 8) ?? "—"}</td>
                <td className="px-4 py-2 text-xs"><Badge variant="outline">{r.context?.resource ?? "—"}</Badge></td>
                <td className="px-4 py-2 font-mono text-xs">{r.context?.pg_code ?? "—"}</td>
                <td className="px-4 py-2 text-xs text-amber-700 truncate max-w-md" title={r.context?.message ?? ""}>
                  {r.context?.message ?? "—"}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-emerald-700">
                No RLS denials in the selected window — your role-based grants are matching expectations.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </CardContent>
  );
}
