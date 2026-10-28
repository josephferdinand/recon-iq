import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { listKbSources, upsertKbSource } from "@/lib/mkt-admin.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/mkt-admin/knowledge")({
  component: KB,
});

function KB() {
  const qc = useQueryClient();
  const listFn = useServerFn(listKbSources);
  const upFn = useServerFn(upsertKbSource);
  const q = useQuery({ queryKey: ["mkt","kb"], queryFn: () => listFn({ data: undefined }) });
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const mut = useMutation({
    mutationFn: () => upFn({ data: { title, type: "text", content, tags: [] } }),
    onSuccess: () => { toast.success("KB source added"); setTitle(""); setContent(""); qc.invalidateQueries({ queryKey: ["mkt","kb"] }); },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Knowledge base</h1>
        <p className="text-sm text-muted-foreground">Content ReconIQ Copilot can retrieve from during conversations. Paste FAQs, product blurbs, or case-study text.</p>
      </div>

      <section className="rounded-lg border border-border bg-card p-5">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Add source</h3>
        <div className="grid gap-3">
          <div>
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. ReconIQ key differentiators vs incumbent vendors" />
          </div>
          <div>
            <Label>Content</Label>
            <Textarea rows={8} value={content} onChange={(e) => setContent(e.target.value)}
              placeholder="Paste article, FAQ, or feature description. Content is chunked automatically." />
          </div>
          <div>
            <Button disabled={!title.trim() || !content.trim() || mut.isPending} onClick={() => mut.mutate()}>Add source</Button>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-5 py-3 text-sm font-semibold">Sources ({q.data?.length ?? 0})</div>
        <ul className="divide-y divide-border">
          {(q.data ?? []).map((s) => (
            <li key={s.id} className="flex items-center justify-between px-5 py-3">
              <div>
                <div className="text-sm font-medium">{s.title}</div>
                <div className="text-xs text-muted-foreground">{s.type} · v{s.version}</div>
              </div>
              <Badge variant="outline">{s.status}</Badge>
            </li>
          ))}
          {(q.data ?? []).length === 0 && <li className="px-5 py-6 text-center text-sm text-muted-foreground">No sources yet.</li>}
        </ul>
      </section>
    </div>
  );
}
