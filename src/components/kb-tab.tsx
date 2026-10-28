import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listKbArticles, upsertKbArticle, deleteKbArticle, getKbArticle } from "@/lib/kb.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KbArticleStepEditor } from "@/components/kb-article-step-editor";
import { KbArticleReader } from "@/components/kb-article-reader";
import { Plus, Pencil, Trash2, BookOpen } from "lucide-react";
import { toast } from "sonner";

export function KbTab({ scope, tenantId }: { scope: "platform" | "tenant"; tenantId?: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listKbArticles);
  const upsert = useServerFn(upsertKbArticle);
  const del = useServerFn(deleteKbArticle);
  const get = useServerFn(getKbArticle);

  const q = useQuery({
    queryKey: ["kb", scope, tenantId ?? null],
    queryFn: () => list({ data: { scope, tenant_id: tenantId } }),
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ title: "", body_md: "", status: "draft" });

  const openNew = () => { setForm({ title: "", body_md: "", status: "draft" }); setOpen(true); };
  const openEdit = async (id: string) => {
    const a: any = await get({ data: { id } });
    setForm({ id: a.id, title: a.title, body_md: a.body_md, status: a.status });
    setOpen(true);
  };

  const mSave = useMutation({
    mutationFn: () => upsert({
      data: {
        id: form.id, scope, tenant_id: tenantId,
        title: form.title, body_md: form.body_md, status: form.status,
      },
    }),
    onSuccess: () => {
      toast.success("Saved");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["kb", scope, tenantId ?? null] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const mDel = useMutation({
    mutationFn: (id: string) => del({ data: { id } }),
    onSuccess: () => { toast.success("Deleted"); qc.invalidateQueries({ queryKey: ["kb", scope, tenantId ?? null] }); },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2"><BookOpen className="h-4 w-4" /> Knowledge base</CardTitle>
          <CardDescription>{scope === "platform" ? "Articles visible to all tenants." : "Articles visible only to members of this tenant."}</CardDescription>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button onClick={openNew}><Plus className="mr-1 h-4 w-4" />New article</Button></DialogTrigger>
          <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{form.id ? "Edit article" : "New article"}</DialogTitle></DialogHeader>
            <Tabs defaultValue="content" className="w-full">
              <TabsList>
                <TabsTrigger value="content">Content</TabsTrigger>
                <TabsTrigger value="steps" disabled={!form.id}>Steps & screenshots</TabsTrigger>
                <TabsTrigger value="preview" disabled={!form.id}>Preview</TabsTrigger>
              </TabsList>
              <TabsContent value="content" className="space-y-3">
                <div><Label>Title</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
                <div>
                  <Label>Body (markdown)</Label>
                  <Textarea value={form.body_md} rows={12} onChange={(e) => setForm({ ...form, body_md: e.target.value })} />
                </div>
                <div>
                  <Label>Status</Label>
                  <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="published">Published</SelectItem>
                      <SelectItem value="archived">Archived</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button className="w-full" onClick={() => mSave.mutate()} disabled={!form.title || mSave.isPending}>Save</Button>
                {!form.id && <p className="text-xs text-muted-foreground">Save the article first to add annotated screenshot steps.</p>}
              </TabsContent>
              <TabsContent value="steps">
                {form.id && <KbArticleStepEditor articleId={form.id} />}
              </TabsContent>
              <TabsContent value="preview">
                {form.id && <KbArticleReader articleId={form.id} />}
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Title</th>
              <th className="px-4 py-2">Slug</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Updated</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((a: any) => (
              <tr key={a.id} className="border-b">
                <td className="px-4 py-2 font-medium">{a.title}</td>
                <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{a.slug}</td>
                <td className="px-4 py-2"><Badge variant={a.status === "published" ? "default" : "outline"}>{a.status}</Badge></td>
                <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(a.updated_at).toLocaleString()}</td>
                <td className="px-4 py-2 text-right">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(a.id)}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => mDel.mutate(a.id)}><Trash2 className="h-4 w-4" /></Button>
                </td>
              </tr>
            ))}
            {q.data && q.data.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No articles yet. Example seed: “How Demo Bank Cash Ops triages Nostro breaks”, “FX cut-off rules for Demo Bank EMEA”.</td></tr>
            ) : null}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
