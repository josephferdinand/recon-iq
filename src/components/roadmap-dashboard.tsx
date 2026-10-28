import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listRoadmap, upsertRoadmap, deleteRoadmap, roadmapSummary } from "@/lib/roadmap.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Map, Plus, Trash2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

const STATUS_COLORS: Record<string, string> = {
  planned: "bg-slate-500/15 text-slate-700 dark:text-slate-300",
  in_progress: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  blocked: "bg-red-500/15 text-red-700 dark:text-red-300",
  review: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  shipped: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  deferred: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
};

export function RoadmapDashboard({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient();
  const fnList = useServerFn(listRoadmap);
  const fnUpsert = useServerFn(upsertRoadmap);
  const fnDelete = useServerFn(deleteRoadmap);
  const fnSummary = useServerFn(roadmapSummary);

  const items = useQuery({ queryKey: ["roadmap"], queryFn: () => fnList({ data: {} }) });
  const summary = useQuery({ queryKey: ["roadmap-summary"], queryFn: () => fnSummary({ data: {} as never }) });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({
    title: "", summary: "", wave: "next", priority: "P1", scope: "platform",
    owner_label: "", status: "planned", readiness: 0, audit_ready: false, tags: [],
  });

  const save = useMutation({
    mutationFn: () => fnUpsert({ data: form }),
    onSuccess: () => {
      toast.success("Roadmap item saved");
      qc.invalidateQueries({ queryKey: ["roadmap"] });
      qc.invalidateQueries({ queryKey: ["roadmap-summary"] });
      setOpen(false);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => fnDelete({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["roadmap"] });
      qc.invalidateQueries({ queryKey: ["roadmap-summary"] });
    },
  });

  const s = summary.data;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Map className="h-4 w-4" /> Next Wave roadmap</CardTitle>
          <CardDescription>
            Scope, owners, and audit-ready readiness for Demo Bank deliverables.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-4">
          <Tile label="Items" value={s?.total ?? 0} />
          <Tile label="Audit-ready" value={s?.audit_ready ?? 0} />
          <Tile label="Avg readiness" value={`${s?.avg_readiness ?? 0}%`} />
          <Tile label="In progress" value={s?.by_status?.in_progress ?? 0} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle>Items</CardTitle>
            <CardDescription>Example: <em>DORA exporter hardening</em>, <em>Marketplace UI</em>, <em>Chat-Ops Slack</em>.</CardDescription>
          </div>
          {canWrite && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild><Button size="sm"><Plus className="mr-1 h-3.5 w-3.5" /> Add</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Roadmap item</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs">Title</Label>
                    <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. DORA exporter hardening" />
                  </div>
                  <div>
                    <Label className="text-xs">Summary</Label>
                    <Textarea rows={3} value={form.summary ?? ""} onChange={(e) => setForm({ ...form, summary: e.target.value })}
                      placeholder="What it delivers for Demo Bank, success metrics, audit artefacts." />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <Picker label="Wave" value={form.wave} setValue={(v) => setForm({ ...form, wave: v })} options={["current", "next", "future", "shipped"]} />
                    <Picker label="Priority" value={form.priority} setValue={(v) => setForm({ ...form, priority: v })} options={["P0", "P1", "P2", "P3"]} />
                    <Picker label="Scope" value={form.scope} setValue={(v) => setForm({ ...form, scope: v })} options={["platform", "tenant", "workspace", "ai", "security", "compliance", "integration"]} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Owner</Label>
                      <Input value={form.owner_label ?? ""} onChange={(e) => setForm({ ...form, owner_label: e.target.value })} placeholder="e.g. Maria Lopez (Recon SME)" />
                    </div>
                    <Picker label="Status" value={form.status} setValue={(v) => setForm({ ...form, status: v })} options={["planned", "in_progress", "blocked", "review", "shipped", "deferred"]} />
                  </div>
                  <div>
                    <Label className="text-xs">Readiness ({form.readiness}%)</Label>
                    <input type="range" min={0} max={100} value={form.readiness}
                      onChange={(e) => setForm({ ...form, readiness: Number(e.target.value) })} className="w-full" />
                  </div>
                  <div className="flex items-center justify-between rounded-md border p-2">
                    <Label className="text-xs flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" /> Audit-ready</Label>
                    <Switch checked={form.audit_ready} onCheckedChange={(v) => setForm({ ...form, audit_ready: v })} />
                  </div>
                </div>
                <DialogFooter><Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {items.data?.length === 0 && <p className="text-sm text-muted-foreground">No items yet.</p>}
          {(items.data ?? []).map((it: any) => (
            <div key={it.id} className="rounded-md border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{it.title}</span>
                    <Badge variant="outline" className="text-[10px]">{it.priority}</Badge>
                    <Badge variant="secondary" className="text-[10px] uppercase">{it.wave}</Badge>
                    <Badge variant="outline" className="text-[10px]">{it.scope}</Badge>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] ${STATUS_COLORS[it.status] ?? ""}`}>{it.status}</span>
                    {it.audit_ready && <Badge className="bg-emerald-600 text-[10px]"><ShieldCheck className="mr-0.5 h-3 w-3" /> audit-ready</Badge>}
                  </div>
                  {it.summary && <p className="mt-1 text-sm text-muted-foreground">{it.summary}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">Owner: {it.owner_label ?? "—"}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <Progress value={it.readiness ?? 0} className="h-1.5" />
                    <span className="text-xs text-muted-foreground w-10 text-right">{it.readiness ?? 0}%</span>
                  </div>
                </div>
                {canWrite && (
                  <Button size="sm" variant="ghost" onClick={() => remove.mutate(it.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function Picker({ label, value, setValue, options }: { label: string; value: string; setValue: (v: string) => void; options: string[] }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
