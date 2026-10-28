import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, History, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import {
  listWorkspacePageVisibility,
  listWorkspacePageVisibilityAudit,
  setWorkspacePageVisibility,
} from "@/lib/workspace-visibility.functions";

type Row = {
  key: string;
  label: string;
  group: string;
  enabled: boolean;
  overridden: boolean;
  updated_at: string | null;
};

export function WorkspaceVisibilityTab({
  tenantId,
  canWrite,
}: {
  tenantId: string;
  canWrite: boolean;
}) {
  const qc = useQueryClient();
  const fetchList = useServerFn(listWorkspacePageVisibility);
  const fetchAudit = useServerFn(listWorkspacePageVisibilityAudit);
  const setFn = useServerFn(setWorkspacePageVisibility);

  const q = useQuery({
    queryKey: ["workspace-visibility", tenantId],
    queryFn: () => fetchList({ data: { tenant_id: tenantId } }),
  });

  const audit = useQuery({
    queryKey: ["workspace-visibility-audit", tenantId],
    queryFn: () => fetchAudit({ data: { tenant_id: tenantId, limit: 50 } }),
  });

  const mut = useMutation({
    mutationFn: (v: { page_key: string; enabled: boolean }) =>
      setFn({ data: { tenant_id: tenantId, ...v } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspace-visibility", tenantId] });
      qc.invalidateQueries({ queryKey: ["workspace-visibility-map", tenantId] });
      qc.invalidateQueries({ queryKey: ["workspace-visibility-audit", tenantId] });
      toast.success("Updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [bulkGroup, setBulkGroup] = useState<string | null>(null);
  const bulkMut = useMutation({
    mutationFn: async (v: { group: string; enabled: boolean; keys: string[] }) => {
      setBulkGroup(v.group);
      const results = await Promise.allSettled(
        v.keys.map((k) => setFn({ data: { tenant_id: tenantId, page_key: k, enabled: v.enabled } })),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      return { total: v.keys.length, failed, enabled: v.enabled, group: v.group };
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["workspace-visibility", tenantId] });
      qc.invalidateQueries({ queryKey: ["workspace-visibility-map", tenantId] });
      qc.invalidateQueries({ queryKey: ["workspace-visibility-audit", tenantId] });
      if (r.failed > 0) {
        toast.error(`${r.group}: ${r.failed}/${r.total} failed`);
      } else {
        toast.success(`${r.group}: ${r.enabled ? "enabled" : "disabled"} ${r.total} pages`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setBulkGroup(null),
  });

  const rows: Row[] = q.data ?? [];
  const groups: Record<string, Row[]> = {};
  rows.forEach((r) => {
    (groups[r.group || "Workspace"] ||= []).push(r);
  });
  const totalHidden = rows.filter((r) => !r.enabled).length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-4 w-4" /> Workspace pages
          </CardTitle>
          <CardDescription>
            Turn individual sub-sections on or off for your end users. Disabled pages
            are hidden from the workspace left rail and blocked from direct URL access.
            Missing entry = enabled by default.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <Badge variant="outline">{rows.length} pages</Badge>
          <Badge variant={totalHidden > 0 ? "destructive" : "outline"}>
            {totalHidden} hidden
          </Badge>
          {!canWrite && (
            <span className="text-xs">Read-only — tenant_admin required to change.</span>
          )}
        </CardContent>
      </Card>

      {Object.entries(groups).map(([g, list]) => {
        const enabledCount = list.filter((r) => r.enabled).length;
        const total = list.length;
        const allEnabled = enabledCount === total;
        const allDisabled = enabledCount === 0;
        const busy = bulkMut.isPending && bulkGroup === g;
        const keys = list.map((r) => r.key);
        return (
          <Card key={g}>
            <CardHeader className="pb-2 flex flex-row items-center justify-between gap-3 space-y-0">
              <div className="flex items-center gap-2 min-w-0">
                <CardTitle className="text-sm truncate">{g}</CardTitle>
                <Badge variant="outline" className="text-[10px]">
                  {enabledCount}/{total} enabled
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canWrite || busy || allEnabled}
                  onClick={() => bulkMut.mutate({ group: g, enabled: true, keys })}
                >
                  Enable all
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canWrite || busy || allDisabled}
                  onClick={() => bulkMut.mutate({ group: g, enabled: false, keys })}
                >
                  Disable all
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid gap-2 md:grid-cols-2">
              {list.map((r) => (
                <div
                  key={r.key}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {r.enabled ? (
                        <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : (
                        <EyeOff className="h-3.5 w-3.5 text-destructive" />
                      )}
                      <div className="truncate font-medium text-sm">{r.label}</div>
                      {r.overridden ? (
                        <Badge variant="outline" className="text-[10px]">
                          overridden
                        </Badge>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground font-mono truncate">
                      {r.key}
                    </p>
                  </div>
                  <Switch
                    checked={r.enabled}
                    disabled={!canWrite || mut.isPending || busy}
                    onCheckedChange={(v) =>
                      mut.mutate({ page_key: r.key, enabled: v })
                    }
                    aria-label={`${r.enabled ? "Disable" : "Enable"} ${r.label}`}
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-3 space-y-0">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-sm">
              <History className="h-4 w-4" /> Change history
            </CardTitle>
            <CardDescription className="text-xs">
              Last 50 visibility changes. Sourced from the tamper-evident audit log.
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              qc.invalidateQueries({ queryKey: ["workspace-visibility-audit", tenantId] })
            }
            disabled={audit.isFetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${audit.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {audit.isLoading ? (
            <div className="p-4 text-sm text-muted-foreground">Loading…</div>
          ) : audit.isError ? (
            <div className="p-4 text-sm text-destructive">
              {(audit.error as Error)?.message ?? "Failed to load history"}
            </div>
          ) : !audit.data || audit.data.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">No changes recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">When</th>
                    <th className="px-3 py-2 text-left font-medium">Actor</th>
                    <th className="px-3 py-2 text-left font-medium">Page</th>
                    <th className="px-3 py-2 text-left font-medium">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.data.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                        {new Date(r.occurred_at).toLocaleString()}
                      </td>
                      <td className="px-3 py-2">
                        <div className="truncate">{r.actor_email ?? "—"}</div>
                        {r.actor_user_id ? (
                          <div className="text-[10px] text-muted-foreground font-mono truncate">
                            {r.actor_user_id.slice(0, 8)}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <div className="truncate font-medium">{r.page_label}</div>
                        <div className="text-[10px] text-muted-foreground font-mono truncate">
                          {r.page_key}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {r.enabled ? (
                          <Badge variant="outline" className="gap-1">
                            <Eye className="h-3 w-3" /> enabled
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="gap-1">
                            <EyeOff className="h-3 w-3" /> disabled
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
