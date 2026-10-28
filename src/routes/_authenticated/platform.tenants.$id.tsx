import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ArrowLeft, ShieldAlert, Users, Flag, Network, Database, Clock, KeyRound } from "lucide-react";
import { getTenantDetail } from "@/lib/platform-consoles.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TenantEmailDomainPanel } from "@/components/tenant-email-domain-panel";

export const Route = createFileRoute("/_authenticated/platform/tenants/$id")({
  head: () => ({
    meta: [
      { title: "Tenant detail — Platform" },
      { name: "description", content: "Platform admin dossier for a single tenant: members, features, IP allowlist, connectors, break-glass, audit." },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: async ({ params, context }) => {
    await context.queryClient.ensureQueryData({
      queryKey: ["platform-tenant-detail", params.id],
      queryFn: () => getTenantDetail({ data: { tenant_id: params.id } }),
    });
  },
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">Failed to load tenant: {error instanceof Error ? error.message : "An unexpected error occurred."}</p>
        <Button onClick={() => { reset(); router.invalidate(); }} className="mt-3">Retry</Button>
      </div>
    );
  },
  notFoundComponent: () => <div className="p-6 text-sm">Tenant not found.</div>,
  component: TenantDetailPage,
});

function TenantDetailPage() {
  const { id } = Route.useParams();
  const { data } = useSuspenseQuery({
    queryKey: ["platform-tenant-detail", id],
    queryFn: () => getTenantDetail({ data: { tenant_id: id } }),
  });
  const t = data.tenant as any;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Link to="/platform" className="hover:text-foreground">
          <ArrowLeft className="mr-1 inline h-3.5 w-3.5" /> Platform
        </Link>
        <span>/</span>
        <span>Tenants</span>
        <span>/</span>
        <span className="text-foreground">{t.name}</span>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">{t.name}</h1>
          <p className="text-sm text-muted-foreground">
            <code>/{t.slug}</code> · Family: {t.family?.name ?? "—"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="uppercase">{t.environment}</Badge>
          {t.ai_enabled ? <Badge>AI on</Badge> : <Badge variant="outline">AI off</Badge>}
          {t.custom_domain ? <Badge variant="secondary">{t.custom_domain}</Badge> : null}
          <Button asChild variant="outline" size="sm">
            <Link to="/$slug/workspace" params={{ slug: t.slug }}>Open workspace</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/$slug/tenant" params={{ slug: t.slug }}>Tenant admin</Link>
          </Button>
        </div>
      </header>

      <TenantEmailDomainPanel tenantId={id} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <SummaryCard icon={<Users className="h-4 w-4" />} label="Members" value={data.members.length} hint="Includes platform-seeded" />
        <SummaryCard icon={<Flag className="h-4 w-4" />} label="Feature flags" value={(data.feature_flags as any[]).filter((f) => f.enabled).length} hint={`of ${data.feature_flags.length} configured`} />
        <SummaryCard icon={<Network className="h-4 w-4" />} label="IP allowlist" value={data.ip_allowlist.length} hint={data.ip_allowlist.length === 0 ? "Open — no restriction" : "CIDRs allowed"} />
        <SummaryCard icon={<Database className="h-4 w-4" />} label="ERP connectors" value={data.connectors.length} />
        <SummaryCard icon={<ShieldAlert className="h-4 w-4" />} label="Break-glass grants" value={data.break_glass.length} hint="Last 10" />
        <SummaryCard icon={<Clock className="h-4 w-4" />} label="Retention rules" value={data.retention.length} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Members</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">User</th>
                <th className="px-4 py-2">Role</th>
                <th className="px-4 py-2">Source</th>
                <th className="px-4 py-2">Joined</th>
              </tr>
            </thead>
            <tbody>
              {(data.members as any[]).map((m) => (
                <tr key={m.user_id} className="border-b">
                  <td className="px-4 py-2">
                    <div className="font-medium">{m.profile?.email ?? m.user_id.slice(0, 8)}</div>
                    {m.profile?.full_name ? <div className="text-xs text-muted-foreground">{m.profile.full_name}</div> : null}
                  </td>
                  <td className="px-4 py-2"><Badge variant="outline">{m.role}</Badge></td>
                  <td className="px-4 py-2">
                    {m.added_by_platform ? <Badge variant="secondary" className="text-[10px]">platform-seeded</Badge> : <Badge variant="outline" className="text-[10px]">direct</Badge>}
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{m.created_at ? new Date(m.created_at).toLocaleDateString() : "—"}</td>
                </tr>
              ))}
              {data.members.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">No members.</td></tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Recent audit</CardTitle><CardDescription>Last 25 events for this tenant.</CardDescription></CardHeader>
          <CardContent className="max-h-96 overflow-y-auto p-0">
            <table className="w-full text-xs">
              <thead className="border-b bg-muted/40 text-left uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Actor</th>
                  <th className="px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {(data.audit as any[]).map((a) => (
                  <tr key={a.id} className="border-b">
                    <td className="px-3 py-1.5 text-muted-foreground">{new Date(a.occurred_at).toLocaleString()}</td>
                    <td className="px-3 py-1.5">{a.actor_email ?? "system"}</td>
                    <td className="px-3 py-1.5 font-mono">{a.action}</td>
                  </tr>
                ))}
                {data.audit.length === 0 ? (
                  <tr><td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">No audit rows.</td></tr>
                ) : null}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><KeyRound className="h-4 w-4" /> Break-glass grants</CardTitle></CardHeader>
          <CardContent className="p-0">
            {data.break_glass.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">No break-glass activity.</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="border-b bg-muted/40 text-left uppercase text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Scope</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Requested</th>
                    <th className="px-3 py-2">Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.break_glass as any[]).map((g) => (
                    <tr key={g.id} className="border-b">
                      <td className="px-3 py-1.5 font-mono">{g.scope}</td>
                      <td className="px-3 py-1.5"><Badge variant={g.status === "active" ? "default" : "outline"}>{g.status}</Badge></td>
                      <td className="px-3 py-1.5 text-muted-foreground">{g.requested_at ? new Date(g.requested_at).toLocaleString() : "—"}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{g.expires_at ? new Date(g.expires_at).toLocaleString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-base">Feature flags</CardTitle></CardHeader>
          <CardContent className="max-h-72 space-y-1 overflow-y-auto text-sm">
            {(data.feature_flags as any[]).map((f) => (
              <div key={f.feature_key} className="flex items-center justify-between">
                <code className="text-xs">{f.feature_key}</code>
                {f.enabled ? <Badge>on</Badge> : <Badge variant="outline">off</Badge>}
              </div>
            ))}
            {data.feature_flags.length === 0 ? <p className="text-muted-foreground">No flags configured.</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">IP allowlist</CardTitle></CardHeader>
          <CardContent className="max-h-72 space-y-1 overflow-y-auto text-sm">
            {(data.ip_allowlist as any[]).map((r, i) => (
              <div key={i}>
                <code className="text-xs">{r.cidr}</code>
                {r.description ? <span className="text-muted-foreground text-xs"> — {r.description}</span> : null}
              </div>
            ))}
            {data.ip_allowlist.length === 0 ? <p className="text-muted-foreground">No restrictions.</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">ERP connectors</CardTitle></CardHeader>
          <CardContent className="max-h-72 space-y-1 overflow-y-auto text-sm">
            {(data.connectors as any[]).map((c) => (
              <div key={c.id} className="flex items-center justify-between">
                <span>{c.name} <span className="text-xs text-muted-foreground">({c.kind})</span></span>
                <Badge variant="outline">{c.status}</Badge>
              </div>
            ))}
            {data.connectors.length === 0 ? <p className="text-muted-foreground">No connectors.</p> : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SummaryCard({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: number | string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs uppercase text-muted-foreground">{icon}{label}</div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
        {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}
