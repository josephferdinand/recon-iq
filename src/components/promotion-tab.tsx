import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listPackages, createPackage, decidePackage, promotePackage, rollbackPackage, getPackage } from "@/lib/promotion.functions";
import { listAllTenants } from "@/lib/tenants.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { GitBranch, Plus, RotateCcw, ThumbsUp, ThumbsDown, Rocket } from "lucide-react";
import { toast } from "sonner";

export function PromotionTab({ familyId, sourceTenantId }: { familyId?: string; sourceTenantId?: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listPackages);
  const create = useServerFn(createPackage);
  const decide = useServerFn(decidePackage);
  const promote = useServerFn(promotePackage);
  const rollback = useServerFn(rollbackPackage);
  const get = useServerFn(getPackage);
  const tenants = useServerFn(listAllTenants);

  const q = useQuery({ queryKey: ["promo", familyId ?? null], queryFn: () => list({ data: { family_id: familyId } }) });
  const tQ = useQuery({ queryKey: ["promo-tenants"], queryFn: () => tenants() });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ source_tenant_id: sourceTenantId ?? "", target_tenant_id: "", name: "", notes: "" });
  const [openId, setOpenId] = useState<string | null>(null);
  const detailQ = useQuery({
    queryKey: ["promo-detail", openId],
    queryFn: () => openId ? get({ data: { id: openId } }) : null,
    enabled: !!openId,
  });

  const mCreate = useMutation({
    mutationFn: () => create({ data: { ...form, payload: { definitions: [] } } }),
    onSuccess: () => {
      toast.success("Package created — awaiting approval");
      setOpen(false); setForm({ source_tenant_id: sourceTenantId ?? "", target_tenant_id: "", name: "", notes: "" });
      qc.invalidateQueries({ queryKey: ["promo"] });
    },
    onError: (e: any) => toast.error(e.message),
  });
  const inv = () => {
    qc.invalidateQueries({ queryKey: ["promo"] });
    qc.invalidateQueries({ queryKey: ["promo-detail", openId] });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2"><GitBranch className="h-4 w-4" />Promotion packages</CardTitle>
            <CardDescription>Move definitions from Dev → UAT → Prod. Prod requires 2 approvers.</CardDescription>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="mr-1 h-4 w-4" />New package</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Build promotion package</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Source tenant</Label>
                  <Select value={form.source_tenant_id} onValueChange={(v) => setForm({ ...form, source_tenant_id: v })}>
                    <SelectTrigger><SelectValue placeholder="…" /></SelectTrigger>
                    <SelectContent>
                      {(tQ.data ?? []).map((t: any) => (
                        <SelectItem key={t.id} value={t.id}>{t.name} ({t.environment})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Target tenant</Label>
                  <Select value={form.target_tenant_id} onValueChange={(v) => setForm({ ...form, target_tenant_id: v })}>
                    <SelectTrigger><SelectValue placeholder="…" /></SelectTrigger>
                    <SelectContent>
                      {(tQ.data ?? []).filter((t: any) => t.id !== form.source_tenant_id).map((t: any) => (
                        <SelectItem key={t.id} value={t.id}>{t.name} ({t.environment})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
                <div><Label>Notes</Label><Textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
                <Button className="w-full" disabled={!form.source_tenant_id || !form.target_tenant_id || !form.name || mCreate.isPending} onClick={() => mCreate.mutate()}>Create</Button>
              </div>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr><th className="px-4 py-2">Name</th><th className="px-4 py-2">Target env</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Approvals req.</th><th className="px-4 py-2">Payload hash</th><th className="px-4 py-2">Created</th></tr>
            </thead>
            <tbody>
              {(q.data ?? []).map((p: any) => (
                <tr key={p.id} className="cursor-pointer border-b hover:bg-muted/30" onClick={() => setOpenId(p.id)}>
                  <td className="px-4 py-2 font-medium">{p.name}</td>
                  <td className="px-4 py-2"><Badge variant="outline" className="uppercase">{p.target_environment}</Badge></td>
                  <td className="px-4 py-2"><Badge>{p.status}</Badge></td>
                  <td className="px-4 py-2 text-xs">{p.required_approvals}</td>
                  <td className="px-4 py-2 font-mono text-[10px] text-muted-foreground">{String(p.payload_hash).slice(0, 12)}…</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(p.created_at).toLocaleString()}</td>
                </tr>
              ))}
              {q.data && q.data.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">No packages yet. Example: promote “Demo Bank Nostro USD v3” from staging → production with 4-eyes approval.</td></tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-w-2xl">
          {detailQ.data?.pkg ? (
            <>
              <DialogHeader><DialogTitle>{(detailQ.data.pkg as any).name}</DialogTitle></DialogHeader>
              <div className="space-y-3 text-sm">
                <div className="flex gap-2">
                  <Badge>{(detailQ.data.pkg as any).status}</Badge>
                  <Badge variant="outline" className="uppercase">{(detailQ.data.pkg as any).target_environment}</Badge>
                </div>
                <div className="rounded border p-2 font-mono text-[11px] text-muted-foreground">
                  payload_hash: {(detailQ.data.pkg as any).payload_hash}
                </div>
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Approvals ({(detailQ.data.approvals ?? []).length}/{(detailQ.data.pkg as any).required_approvals})</div>
                  {(detailQ.data.approvals ?? []).map((a: any) => (
                    <div key={a.approver_id} className="border-b py-1 text-xs">
                      <Badge variant={a.decision === "approve" ? "default" : "destructive"}>{a.decision}</Badge>
                      <span className="ml-2 text-muted-foreground">{a.comment}</span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={(detailQ.data.pkg as any).status !== "pending_approval"}
                    onClick={() => decide({ data: { package_id: openId!, decision: "approve" } }).then(() => { toast.success("Approved"); inv(); })}>
                    <ThumbsUp className="mr-1 h-3.5 w-3.5" />Approve
                  </Button>
                  <Button size="sm" variant="outline" disabled={(detailQ.data.pkg as any).status !== "pending_approval"}
                    onClick={() => decide({ data: { package_id: openId!, decision: "reject" } }).then(() => { toast.success("Rejected"); inv(); })}>
                    <ThumbsDown className="mr-1 h-3.5 w-3.5" />Reject
                  </Button>
                  <Button size="sm" disabled={(detailQ.data.pkg as any).status !== "approved"}
                    onClick={() => promote({ data: { package_id: openId! } }).then(() => { toast.success("Promoted — snapshot stored"); inv(); })}>
                    <Rocket className="mr-1 h-3.5 w-3.5" />Promote
                  </Button>
                  <Button size="sm" variant="outline" disabled={(detailQ.data.pkg as any).status !== "promoted"}
                    onClick={() => rollback({ data: { package_id: openId! } }).then(() => { toast.success("Rolled back"); inv(); })}>
                    <RotateCcw className="mr-1 h-3.5 w-3.5" />Rollback
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
