import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { updateTenantResidency, REGIONS } from "@/lib/residency.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Globe, Lock } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

export function ResidencyCard({ tenantId, region, locked, canWrite }: {
  tenantId: string; region: string; locked: boolean; canWrite: boolean;
}) {
  const [r, setR] = useState(region);
  const [l, setL] = useState(locked);
  const update = useServerFn(updateTenantResidency);
  const m = useMutation({
    mutationFn: (v: { region: string; lock?: boolean }) => update({ data: { tenant_id: tenantId, ...v } }),
    onSuccess: () => toast.success("Residency updated"),
    onError: (e: any) => { toast.error(e.message); setR(region); setL(locked); },
  });
  const meta = REGIONS.find((x) => x.id === r);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Globe className="h-4 w-4" /> Data residency</CardTitle>
        <CardDescription>Pin tenant data and compute to a specific region. Lock to prevent accidental moves.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Select value={r} onValueChange={(v) => { setR(v); m.mutate({ region: v }); }} disabled={!canWrite || l}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {REGIONS.map((reg) => (
                <SelectItem key={reg.id} value={reg.id}>
                  {reg.label} <span className="ml-2 text-xs text-muted-foreground">{reg.residency}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2 text-xs">
            <Badge variant="outline">{meta?.residency}</Badge>
            <span className="text-muted-foreground">Compliance scope</span>
          </div>
        </div>
        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="flex items-center gap-2 text-sm">
            <Lock className="h-3.5 w-3.5" />
            <span className="font-medium">Lock residency</span>
          </div>
          <Switch aria-label="Lock tenant data residency" checked={l} disabled={!canWrite} onCheckedChange={(v) => { setL(v); m.mutate({ region: r, lock: v }); }} />
        </div>
      </CardContent>
    </Card>
  );
}
