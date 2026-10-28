import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { getBrandProfileAdmin, updateBrandProfileAdmin, type BrandProfile } from "@/lib/mkt-brand.functions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Save, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/mkt-admin/brand/communications")({
  component: BrandCommsPage,
});

function BrandCommsPage() {
  const getFn = useServerFn(getBrandProfileAdmin);
  const saveFn = useServerFn(updateBrandProfileAdmin);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["mkt","brand","profile"], queryFn: () => getFn({ data: undefined }) });
  const [form, setForm] = useState<BrandProfile | null>(null);
  useEffect(() => { if (q.data) setForm(q.data); }, [q.data]);
  const save = useMutation({
    mutationFn: () => saveFn({ data: form as never }),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["mkt","brand"] }); qc.invalidateQueries({ queryKey: ["published-brand"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!form) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;
  const set = <K extends keyof BrandProfile>(k: K, v: BrandProfile[K]) => setForm({ ...form, [k]: v });
  return (
    <Card className="p-6 space-y-5">
      <h2 className="font-semibold">Communications branding</h2>
      <p className="text-sm text-muted-foreground">Applied to emails, notifications, PDFs, statements, invoices, certificates, and exports.</p>
      <div>
        <Label className="text-xs">Email signature (HTML)</Label>
        <Textarea aria-label="Email signature HTML" value={form.email_signature_html ?? ""} onChange={(e) => set("email_signature_html", e.target.value)} rows={5} className="font-mono text-xs" />
      </div>
      <div>
        <Label className="text-xs">Email footer text</Label>
        <Textarea aria-label="Email footer text" value={form.email_footer_text ?? ""} onChange={(e) => set("email_footer_text", e.target.value)} rows={3} />
      </div>
      <div>
        <Label className="text-xs">Legal disclaimer (emails, PDFs)</Label>
        <Textarea aria-label="Email and PDF legal disclaimer" value={form.email_legal_disclaimer ?? ""} onChange={(e) => set("email_legal_disclaimer", e.target.value)} rows={4} />
      </div>
      <div className="flex justify-end">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save changes
        </Button>
      </div>
    </Card>
  );
}
