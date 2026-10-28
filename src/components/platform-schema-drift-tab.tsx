import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { listAllSchemaDrift, bulkReBaselineSchemas } from "@/lib/platform-gaps.functions";
import { GitBranch, ChevronRight } from "lucide-react";
import { toast } from "sonner";

export function PlatformSchemaDriftTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listAllSchemaDrift);
  const bulkFn = useServerFn(bulkReBaselineSchemas);
  const q = useQuery({
    queryKey: ["platform-drift"],
    queryFn: () => listFn({ data: { limit: 100 } }),
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<any | null>(null);

  const bulk = useMutation({
    mutationFn: () => bulkFn({ data: { tenant_ids: Array.from(selected) } }),
    onSuccess: (r: any) => {
      toast.success(`Re-baselined ${r.baselined} definitions`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["platform-drift"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Re-baseline failed"),
  });

  const toggle = (id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const rows = q.data ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2"><GitBranch className="h-4 w-4" />Schema drift</CardTitle>
            <CardDescription>Per-tenant drift between current recon definitions and last baseline.</CardDescription>
          </div>
          <Button
            disabled={selected.size === 0 || bulk.isPending}
            onClick={() => bulk.mutate()}
          >
            Re-baseline {selected.size > 0 ? `(${selected.size})` : ""}
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 w-10"></th>
                <th className="px-3 py-2">Tenant</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Changes</th>
                <th className="px-3 py-2">First drifted</th>
                <th className="px-3 py-2 text-right">Details</th>
              </tr>
            </thead>
            <tbody>
              {q.isLoading && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>
              )}
              {!q.isLoading && rows.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No tenants.</td></tr>
              )}
              {rows.map((r: any) => (
                <tr key={r.tenant_id} className="border-b">
                  <td className="px-3 py-2">
                    <Checkbox
                      checked={selected.has(r.tenant_id)}
                      onCheckedChange={() => toggle(r.tenant_id)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.tenant_name}</div>
                    <div className="text-xs text-muted-foreground">{r.tenant_slug}</div>
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={
                      r.status === "clean" ? "secondary" :
                      r.status === "drifted" ? "destructive" : "outline"
                    }>{r.status}</Badge>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    +{r.added.length} / −{r.removed.length} / ~{r.modified.length}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {r.first_drifted_at ? new Date(r.first_drifted_at).toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setDetail(r)}>
                      Drill down <ChevronRight className="h-3 w-3 ml-1" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detail?.tenant_name} — drift detail</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-3 text-sm max-h-96 overflow-auto">
              <div>
                <div className="font-medium mb-1">Added ({detail.added.length})</div>
                {detail.added.length === 0 ? <div className="text-xs text-muted-foreground">None</div> :
                  <ul className="text-xs list-disc pl-5">{detail.added.map((n: string) => <li key={n}>{n}</li>)}</ul>}
              </div>
              <div>
                <div className="font-medium mb-1">Removed ({detail.removed.length})</div>
                {detail.removed.length === 0 ? <div className="text-xs text-muted-foreground">None</div> :
                  <ul className="text-xs list-disc pl-5">{detail.removed.map((n: string) => <li key={n}>{n}</li>)}</ul>}
              </div>
              <div>
                <div className="font-medium mb-1">Modified ({detail.modified.length})</div>
                {detail.modified.length === 0 ? <div className="text-xs text-muted-foreground">None</div> :
                  <ul className="text-xs list-disc pl-5">
                    {detail.modified.map((m: any, i: number) => (
                      <li key={i}><b>{m.key}</b>.{m.field}: {String(m.before)} → {String(m.after)}</li>
                    ))}
                  </ul>}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetail(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
