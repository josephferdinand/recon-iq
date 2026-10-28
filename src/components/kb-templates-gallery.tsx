import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listKbTemplates, createArticleFromTemplate } from "@/lib/kb-templates.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { FileText, Plus, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

interface Template {
  id: string; key: string; name: string; description: string | null;
  scope: "workspace" | "tenant" | "platform"; body_md: string;
  default_soc2_controls: string[];
}

export function KbTemplatesGallery({ tenantId, onCreated }: { tenantId?: string; onCreated?: (id: string) => void }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listKbTemplates);
  const createFn = useServerFn(createArticleFromTemplate);
  const q = useQuery({ queryKey: ["kb-templates"], queryFn: () => listFn() });

  const [selected, setSelected] = useState<Template | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");

  const m = useMutation({
    mutationFn: () => createFn({
      data: {
        template_id: selected!.id,
        tenant_id: tenantId,
        scope: selected!.scope,
        title, summary: summary || undefined,
      },
    }),
    onSuccess: (res: any) => {
      toast.success("Article created from template");
      setSelected(null); setTitle(""); setSummary("");
      qc.invalidateQueries({ queryKey: ["kb-articles"] });
      onCreated?.(res.id);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const templates = (q.data as Template[] | undefined) ?? [];

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {templates.map((t) => (
          <Card key={t.id} className="flex flex-col">
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="h-4 w-4" />{t.name}
                </CardTitle>
                <Badge variant="outline" className="capitalize">{t.scope}</Badge>
              </div>
              <CardDescription>{t.description}</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col justify-between gap-3">
              <div className="flex flex-wrap gap-1">
                {t.default_soc2_controls.map((c) => (
                  <Badge key={c} variant="secondary" className="text-[10px]">
                    <ShieldCheck className="h-3 w-3 mr-1" />{c}
                  </Badge>
                ))}
              </div>
              <Button size="sm" onClick={() => setSelected(t)}>
                <Plus className="h-4 w-4 mr-1" />Use template
              </Button>
            </CardContent>
          </Card>
        ))}
        {q.isLoading && <p className="text-sm text-muted-foreground">Loading templates…</p>}
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New article from "{selected?.name}"</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <Label>Summary (optional)</Label>
              <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} />
            </div>
            <div className="text-xs text-muted-foreground">
              SOC 2 controls auto-mapped: {selected?.default_soc2_controls.join(", ") || "none"}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>Cancel</Button>
            <Button onClick={() => m.mutate()} disabled={title.length < 2 || m.isPending}>
              {m.isPending ? "Creating…" : "Create draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
