import React, { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronRight, Layers, Search, Shield, Users, Box, User, History } from "lucide-react";
import { toast } from "sonner";
import {
  listEntitlementCatalog,
  listPlatformGrants,
  setPlatformGrant,
  bulkSetPlatformGrants,
  listScopeGrants,
  setScopeGrant,
  listEntitlementAudit,
  listTenantScopeTargets,
  type CatalogEntry,
} from "@/lib/entitlements.functions";

/** Build tree from flat catalog rows */
function buildTree(rows: CatalogEntry[]) {
  const byParent = new Map<string | null, CatalogEntry[]>();
  for (const r of rows) {
    const k = r.parent_key ?? null;
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k)!.push(r);
  }
  return byParent;
}

type Mode = "platform" | "tenant";

type EntitlementsAdminProps = {
  mode: Mode;
  tenantId: string;
  tenantName?: string;
};

type ScopeSel =
  | { type: "tenant"; id: null }
  | { type: "workspace"; id: string }
  | { type: "group"; id: string }
  | { type: "user"; id: string };

export function EntitlementsAdmin({ mode, tenantId, tenantName }: EntitlementsAdminProps) {
  const qc = useQueryClient();
  const fetchCatalog = useServerFn(listEntitlementCatalog);
  const fetchPlatform = useServerFn(listPlatformGrants);
  const fetchScope = useServerFn(listScopeGrants);
  const fetchAudit = useServerFn(listEntitlementAudit);
  const fetchTargets = useServerFn(listTenantScopeTargets);
  const mSetPlatform = useServerFn(setPlatformGrant);
  const mBulkPlatform = useServerFn(bulkSetPlatformGrants);
  const mSetScope = useServerFn(setScopeGrant);

  const catalog = useQuery({ queryKey: ["ent-catalog"], queryFn: () => fetchCatalog() });
  const platform = useQuery({
    queryKey: ["ent-platform", tenantId],
    queryFn: () => fetchPlatform({ data: { tenantId } }),
    enabled: !!tenantId,
  });
  const targets = useQuery({
    queryKey: ["ent-targets", tenantId],
    queryFn: () => fetchTargets({ data: { tenantId } }),
    enabled: !!tenantId && mode === "tenant",
  });

  const [filter, setFilter] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [scope, setScope] = useState<ScopeSel>({ type: "tenant", id: null });

  const scopeGrants = useQuery({
    queryKey: ["ent-scope", tenantId, scope.type, scope.id],
    queryFn: () =>
      fetchScope({
        data: { tenantId, scopeType: scope.type, scopeId: scope.id ?? undefined },
      }),
    enabled: !!tenantId && mode === "tenant",
  });

  const audit = useQuery({
    queryKey: ["ent-audit", tenantId],
    queryFn: () => fetchAudit({ data: { tenantId, limit: 100 } }),
    enabled: !!tenantId,
  });

  const rows = catalog.data ?? [];
  const platformMap = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const g of platform.data ?? []) m.set(g.feature_key, g.allowed);
    return m;
  }, [platform.data]);

  const scopeMap = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const g of scopeGrants.data ?? []) m.set(g.catalog_key, g.enabled);
    return m;
  }, [scopeGrants.data]);

  const categories = useMemo(() => Array.from(new Set(rows.map((r) => r.category))).sort(), [rows]);
  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return rows.filter((r) => {
      if (category !== "all" && r.category !== category) return false;
      if (!f) return true;
      return (
        r.key.toLowerCase().includes(f) ||
        r.name.toLowerCase().includes(f) ||
        (r.description ?? "").toLowerCase().includes(f)
      );
    });
  }, [rows, filter, category]);
  const tree = useMemo(() => buildTree(filtered), [filtered]);

  const isPlatformAllowed = (key: string, defaultEnabled: boolean) =>
    platformMap.has(key) ? platformMap.get(key)! : defaultEnabled;

  const onTogglePlatform = async (key: string, next: boolean) => {
    try {
      await mSetPlatform({ data: { tenantId, catalogKey: key, allowed: next } });
      toast.success(`${next ? "Enabled" : "Disabled"} ${key} at platform`);
      qc.invalidateQueries({ queryKey: ["ent-platform", tenantId] });
      qc.invalidateQueries({ queryKey: ["ent-audit", tenantId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const onToggleScope = async (key: string, next: boolean) => {
    try {
      await mSetScope({
        data: {
          tenantId,
          catalogKey: key,
          scopeType: scope.type,
          scopeId: scope.id,
          enabled: next,
        },
      });
      toast.success(`${next ? "Enabled" : "Disabled"} ${key} for ${scope.type}`);
      qc.invalidateQueries({ queryKey: ["ent-scope", tenantId, scope.type, scope.id] });
      qc.invalidateQueries({ queryKey: ["ent-audit", tenantId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  const bulk = useMutation({
    mutationFn: async ({ keys, allowed }: { keys: string[]; allowed: boolean }) => {
      if (mode === "platform") {
        await mBulkPlatform({ data: { tenantId, catalogKeys: keys, allowed } });
      } else {
        // Sequential scope toggles
        for (const k of keys) {
          await mSetScope({
            data: { tenantId, catalogKey: k, scopeType: scope.type, scopeId: scope.id, enabled: allowed },
          });
        }
      }
    },
    onSuccess: (_, v) => {
      toast.success(`${v.allowed ? "Enabled" : "Disabled"} ${v.keys.length} entries`);
      qc.invalidateQueries({ queryKey: ["ent-platform", tenantId] });
      qc.invalidateQueries({ queryKey: ["ent-scope", tenantId, scope.type, scope.id] });
      qc.invalidateQueries({ queryKey: ["ent-audit", tenantId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Bulk toggle failed"),
  });

  const renderNode = (node: CatalogEntry, depth = 0): React.ReactElement => {
    const children = tree.get(node.key) ?? [];
    const platAllowed = isPlatformAllowed(node.key, node.default_enabled);
    const scopeVal = scopeMap.has(node.key) ? scopeMap.get(node.key)! : true;
    const effective = mode === "platform" ? platAllowed : platAllowed && scopeVal;

    return (
      <div key={node.key}>
        <div
          className={`flex items-center gap-3 rounded-md border px-3 py-2 my-1 ${
            effective ? "bg-background" : "bg-muted/40 opacity-70"
          }`}
          style={{ marginLeft: depth * 20 }}
        >
          <ChevronRight className={`h-3 w-3 shrink-0 ${children.length ? "opacity-100" : "opacity-0"}`} />
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-sm truncate">{node.name}</span>
              <Badge variant="outline" className="text-xs uppercase">
                {node.entry_type}
              </Badge>
              <Badge variant="secondary" className="text-xs">
                {node.category}
              </Badge>
              {node.default_enabled && (
                <Badge variant="outline" className="text-xs">
                  default on
                </Badge>
              )}
              {mode === "tenant" && !platAllowed && (
                <Badge variant="destructive" className="text-xs">
                  blocked by platform
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground font-mono mt-0.5">{node.key}</div>
            {node.description && <div className="text-xs text-muted-foreground mt-0.5">{node.description}</div>}
            {node.requires.length > 0 && (
              <div className="text-xs text-muted-foreground mt-0.5">
                requires: <span className="font-mono">{node.requires.join(", ")}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {mode === "platform" ? (
              <Switch
                checked={platAllowed}
                onCheckedChange={(v) => onTogglePlatform(node.key, v)}
                aria-label={`Platform toggle ${node.key}`}
              />
            ) : (
              <Switch
                checked={scopeVal}
                disabled={!platAllowed}
                onCheckedChange={(v) => onToggleScope(node.key, v)}
                aria-label={`Scope toggle ${node.key}`}
              />
            )}
          </div>
        </div>
        {children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  const roots = tree.get(null) ?? [];
  const allKeys = filtered.map((r) => r.key);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {mode === "platform" ? <Shield className="h-4 w-4" /> : <Layers className="h-4 w-4" />}
            {mode === "platform" ? "Platform Entitlements" : "Tenant Entitlements"}
            {tenantName && <span className="text-muted-foreground">· {tenantName}</span>}
          </CardTitle>
          <CardDescription>
            {mode === "platform"
              ? "Enable or disable every module, section, feature and capability for this tenant. Nothing is available unless explicitly granted here."
              : "Manage platform-approved features for this tenant. Scope grants to workspaces, groups, or individual users."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[240px]">
              <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <Search className="h-3 w-3" /> Search
              </div>
              <Input
                placeholder="Search by name, key or description…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            <div className="min-w-[180px]">
              <div className="text-xs text-muted-foreground mb-1">Category</div>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {mode === "tenant" && (
              <div className="min-w-[260px]">
                <div className="text-xs text-muted-foreground mb-1">Scope</div>
                <Select
                  value={`${scope.type}:${scope.id ?? ""}`}
                  onValueChange={(v) => {
                    const [t, id] = v.split(":");
                    if (t === "tenant") setScope({ type: "tenant", id: null });
                    else if (t === "workspace") setScope({ type: "workspace", id });
                    else if (t === "group") setScope({ type: "group", id });
                    else if (t === "user") setScope({ type: "user", id });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-80">
                    <SelectItem value="tenant:">
                      <span className="flex items-center gap-2">
                        <Box className="h-3 w-3" /> Entire tenant
                      </span>
                    </SelectItem>
                    {(targets.data?.workspaces ?? []).map((w) => (
                      <SelectItem key={`workspace:${w.id}`} value={`workspace:${w.id}`}>
                        <span className="flex items-center gap-2">
                          <Box className="h-3 w-3" /> Workspace · {w.name}
                        </span>
                      </SelectItem>
                    ))}
                    {(targets.data?.groups ?? []).map((g) => (
                      <SelectItem key={`group:${g.id}`} value={`group:${g.id}`}>
                        <span className="flex items-center gap-2">
                          <Users className="h-3 w-3" /> Group · {g.name}
                        </span>
                      </SelectItem>
                    ))}
                    {(targets.data?.members ?? []).slice(0, 100).map((m) => (
                      <SelectItem key={`user:${m.user_id}`} value={`user:${m.user_id}`}>
                        <span className="flex items-center gap-2">
                          <User className="h-3 w-3" /> User · {m.profile?.email ?? m.user_id.slice(0, 8)}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={bulk.isPending || allKeys.length === 0}
                onClick={() => bulk.mutate({ keys: allKeys, allowed: true })}
              >
                Enable all visible
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={bulk.isPending || allKeys.length === 0}
                onClick={() => bulk.mutate({ keys: allKeys, allowed: false })}
              >
                Disable all visible
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="tree">
        <TabsList>
          <TabsTrigger value="tree">Hierarchy</TabsTrigger>
          <TabsTrigger value="audit">
            <History className="h-3 w-3 mr-1" /> Audit history
          </TabsTrigger>
        </TabsList>

        <TabsContent value="tree" className="mt-4">
          <Card>
            <CardContent className="pt-4">
              {catalog.isLoading ? (
                <div className="text-sm text-muted-foreground p-6">Loading catalog…</div>
              ) : roots.length === 0 ? (
                <div className="text-sm text-muted-foreground p-6">No entries match the filter.</div>
              ) : (
                <ScrollArea className="h-[65vh] pr-4">{roots.map((r) => renderNode(r, 0))}</ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit" className="mt-4">
          <Card>
            <CardContent className="pt-4">
              {audit.isLoading ? (
                <div className="text-sm text-muted-foreground p-6">Loading audit…</div>
              ) : (audit.data ?? []).length === 0 ? (
                <div className="text-sm text-muted-foreground p-6">No entitlement changes recorded yet.</div>
              ) : (
                <ScrollArea className="h-[65vh] pr-4">
                  <div className="space-y-2">
                    {(audit.data ?? []).map((row) => (
                      <div key={row.id} className="flex items-center gap-3 border rounded-md px-3 py-2 text-sm">
                        <Badge variant={row.new_enabled ? "default" : "secondary"}>{row.action}</Badge>
                        <span className="font-mono text-xs">{row.catalog_key}</span>
                        <Badge variant="outline" className="text-xs">
                          {row.scope_type}
                        </Badge>
                        <span className="text-muted-foreground text-xs ml-auto">
                          {new Date(row.created_at).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
