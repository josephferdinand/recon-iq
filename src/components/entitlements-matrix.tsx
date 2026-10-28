import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Grid3x3, RefreshCw, CheckSquare, Square } from "lucide-react";
import { toast } from "sonner";
import { listEntitlementsMatrix, setEntitlement } from "@/lib/platform-ai.functions";

type Cell = { allowed: boolean; plan_required: string; locked_reason: string | null; overridden: boolean };
type TenantRow = { id: string; name: string; slug: string; environment: string; entitlements: Record<string, Cell> };
type Feature = { key: string; label: string; category: string; default: boolean };

export function EntitlementsMatrix() {
  const qc = useQueryClient();
  const fetchMatrix = useServerFn(listEntitlementsMatrix);
  const upd = useServerFn(setEntitlement);

  const q = useQuery({
    queryKey: ["entitlements-matrix"],
    queryFn: () => fetchMatrix(),
  });

  const [filter, setFilter] = useState("");
  const [category, setCategory] = useState<string>("");
  const [busyCell, setBusyCell] = useState<string | null>(null);

  const features: Feature[] = q.data?.features ?? [];
  const tenants: TenantRow[] = q.data?.tenants ?? [];

  const categories = useMemo(
    () => Array.from(new Set(features.map((f) => f.category))).sort(),
    [features],
  );
  const visibleFeatures = useMemo(
    () => (category ? features.filter((f) => f.category === category) : features),
    [features, category],
  );
  const visibleTenants = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return tenants;
    return tenants.filter((t) => t.name.toLowerCase().includes(f) || t.slug.toLowerCase().includes(f));
  }, [tenants, filter]);

  const mut = useMutation({
    mutationFn: async (v: { tenant_id: string; feature_key: string; allowed: boolean; plan_required: string }) => {
      setBusyCell(`${v.tenant_id}:${v.feature_key}`);
      return upd({ data: v });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["entitlements-matrix"] }),
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setBusyCell(null),
  });

  const bulkMut = useMutation({
    mutationFn: async (v: { tenant_id: string; allowed: boolean }) => {
      const results = await Promise.allSettled(
        visibleFeatures.map((f) => {
          const cell = tenants.find((t) => t.id === v.tenant_id)?.entitlements[f.key];
          return upd({
            data: {
              tenant_id: v.tenant_id,
              feature_key: f.key,
              allowed: v.allowed,
              plan_required: cell?.plan_required ?? "starter",
            },
          });
        }),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      return { failed, total: visibleFeatures.length, allowed: v.allowed };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["entitlements-matrix"] });
      if (r.failed) toast.error(`${r.failed}/${r.total} failed`);
      else toast.success(`${r.allowed ? "Enabled" : "Locked"} ${r.total} features`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Grid3x3 className="h-4 w-4" /> Entitlements matrix
          </CardTitle>
          <CardDescription>
            Rows are tenants, columns are workspace modules. A cell toggled off locks the feature
            for that tenant — even if the tenant admin has the flag enabled, it will not run.
            Missing cell = allowed by default. Platform-admin only.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <div className="text-xs text-muted-foreground mb-1">Filter tenants</div>
            <Input placeholder="Search name or slug…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <div className="min-w-[180px]">
            <div className="text-xs text-muted-foreground mb-1">Category</div>
            <select
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{visibleTenants.length} tenants</Badge>
            <Badge variant="outline">{visibleFeatures.length} features</Badge>
            <Button size="sm" variant="outline"
              onClick={() => qc.invalidateQueries({ queryKey: ["entitlements-matrix"] })}
              disabled={q.isFetching}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${q.isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {q.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading matrix…</div>
          ) : q.isError ? (
            <div className="p-6 text-sm text-destructive">
              {(q.error as Error)?.message ?? "Failed to load"}
            </div>
          ) : visibleTenants.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No tenants match.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-separate border-spacing-0">
                <thead className="bg-muted/50 text-xs text-muted-foreground sticky top-0 z-10">
                  <tr>
                    <th className="sticky left-0 z-20 bg-muted/50 px-3 py-2 text-left font-medium min-w-[220px]">
                      Tenant
                    </th>
                    <th className="px-3 py-2 text-left font-medium">Actions</th>
                    {visibleFeatures.map((f) => (
                      <th key={f.key} className="px-3 py-2 text-left font-medium whitespace-nowrap">
                        <div className="font-medium text-foreground">{f.label}</div>
                        <div className="text-[10px] font-mono">{f.key}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleTenants.map((t) => {
                    const cells = visibleFeatures.map((f) => t.entitlements[f.key]);
                    const allowedCount = cells.filter((c) => c?.allowed).length;
                    const allAllowed = allowedCount === visibleFeatures.length;
                    const allLocked = allowedCount === 0;
                    return (
                      <tr key={t.id} className="border-t hover:bg-muted/20">
                        <td className="sticky left-0 z-10 bg-background px-3 py-2 border-r">
                          <div className="font-medium truncate">{t.name}</div>
                          <div className="text-[10px] text-muted-foreground font-mono">
                            /{t.slug} · {t.environment}
                          </div>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={allAllowed || bulkMut.isPending}
                              title="Allow all visible"
                              onClick={() => bulkMut.mutate({ tenant_id: t.id, allowed: true })}
                            >
                              <CheckSquare className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={allLocked || bulkMut.isPending}
                              title="Lock all visible"
                              onClick={() => bulkMut.mutate({ tenant_id: t.id, allowed: false })}
                            >
                              <Square className="h-3.5 w-3.5" />
                            </Button>
                            <span className="text-[10px] text-muted-foreground">
                              {allowedCount}/{visibleFeatures.length}
                            </span>
                          </div>
                        </td>
                        {visibleFeatures.map((f) => {
                          const cell = t.entitlements[f.key];
                          const busy = busyCell === `${t.id}:${f.key}`;
                          return (
                            <td key={f.key} className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <Switch
                                  checked={!!cell?.allowed}
                                  disabled={busy || mut.isPending}
                                  onCheckedChange={(v) =>
                                    mut.mutate({
                                      tenant_id: t.id,
                                      feature_key: f.key,
                                      allowed: v,
                                      plan_required: cell?.plan_required ?? "starter",
                                    })
                                  }
                                  aria-label={`${cell?.allowed ? "Lock" : "Allow"} ${f.label} for ${t.name}`}
                                />
                                {cell?.overridden ? (
                                  <Badge variant="outline" className="text-[9px] px-1">
                                    override
                                  </Badge>
                                ) : null}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
