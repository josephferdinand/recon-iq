import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listSubProcessors, upsertSubProcessor, deleteSubProcessor } from "@/lib/subprocessors.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Trash2, Plus, ExternalLink } from "lucide-react";
import { toast } from "sonner";

export function SubProcessorsTab({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const list = useServerFn(listSubProcessors);
  const upsert = useServerFn(upsertSubProcessor);
  const del = useServerFn(deleteSubProcessor);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", purpose: "", region: "", website: "", dpa_url: "" });

  const q = useQuery({
    queryKey: ["subprocessors", tenantId],
    queryFn: () => list({ data: { tenantId } }),
    staleTime: 30_000,
  });

  const save = useMutation({
    mutationFn: () => upsert({ data: { tenantId, ...form } }),
    onSuccess: () => {
      toast.success("Sub-processor saved");
      setOpen(false);
      setForm({ name: "", purpose: "", region: "", website: "", dpa_url: "" });
      qc.invalidateQueries({ queryKey: ["subprocessors", tenantId] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => del({ data: { id, tenantId } }),
    onSuccess: () => {
      toast.success("Removed");
      qc.invalidateQueries({ queryKey: ["subprocessors", tenantId] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed"),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Sub-processor register</CardTitle>
          <CardDescription>
            GDPR Art. 28 / DORA disclosure. Lists every third-party processor handling tenant data,
            their purpose, region, and DPA reference. Auditable and tenant-readable.
          </CardDescription>
        </div>
        {canWrite ? (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="mr-1 h-4 w-4" /> Add</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add sub-processor</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div><Label>Purpose</Label><Input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="e.g. Database hosting, Payment processing" /></div>
                <div><Label>Region</Label><Input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} placeholder="e.g. EU-West, US-East" /></div>
                <div><Label>Website</Label><Input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://" /></div>
                <div><Label>DPA URL</Label><Input value={form.dpa_url} onChange={(e) => setForm({ ...form, dpa_url: e.target.value })} placeholder="https://" /></div>
              </div>
              <DialogFooter>
                <Button onClick={() => save.mutate()} disabled={!form.name || !form.purpose || save.isPending}>
                  {save.isPending ? "Saving…" : "Save"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Purpose</th>
              <th className="px-4 py-2">Region</th>
              <th className="px-4 py-2">DPA</th>
              <th className="px-4 py-2">Scope</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((r: any) => (
              <tr key={r.id} className="border-b">
                <td className="px-4 py-2 font-medium">{r.name}</td>
                <td className="px-4 py-2 text-muted-foreground">{r.purpose}</td>
                <td className="px-4 py-2">{r.region ?? "—"}</td>
                <td className="px-4 py-2">
                  {r.dpa_url ? (
                    <a className="inline-flex items-center gap-1 text-primary hover:underline" href={r.dpa_url} target="_blank" rel="noreferrer">
                      View <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : "—"}
                </td>
                <td className="px-4 py-2">
                  {r.tenant_id ? <Badge variant="outline">Tenant</Badge> : <Badge>Platform</Badge>}
                </td>
                <td className="px-4 py-2 text-right">
                  {canWrite && r.tenant_id ? (
                    <Button size="icon" variant="ghost" onClick={() => remove.mutate(r.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
            {q.data && q.data.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No sub-processors registered yet.</td></tr>
            ) : null}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
