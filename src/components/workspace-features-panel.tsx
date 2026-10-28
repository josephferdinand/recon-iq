// Tenant Administration → Workspace Features toggle panel.
// Every W-1 … W-28 feature is an explicit switch owned by the tenant admin.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { listWorkspaceFeatures, setWorkspaceFeature } from "@/lib/workspace.functions";
import { WORKSPACE_FEATURE_META } from "@/lib/workspace-features";
import { isTenantWritableWorkspaceFeature } from "@/lib/session-feature-policy";

export function WorkspaceFeaturesPanel({ tenantId }: { tenantId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listWorkspaceFeatures);
  const setFn = useServerFn(setWorkspaceFeature);
  const { data: rows, isLoading } = useQuery({
    queryKey: ["twf", tenantId],
    queryFn: () => listFn({ data: { tenantId } }),
  });
  const set = useMutation({
    mutationFn: (p: { key: string; enabled: boolean }) =>
      setFn({ data: { tenantId, key: p.key as any, enabled: p.enabled } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["twf", tenantId] }),
    onError: (e: any) => toast.error(e.message ?? "Update failed"),
  });
  const byKey = Object.fromEntries((rows ?? []).map((r: any) => [r.key, r]));
  const enableAll = (priority?: "P1" | "P2" | "P3") => {
    const rank = { P1: 1, P2: 2, P3: 3 };
    const targets = WORKSPACE_FEATURE_META.filter((m) =>
      isTenantWritableWorkspaceFeature(m.key) && (!priority || rank[m.priority] <= rank[priority]));
    Promise.all(targets.map((m) => setFn({ data: { tenantId, key: m.key as any, enabled: true } })))
      .then(() => { toast.success(`Enabled ${targets.length} features`); qc.invalidateQueries({ queryKey: ["twf", tenantId] }); })
      .catch((e: any) => toast.error(e.message));
  };
  const groups = Array.from(new Set(WORKSPACE_FEATURE_META.map((m) => m.group)));

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm text-muted-foreground">
            Enable or disable every workspace UX feature (W-1 … W-28). Users only see features you turn on.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => enableAll("P1")}>Enable all P1</Button>
          <Button variant="outline" size="sm" onClick={() => enableAll("P2")}>Enable P1 + P2</Button>
          <Button size="sm" onClick={() => enableAll()}>Enable everything</Button>
        </div>
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">Loading features…</p>}
      {groups.map((g) => (
        <Card key={g}>
          <CardHeader><CardTitle className="text-base">{g}</CardTitle></CardHeader>
          <CardContent className="divide-y divide-border">
            {WORKSPACE_FEATURE_META.filter((m) => m.group === g).map((m) => {
              const enabled = !!byKey[m.key]?.enabled;
              return (
                <div key={m.key} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{m.label}</span>
                      <Badge variant="outline" className="text-[10px]">{m.gapId}</Badge>
                      <Badge variant={m.priority === "P1" ? "default" : "secondary"} className="text-[10px]">{m.priority}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{m.description}</p>
                  </div>
                  {m.key === "single_session_enforcement" ? (
                    <Badge variant="secondary">Project-level Auth</Badge>
                  ) : (
                    <Switch
                      checked={enabled}
                      onCheckedChange={(v) => set.mutate({ key: m.key, enabled: v })}
                      aria-label={`Toggle ${m.label}`}
                    />
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
