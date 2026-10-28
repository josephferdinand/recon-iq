import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Layers } from "lucide-react";
import { listAllTenants } from "@/lib/tenants.functions";
import { WorkspaceVisibilityTab } from "@/components/workspace-visibility-tab";
import { FeatureFlagsTab } from "@/components/feature-flags-tab";
import { EntitlementsMatrix } from "@/components/entitlements-matrix";
import { EntitlementsTab } from "@/components/entitlements-tab";
import { TenantConfigAuditTab } from "@/components/tenant-config-audit-tab";
import { EntitlementsAdmin } from "@/components/entitlements-admin";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export function PlatformModulesTab() {
  const fetchTenants = useServerFn(listAllTenants);
  const q = useQuery({ queryKey: ["platform-all-tenants"], queryFn: () => fetchTenants() });
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const tenants = (q.data ?? []) as Array<{ id: string; name: string; slug: string; environment: string }>;
  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return tenants;
    return tenants.filter((t) => t.name.toLowerCase().includes(f) || t.slug.toLowerCase().includes(f));
  }, [tenants, filter]);
  const selected = tenants.find((t) => t.id === tenantId) ?? null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4" /> Modules & Features
          </CardTitle>
          <CardDescription>
            One place to govern every tenant's workspace surface — the entitlements matrix locks
            or unlocks features across all tenants at once, the per-tenant entitlements table drills
            into a single tenant with plan-tier controls, and per-tenant controls manage workspace
            pages, feature flags and the audit trail. Platform-admin only.
          </CardDescription>
        </CardHeader>
      </Card>

      <Tabs defaultValue="framework">
        <TabsList>
          <TabsTrigger value="framework">Entitlements framework</TabsTrigger>
          <TabsTrigger value="matrix">Legacy matrix</TabsTrigger>
          <TabsTrigger value="entitlements">Per-tenant entitlements</TabsTrigger>
          <TabsTrigger value="per-tenant">Per-tenant controls</TabsTrigger>
        </TabsList>

        <TabsContent value="framework" className="mt-4 space-y-4">
          <Card>
            <CardContent className="flex flex-wrap items-end gap-3 pt-6">
              <div className="flex-1 min-w-[240px]">
                <div className="text-xs text-muted-foreground mb-1">Filter tenants</div>
                <Input placeholder="Search by name or slug…" value={filter} onChange={(e) => setFilter(e.target.value)} />
              </div>
              <div className="flex-1 min-w-[280px]">
                <div className="text-xs text-muted-foreground mb-1">Tenant</div>
                <Select value={tenantId ?? ""} onValueChange={(v) => setTenantId(v)}>
                  <SelectTrigger>
                    <SelectValue placeholder={q.isLoading ? "Loading tenants…" : "Select a tenant"} />
                  </SelectTrigger>
                  <SelectContent>
                    {filtered.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} <span className="text-muted-foreground">· /{t.slug} · {t.environment}</span>
                      </SelectItem>
                    ))}
                    {filtered.length === 0 && (
                      <div className="px-3 py-2 text-sm text-muted-foreground">No matches</div>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
          {selected ? (
            <EntitlementsAdmin mode="platform" tenantId={selected.id} tenantName={selected.name} />
          ) : (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                Select a tenant above to manage its entitlements.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="matrix" className="mt-4">
          <EntitlementsMatrix />
        </TabsContent>

        <TabsContent value="entitlements" className="mt-4">
          <EntitlementsTab />
        </TabsContent>

        <TabsContent value="per-tenant" className="mt-4 space-y-4">
          <Card>
            <CardContent className="flex flex-wrap items-end gap-3 pt-6">
              <div className="flex-1 min-w-[240px]">
                <div className="text-xs text-muted-foreground mb-1">Filter tenants</div>
                <Input placeholder="Search by name or slug…" value={filter} onChange={(e) => setFilter(e.target.value)} />
              </div>
              <div className="flex-1 min-w-[280px]">
                <div className="text-xs text-muted-foreground mb-1">Tenant</div>
                <Select value={tenantId ?? ""} onValueChange={(v) => setTenantId(v)}>
                  <SelectTrigger>
                    <SelectValue placeholder={q.isLoading ? "Loading tenants…" : "Select a tenant"} />
                  </SelectTrigger>
                  <SelectContent>
                    {filtered.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name} <span className="text-muted-foreground">· /{t.slug} · {t.environment}</span>
                      </SelectItem>
                    ))}
                    {filtered.length === 0 && (
                      <div className="px-3 py-2 text-sm text-muted-foreground">No matches</div>
                    )}
                  </SelectContent>
                </Select>
              </div>
              {selected && (
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{selected.slug}</Badge>
                  <Badge variant="outline" className="uppercase">{selected.environment}</Badge>
                </div>
              )}
            </CardContent>
          </Card>

          {!selected ? (
            <Card>
              <CardContent className="p-6 text-sm text-muted-foreground">
                Select a tenant above to manage its workspace pages and feature flags.
              </CardContent>
            </Card>
          ) : (
            <Tabs defaultValue="pages">
              <TabsList>
                <TabsTrigger value="pages">Workspace pages</TabsTrigger>
                <TabsTrigger value="flags">Feature flags</TabsTrigger>
                <TabsTrigger value="audit">Audit trail</TabsTrigger>
              </TabsList>
              <TabsContent value="pages" className="mt-4">
                <WorkspaceVisibilityTab tenantId={selected.id} canWrite={true} />
              </TabsContent>
              <TabsContent value="flags" className="mt-4">
                <FeatureFlagsTab tenantId={selected.id} canWrite={true} />
              </TabsContent>
              <TabsContent value="audit" className="mt-4">
                <TenantConfigAuditTab tenantId={selected.id} />
              </TabsContent>
            </Tabs>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
