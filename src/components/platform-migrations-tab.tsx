import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { listMigrationImports, reRunMigrationImport } from "@/lib/platform-gaps.functions";
import { RefreshCw, AlertCircle, Upload } from "lucide-react";
import { toast } from "sonner";

export function PlatformMigrationsTab() {
  const [tenantFilter, setTenantFilter] = useState("");
  const qc = useQueryClient();
  const listFn = useServerFn(listMigrationImports);
  const rerunFn = useServerFn(reRunMigrationImport);
  const [errorView, setErrorView] = useState<{ open: boolean; title: string; body: string }>({
    open: false, title: "", body: "",
  });

  const q = useQuery({
    queryKey: ["platform-migrations", tenantFilter],
    queryFn: () => listFn({ data: { limit: 100 } }),
  });

  const rerun = useMutation({
    mutationFn: (id: string) => rerunFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Import queued for re-run");
      qc.invalidateQueries({ queryKey: ["platform-migrations"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Re-run failed"),
  });

  const rows = (q.data ?? []).filter((r: any) =>
    !tenantFilter ||
    r.tenant_name?.toLowerCase().includes(tenantFilter.toLowerCase()) ||
    r.tenant_slug?.toLowerCase().includes(tenantFilter.toLowerCase()),
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Upload className="h-4 w-4" />Migration imports</CardTitle>
          <CardDescription>
            Tenant migrations from legacy platforms (Duco, TLM, SmartStream, Frontier, IntelliMatch).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="tenant-filter" className="text-xs">Filter tenant</Label>
            <Input
              id="tenant-filter"
              placeholder="Tenant name or slug"
              value={tenantFilter}
              onChange={(e) => setTenantFilter(e.target.value)}
              className="max-w-xs"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Tenant</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Imported</th>
                  <th className="px-3 py-2">Records (imp/fail)</th>
                  <th className="px-3 py-2">Confidence</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {q.isLoading && (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>
                )}
                {!q.isLoading && rows.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No imports yet.</td></tr>
                )}
                {rows.map((r: any) => (
                  <tr key={r.id} className="border-b">
                    <td className="px-3 py-2">
                      <div className="font-medium">{r.tenant_name}</div>
                      <div className="text-xs text-muted-foreground">{r.tenant_slug}</div>
                    </td>
                    <td className="px-3 py-2 capitalize">{r.source_system}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <span className="text-emerald-600">{r.definitions_imported ?? 0}</span>
                      {" / "}
                      <span className="text-rose-600">{r.records_failed}</span>
                      {" of "}{r.definitions_found ?? 0}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r.confidence_score != null
                        ? `${(r.confidence_score * 100).toFixed(0)}%`
                        : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={r.status === "completed" ? "default" : r.status === "failed" ? "destructive" : "secondary"}>
                        {r.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-right space-x-2">
                      {r.error_message && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setErrorView({
                              open: true,
                              title: `${r.tenant_name} — ${r.source_system}`,
                              body: r.error_message,
                            })
                          }
                        >
                          <AlertCircle className="h-3 w-3 mr-1" />Errors
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={rerun.isPending}
                        onClick={() => rerun.mutate(r.id)}
                      >
                        <RefreshCw className="h-3 w-3 mr-1" />Re-run
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={errorView.open} onOpenChange={(o) => setErrorView((s) => ({ ...s, open: o }))}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{errorView.title}</DialogTitle>
          </DialogHeader>
          <pre className="rounded bg-muted p-3 text-xs whitespace-pre-wrap max-h-96 overflow-auto">
            {errorView.body}
          </pre>
          <DialogFooter>
            <Button variant="outline" onClick={() => setErrorView((s) => ({ ...s, open: false }))}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
