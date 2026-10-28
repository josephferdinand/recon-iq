import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listSessionAnomalies, resolveSessionAnomaly } from "@/lib/platform-consoles.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { ShieldAlert, Check } from "lucide-react";

export function PlatformSessionAnomaliesTab() {
  const qc = useQueryClient();
  const list = useServerFn(listSessionAnomalies);
  const resolve = useServerFn(resolveSessionAnomaly);

  const [hours, setHours] = useState<number>(72);
  const [severity, setSeverity] = useState<"all" | "low" | "medium" | "high" | "critical">("all");
  const [unresolved, setUnresolved] = useState(true);

  const q = useQuery({
    queryKey: ["session-anomalies", hours, severity, unresolved],
    queryFn: () => list({ data: { hours, severity, unresolved_only: unresolved, limit: 200 } }),
  });
  const m = useMutation({
    mutationFn: (id: string) => resolve({ data: { id } }),
    onSuccess: () => {
      toast.success("Marked resolved");
      qc.invalidateQueries({ queryKey: ["session-anomalies"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const events = q.data?.events ?? [];
  const summary: Record<string, number> = q.data?.summary ?? {};

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-4 w-4" /> Session anomalies</CardTitle>
          <CardDescription>Impossible-travel, new-device, brute-force and geo-outlier login events.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Window</div>
            <Select value={String(hours)} onValueChange={(v) => setHours(Number(v))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="24">24 hours</SelectItem>
                <SelectItem value="72">72 hours</SelectItem>
                <SelectItem value="168">7 days</SelectItem>
                <SelectItem value="720">30 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Severity</div>
            <Select value={severity} onValueChange={(v) => setSeverity(v as any)}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={unresolved} onCheckedChange={setUnresolved} />
            <span className="text-sm">Unresolved only</span>
          </div>
          <div className="flex-1 flex justify-end gap-2 text-xs text-muted-foreground">
            {Object.entries(summary).map(([k, v]) => (
              <Badge key={k} variant="outline">{k}: {v}</Badge>
            ))}
          </div>
        </CardContent>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Severity</th>
                <th className="px-4 py-2">IP</th>
                <th className="px-4 py-2">Country</th>
                <th className="px-4 py-2">User</th>
                <th className="px-4 py-2">State</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {events.map((e: any) => (
                <tr key={e.id} className="border-b">
                  <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(e.created_at).toLocaleString()}</td>
                  <td className="px-4 py-2 text-xs font-mono">{e.event_type}</td>
                  <td className="px-4 py-2">
                    <Badge variant={e.severity === "high" || e.severity === "critical" ? "destructive" : "outline"}>
                      {e.severity}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-xs font-mono">{e.ip_address ?? "—"}</td>
                  <td className="px-4 py-2 text-xs">{e.geo_country ?? "—"}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{e.user_id ?? "—"}</td>
                  <td className="px-4 py-2">
                    {e.resolved_at ? <Badge variant="secondary">Resolved</Badge> : <Badge variant="outline">Open</Badge>}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {!e.resolved_at ? (
                      <Button size="sm" variant="ghost" onClick={() => m.mutate(e.id)} disabled={m.isPending}>
                        <Check className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {events.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No anomalies in the selected window.</td></tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
