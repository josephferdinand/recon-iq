import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { getBrandProfileAdmin, updateBrandProfileAdmin, type BrandProfile } from "@/lib/mkt-brand.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import { Save, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/mkt-admin/brand/identity")({
  component: BrandIdentityPage,
});

function BrandIdentityPage() {
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
    <Card className="p-6 space-y-6">
      <div>
        <h2 className="mb-4 font-semibold">Application identity</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <F label="Browser tab name" v={form.browser_tab_name} onChange={(v) => set("browser_tab_name", v)} placeholder="ReconIQ — Reconciliation" />
          <F label="Page title template" v={form.page_title_template} onChange={(v) => set("page_title_template", v)} placeholder="%s · ReconIQ" />
          <F label="Application name" v={form.application_name} onChange={(v) => set("application_name", v)} />
          <F label="Header branding" v={form.header_branding} onChange={(v) => set("header_branding", v)} />
          <F label="Footer branding" v={form.footer_branding} onChange={(v) => set("footer_branding", v)} />
          <F label="Copyright text" v={form.copyright_text} onChange={(v) => set("copyright_text", v)} placeholder="© 2026 ReconIQ" />
          <F label="Powered by text" v={form.powered_by_text} onChange={(v) => set("powered_by_text", v)} />
          <div className="flex items-center gap-3 pt-6">
            <Switch aria-label="Show build version in footer" checked={form.show_version} onCheckedChange={(v) => set("show_version", v)} />
            <Label>Show build version in footer</Label>
          </div>
        </div>
        <div className="mt-4">
          <Label className="text-xs">Legal notices</Label>
          <Textarea aria-label="Application legal notices" value={form.legal_notices ?? ""} onChange={(e) => set("legal_notices", e.target.value)} rows={4} />
        </div>
      </div>
      <div className="flex justify-end">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save changes
        </Button>
      </div>
    </Card>
  );
}
function F({ label, v, onChange, placeholder }: { label: string; v: string | null; onChange: (s: string) => void; placeholder?: string }) {
  return (<div><Label className="text-xs">{label}</Label><Input aria-label={label} value={v ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} /></div>);
}
