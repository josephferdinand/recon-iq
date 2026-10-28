import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listFeatureFlags, setFeatureFlag, getTenantRetention, setTenantRetention } from "@/lib/feature-flags.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToggleLeft } from "lucide-react";
import { toast } from "sonner";
import { useEffect, useState } from "react";

export function FeatureFlagsTab({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const list = useServerFn(listFeatureFlags);
  const setF = useServerFn(setFeatureFlag);
  const getR = useServerFn(getTenantRetention);
  const setR = useServerFn(setTenantRetention);

  const q = useQuery({ queryKey: ["features", tenantId], queryFn: () => list({ data: { tenant_id: tenantId } }) });
  const r = useQuery({ queryKey: ["retention", tenantId], queryFn: () => getR({ data: { tenant_id: tenantId } }) });
  const [days, setDays] = useState<number>(90);
  useEffect(() => { if (r.data) setDays(r.data.run_retention_days); }, [r.data]);

  const mFlag = useMutation({
    mutationFn: (v: { feature_key: string; enabled: boolean }) =>
      setF({ data: { tenant_id: tenantId, ...v } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["features", tenantId] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const mRet = useMutation({
    mutationFn: (n: number) => setR({ data: { tenant_id: tenantId, run_retention_days: n } }),
    onSuccess: () => { toast.success("Retention updated"); qc.invalidateQueries({ queryKey: ["retention", tenantId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const groups: Record<string, any[]> = {};
  (q.data ?? []).forEach((f: any) => { (groups[f.category] ||= []).push(f); });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ToggleLeft className="h-4 w-4" /> Run history retention</CardTitle>
          <CardDescription>How long recon run history, matches and exceptions are kept.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-end gap-3">
          <div className="space-y-1">
            <Label>Retention (days)</Label>
            <Input type="number" min={7} max={3650} className="w-32"
              value={days} disabled={!canWrite}
              onChange={(e) => setDays(Number(e.target.value))} />
          </div>
          <Button disabled={!canWrite || mRet.isPending || days === r.data?.run_retention_days}
            onClick={() => mRet.mutate(days)}>Save</Button>
          <p className="text-xs text-muted-foreground ml-auto">Default 90. Min 7. Max 3650.</p>
        </CardContent>
      </Card>

      {Object.entries(groups).map(([cat, items]) => (
        <Card key={cat}>
          <CardHeader><CardTitle className="text-sm">{cat}</CardTitle></CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {items.map((f) => (
              <div key={f.key} className="flex items-center justify-between rounded-md border p-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="font-medium text-sm">{f.label}</div>
                    {f.updated_at ? <Badge variant="outline" className="text-[10px]">overridden</Badge> : null}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{f.description}</p>
                </div>
                <Switch checked={!!f.enabled} disabled={!canWrite || mFlag.isPending}
                  onCheckedChange={(v) => mFlag.mutate({ feature_key: f.key, enabled: v })} />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
