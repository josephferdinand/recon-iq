import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getSoc2Monitor } from "@/lib/platform-consoles.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck } from "lucide-react";

export function PlatformSoc2MonitorTab() {
  const fn = useServerFn(getSoc2Monitor);
  const q = useQuery({ queryKey: ["soc2-monitor"], queryFn: () => fn() });
  const rows = q.data?.rows ?? [];
  const summary: Record<string, number> = q.data?.summary ?? {};

  const tone = (s: string) =>
    s === "pass" ? "default" : s === "fail" ? "destructive" : s === "warn" ? "secondary" : "outline";

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        {["pass", "warn", "fail", "no-run"].map((k) => (
          <Card key={k}>
            <CardHeader className="pb-2">
              <CardDescription className="uppercase text-xs">{k}</CardDescription>
              <CardTitle className="text-3xl">{summary[k] ?? 0}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> SOC 2 control status</CardTitle>
          <CardDescription>
            Latest automated evidence run per control (last 30 days). Feeds the audit evidence packs.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Control</th>
                <th className="px-4 py-2">TSC</th>
                <th className="px-4 py-2">Title</th>
                <th className="px-4 py-2">Owner</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Last run</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.control_code} className="border-b">
                  <td className="px-4 py-2 font-mono text-xs">{r.control_code}</td>
                  <td className="px-4 py-2 text-xs">{r.tsc ?? "—"}</td>
                  <td className="px-4 py-2 text-xs">{r.title}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{r.owner ?? "—"}</td>
                  <td className="px-4 py-2">
                    <Badge variant={tone(r.latest_status) as any}>{r.latest_status}</Badge>
                  </td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {r.latest_at ? new Date(r.latest_at).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No controls seeded.</td></tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
