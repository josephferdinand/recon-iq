import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getPolicyAudit } from "@/lib/platform-gaps.functions";
import { ShieldAlert, KeyRound, Database, Clock, HardDrive } from "lucide-react";
import { Link } from "@tanstack/react-router";

function TenantLink({ slug, name }: { slug: string | null; name: string }) {
  if (!slug) return <span>{name}</span>;
  return (
    <Link
      to="/$slug/tenant"
      params={{ slug }}
      className="text-primary hover:underline"
    >
      {name}
    </Link>
  );
}

export function PlatformPolicyAuditorTab() {
  const fn = useServerFn(getPolicyAudit);
  const q = useQuery({
    queryKey: ["platform-policy-audit"],
    queryFn: () => fn({}),
  });
  const d = q.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4" />
        <h2 className="text-lg font-semibold">Policy auditor</h2>
        <span className="text-sm text-muted-foreground">Cross-tenant compliance findings.</span>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="h-4 w-4" />Overdue BYOK rotation
            <Badge variant="outline">{d?.overdue_byok_rotation.length ?? 0}</Badge>
          </CardTitle>
          <CardDescription>Keys past the 90-day rotation policy.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr><th className="px-3 py-2">Tenant</th><th className="px-3 py-2">Days overdue</th></tr>
            </thead>
            <tbody>
              {(d?.overdue_byok_rotation ?? []).length === 0 && (
                <tr><td colSpan={2} className="px-3 py-4 text-center text-muted-foreground text-xs">Clean.</td></tr>
              )}
              {(d?.overdue_byok_rotation ?? []).map((r: any, i: number) => (
                <tr key={i} className="border-b">
                  <td className="px-3 py-2"><TenantLink slug={r.tenant_slug} name={r.tenant_name} /></td>
                  <td className="px-3 py-2"><Badge variant="destructive">{r.days_overdue}d</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="h-4 w-4" />Retention below floor
            <Badge variant="outline">{d?.below_floor_retention.length ?? 0}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr><th className="px-3 py-2">Tenant</th><th className="px-3 py-2">Table</th><th className="px-3 py-2">Configured</th><th className="px-3 py-2">Floor</th></tr>
            </thead>
            <tbody>
              {(d?.below_floor_retention ?? []).length === 0 && (
                <tr><td colSpan={4} className="px-3 py-4 text-center text-muted-foreground text-xs">Clean.</td></tr>
              )}
              {(d?.below_floor_retention ?? []).map((r: any, i: number) => (
                <tr key={i} className="border-b">
                  <td className="px-3 py-2"><TenantLink slug={r.tenant_slug} name={r.tenant_name} /></td>
                  <td className="px-3 py-2 font-mono text-xs">{r.table_name}</td>
                  <td className="px-3 py-2 text-xs">{r.configured_days}d</td>
                  <td className="px-3 py-2 text-xs text-rose-600">{r.floor_days}d</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />Expiring step-up grants
            <Badge variant="outline">{d?.expiring_step_up_grants.length ?? 0}</Badge>
          </CardTitle>
          <CardDescription>Grants expiring in &lt; 24h.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr><th className="px-3 py-2">User</th><th className="px-3 py-2">Tenant</th><th className="px-3 py-2">Expires</th></tr>
            </thead>
            <tbody>
              {(d?.expiring_step_up_grants ?? []).length === 0 && (
                <tr><td colSpan={3} className="px-3 py-4 text-center text-muted-foreground text-xs">Clean.</td></tr>
              )}
              {(d?.expiring_step_up_grants ?? []).map((r: any, i: number) => (
                <tr key={i} className="border-b">
                  <td className="px-3 py-2 font-mono text-xs">{r.user_id.slice(0, 8)}</td>
                  <td className="px-3 py-2"><TenantLink slug={r.tenant_slug} name={r.tenant_name} /></td>
                  <td className="px-3 py-2 text-xs">{new Date(r.expires_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <HardDrive className="h-4 w-4" />Missing backups (24h)
            <Badge variant="outline">{d?.missing_backups_24h.length ?? 0}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr><th className="px-3 py-2">Tenant</th><th className="px-3 py-2">Last backup</th></tr>
            </thead>
            <tbody>
              {(d?.missing_backups_24h ?? []).length === 0 && (
                <tr><td colSpan={2} className="px-3 py-4 text-center text-muted-foreground text-xs">All tenants anchored in last 24h.</td></tr>
              )}
              {(d?.missing_backups_24h ?? []).map((r: any, i: number) => (
                <tr key={i} className="border-b">
                  <td className="px-3 py-2"><TenantLink slug={r.tenant_slug} name={r.tenant_name} /></td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{r.last_backup_at ?? "never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
