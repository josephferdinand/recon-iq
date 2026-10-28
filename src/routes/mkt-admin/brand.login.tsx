import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { getBrandProfileAdmin, updateBrandProfileAdmin, type BrandProfile } from "@/lib/mkt-brand.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Save, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/mkt-admin/brand/login")({
  component: BrandLoginPage,
});

function BrandLoginPage() {
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
      <h2 className="font-semibold">Login & authentication branding</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <div><Label className="text-xs">Login page theme</Label><Input value={form.login_page_theme ?? ""} onChange={(e) => set("login_page_theme", e.target.value)} placeholder="default | midnight | executive" /></div>
        <div><Label className="text-xs">Login background URL</Label><Input value={form.login_background_url ?? ""} onChange={(e) => set("login_background_url", e.target.value)} placeholder="https://…" /></div>
      </div>
      <div>
        <Label className="text-xs">Welcome message</Label>
        <Textarea aria-label="Welcome message" value={form.login_welcome_message ?? ""} onChange={(e) => set("login_welcome_message", e.target.value)} rows={2} placeholder="Welcome back to ReconIQ." />
      </div>
      <div>
        <Label className="text-xs">Password reset message</Label>
        <Textarea aria-label="Password reset message" value={form.password_reset_message ?? ""} onChange={(e) => set("password_reset_message", e.target.value)} rows={2} />
      </div>
      <div>
        <Label className="text-xs">Registration message</Label>
        <Textarea aria-label="Registration message" value={form.registration_message ?? ""} onChange={(e) => set("registration_message", e.target.value)} rows={2} />
      </div>
      <p className="text-xs text-muted-foreground">Login logo and background image assets are managed under Brand assets.</p>
      <div className="flex justify-end">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save changes
        </Button>
      </div>
    </Card>
  );
}
