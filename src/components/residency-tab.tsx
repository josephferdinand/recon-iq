import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import { listDrRegions, getTenantResidency, setTenantResidency, listBenchmarks } from "@/lib/platform-depth.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Globe2, BarChart3 } from "lucide-react";

export function ResidencyTab({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const drFn = useServerFn(listDrRegions);
  const getFn = useServerFn(getTenantResidency);
  const setFn = useServerFn(setTenantResidency);
  const benchFn = useServerFn(listBenchmarks);

  const regions = useQuery({ queryKey: ["dr-regions"], queryFn: () => drFn({ data: undefined as any }) });
  const cur = useQuery({ queryKey: ["residency", tenantId], queryFn: () => getFn({ data: { tenant_id: tenantId } }) });
  const bench = useQuery({ queryKey: ["benchmarks"], queryFn: () => benchFn({ data: undefined as any }) });

  const [form, setForm] = useState<any>({
    primary_region_code: "eu-west-1", secondary_region_code: "", active_active: false, pinned_pii: true,
  });
  useEffect(() => {
    if (cur.data) setForm({
      primary_region_code: cur.data.primary_region_code,
      secondary_region_code: cur.data.secondary_region_code ?? "",
      active_active: cur.data.active_active,
      pinned_pii: cur.data.pinned_pii,
    });
  }, [cur.data]);

  const m = useMutation({
    mutationFn: () => setFn({ data: {
      tenant_id: tenantId,
      primary_region_code: form.primary_region_code,
      secondary_region_code: form.secondary_region_code || null,
      active_active: form.active_active, pinned_pii: form.pinned_pii,
    } }),
    onSuccess: () => { toast.success("Residency updated"); qc.invalidateQueries({ queryKey: ["residency", tenantId] }); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe2 className="h-4 w-4" /> Data residency & active-active DR
          </CardTitle>
          <CardDescription>
            Pin tenant data to a primary region for GDPR/UK-GDPR/MAS/JFSA compliance and optionally enable an active-active secondary for sub-minute RPO.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div>
            <Label>Primary region</Label>
            <Select value={form.primary_region_code} onValueChange={(v) => setForm({ ...form, primary_region_code: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(regions.data ?? []).map((r: any) => (
                  <SelectItem key={r.code} value={r.code}>{r.geography} · {r.name} ({r.cloud})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Secondary region (optional)</Label>
            <Select value={form.secondary_region_code || "_none"} onValueChange={(v) => setForm({ ...form, secondary_region_code: v === "_none" ? "" : v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">— none —</SelectItem>
                {(regions.data ?? []).map((r: any) => (
                  <SelectItem key={r.code} value={r.code}>{r.geography} · {r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label>Active-active</Label>
              <p className="text-xs text-muted-foreground">Replicate writes to both regions for &lt;60s RPO.</p>
            </div>
            <Switch checked={form.active_active} onCheckedChange={(v) => setForm({ ...form, active_active: v })} />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label>Pin PII to primary</Label>
              <p className="text-xs text-muted-foreground">PII fields never leave the primary region.</p>
            </div>
            <Switch checked={form.pinned_pii} onCheckedChange={(v) => setForm({ ...form, pinned_pii: v })} />
          </div>
          <div className="md:col-span-2">
            <Button disabled={!canWrite || m.isPending} onClick={() => m.mutate()}>Save residency</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart3 className="h-4 w-4" /> Industry benchmarks
          </CardTitle>
          <CardDescription>
            Anonymized P25/P50/P75/P95 across the ReconIQ network, segmented by asset class and cohort.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Metric</TableHead>
                <TableHead>Asset class</TableHead>
                <TableHead>Cohort</TableHead>
                <TableHead className="text-right">P25</TableHead>
                <TableHead className="text-right">P50</TableHead>
                <TableHead className="text-right">P75</TableHead>
                <TableHead className="text-right">P95</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(bench.data ?? []).map((b: any) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">{b.metric}</TableCell>
                  <TableCell><Badge variant="outline">{b.asset_class}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{b.cohort}</TableCell>
                  <TableCell className="text-right">{b.percentile_25}</TableCell>
                  <TableCell className="text-right">{b.percentile_50}</TableCell>
                  <TableCell className="text-right">{b.percentile_75}</TableCell>
                  <TableCell className="text-right">{b.percentile_95}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{b.unit}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
