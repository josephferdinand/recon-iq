import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { History, RefreshCw } from "lucide-react";
import { listTenantConfigAudit } from "@/lib/config-audit.functions";

type Row = {
  id: string;
  occurred_at: string;
  actor_user_id: string | null;
  actor_email: string | null;
  action: string;
  category: "modules" | "security" | "other";
  resource_type: string | null;
  resource_id: string | null;
  context: Record<string, any>;
};

const ACTION_LABEL: Record<string, string> = {
  "entitlement.update": "Entitlement changed",
  "feature_flag.update": "Feature flag toggled",
  "workspace_page.visibility": "Workspace page visibility",
  "security.settings.update": "Security settings updated",
  "security.passkey_policy.update": "Passkey policy updated",
  "security.ip_allowlist.add": "IP allowlist entry added",
  "security.ip_allowlist.remove": "IP allowlist entry removed",
  "sso.write": "SSO configuration change",
  "retention.update": "Retention policy updated",
};

function summarize(action: string, ctx: Record<string, any>): string {
  const c = ctx as any;
  switch (action) {
    case "entitlement.update":
      return `${c.feature ?? ""} → ${c.allowed ? "allowed" : "locked"}`;
    case "feature_flag.update":
      return `${c.feature ?? ""} → ${c.enabled ? "enabled" : "disabled"}`;
    case "workspace_page.visibility":
      return `${c.page_key ?? ""} → ${c.enabled ? "visible" : "hidden"}`;
    case "security.ip_allowlist.add":
    case "security.ip_allowlist.remove":
      return String(c.cidr ?? c.ip ?? "");
    case "retention.update":
      return `${c.run_retention_days ?? "?"} days`;
    default:
      try {
        const keys = Object.keys(c);
        if (keys.length === 0) return "";
        return keys.slice(0, 3).map((k) => `${k}=${JSON.stringify(c[k])}`).join(", ");
      } catch {
        return "";
      }
  }
}

export function TenantConfigAuditTab({ tenantId }: { tenantId: string }) {
  const fetchRows = useServerFn(listTenantConfigAudit);
  const [category, setCategory] = useState<"all" | "modules" | "security">("all");
  const [filter, setFilter] = useState("");

  const q = useQuery({
    queryKey: ["tenant-config-audit", tenantId, category],
    queryFn: () => fetchRows({ data: { tenant_id: tenantId, category, limit: 200 } }),
  });

  const rows: Row[] = (q.data ?? []) as Row[];
  const filtered = useMemo<Row[]>(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return rows;
    return rows.filter((r) =>
      (r.actor_email ?? "").toLowerCase().includes(f) ||
      r.action.toLowerCase().includes(f) ||
      JSON.stringify(r.context).toLowerCase().includes(f)
    );
  }, [rows, filter]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-4 w-4" /> Configuration audit trail
        </CardTitle>
        <CardDescription>
          Chronological record of module, entitlement, and security-policy changes for this tenant.
          Rows are hash-chained in <code>audit_log</code> and cannot be edited.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-56">
            <div className="text-xs text-muted-foreground mb-1">Category</div>
            <Select value={category} onValueChange={(v) => setCategory(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All changes</SelectItem>
                <SelectItem value="modules">Modules & entitlements</SelectItem>
                <SelectItem value="security">Security policies</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[220px]">
            <div className="text-xs text-muted-foreground mb-1">Search</div>
            <Input placeholder="Filter by actor, action, or detail…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${q.isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[180px]">When</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Detail</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.isLoading && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Loading…</TableCell></TableRow>
              )}
              {!q.isLoading && filtered.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No audit entries for this filter.</TableCell></TableRow>
              )}
              {filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{new Date(r.occurred_at).toLocaleString()}</TableCell>
                  <TableCell className="text-sm">{r.actor_email ?? <span className="text-muted-foreground">system</span>}</TableCell>
                  <TableCell>
                    <Badge variant={r.category === "security" ? "destructive" : r.category === "modules" ? "secondary" : "outline"} className="capitalize">
                      {r.category}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{ACTION_LABEL[r.action] ?? r.action}</TableCell>
                  <TableCell className="text-sm text-muted-foreground truncate max-w-[360px]" title={JSON.stringify(r.context)}>
                    {summarize(r.action, r.context)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
