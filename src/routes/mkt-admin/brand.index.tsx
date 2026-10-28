import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { getBrandProfileAdmin, updateBrandProfileAdmin, publishBrandProfileAdmin, type BrandProfile } from "@/lib/mkt-brand.functions";
import { requestBrandApproval, myBrandWorkflowRoles } from "@/lib/mkt-brand-approvals.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Save, CloudUpload, Loader2, GitPullRequest } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/mkt-admin/brand/")({
  component: BrandProfilePage,
});

const SOCIAL_KEYS = ["linkedin","twitter","x","facebook","instagram","youtube","github"];

function BrandProfilePage() {
  const getFn = useServerFn(getBrandProfileAdmin);
  const saveFn = useServerFn(updateBrandProfileAdmin);
  const pubFn = useServerFn(publishBrandProfileAdmin);
  const requestFn = useServerFn(requestBrandApproval);
  const rolesFn = useServerFn(myBrandWorkflowRoles);
  const qc = useQueryClient();

  const q = useQuery({ queryKey: ["mkt","brand","profile"], queryFn: () => getFn({ data: undefined }) });
  const rolesQ = useQuery({ queryKey: ["mkt","brand","approvals","me"], queryFn: () => rolesFn({ data: undefined }) });
  const [form, setForm] = useState<BrandProfile | null>(null);
  useEffect(() => { if (q.data) setForm(q.data); }, [q.data]);

  const save = useMutation({
    mutationFn: () => saveFn({ data: form as never }),
    onSuccess: () => { toast.success("Draft saved"); qc.invalidateQueries({ queryKey: ["mkt","brand"] }); qc.invalidateQueries({ queryKey: ["published-brand"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const publish = useMutation({
    mutationFn: () => pubFn({ data: { id: form!.id } }),
    onSuccess: () => { toast.success("Published live"); qc.invalidateQueries({ queryKey: ["mkt","brand"] }); qc.invalidateQueries({ queryKey: ["published-brand"] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const requestReview = useMutation({
    mutationFn: () => requestFn({ data: {
      subject_type: "profile", subject_id: form!.id, action: "publish",
      title: `Publish brand profile v${form!.version}`,
      notes: `Requested from Brand Profile editor · draft version ${form!.version}`,
      payload: {},
    } }),
    onSuccess: () => { toast.success("Submitted for review"); qc.invalidateQueries({ queryKey: ["mkt","brand","approvals"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (q.isLoading || !form) return <div className="p-8 text-sm text-muted-foreground">Loading brand profile…</div>;
  const set = <K extends keyof BrandProfile>(k: K, v: BrandProfile[K]) => setForm({ ...form, [k]: v });
  const canDirectPublish = !!rolesQ.data?.canPublish;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Badge variant={form.status === "published" ? "default" : "secondary"}>{form.status}</Badge>
          <span className="text-xs text-muted-foreground">v{form.version} · updated {new Date(form.updated_at).toLocaleString()}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />} Save draft
          </Button>
          <Button variant="secondary" onClick={() => requestReview.mutate()} disabled={requestReview.isPending}>
            {requestReview.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GitPullRequest className="mr-2 h-4 w-4" />} Submit for approval
          </Button>
          {canDirectPublish && (
            <Button onClick={() => publish.mutate()} disabled={publish.isPending} title="Publisher role — bypasses workflow">
              {publish.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CloudUpload className="mr-2 h-4 w-4" />} Publish live
            </Button>
          )}
        </div>
      </div>

      <Card className="p-6">
        <h2 className="mb-4 font-semibold">Company & product</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Company name" value={form.company_name} onChange={(v) => set("company_name", v)} />
          <Field label="Trading name" value={form.trading_name} onChange={(v) => set("trading_name", v)} />
          <Field label="Brand name" value={form.brand_name} onChange={(v) => set("brand_name", v)} />
          <Field label="Short name" value={form.short_name} onChange={(v) => set("short_name", v)} />
          <Field label="Platform name" value={form.platform_name} onChange={(v) => set("platform_name", v)} />
          <Field label="Product name" value={form.product_name} onChange={(v) => set("product_name", v)} />
          <Field label="Product suite name" value={form.product_suite_name} onChange={(v) => set("product_suite_name", v)} />
          <Field label="Tagline" value={form.tagline} onChange={(v) => set("tagline", v)} />
          <Field label="Motto" value={form.motto} onChange={(v) => set("motto", v)} />
        </div>
        <div className="mt-4 grid gap-4">
          <TextField label="Mission statement" value={form.mission_statement} onChange={(v) => set("mission_statement", v)} />
          <TextField label="Vision statement" value={form.vision_statement} onChange={(v) => set("vision_statement", v)} />
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="mb-4 font-semibold">Contact & links</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Website URL" value={form.website_url} onChange={(v) => set("website_url", v)} placeholder="https://…" />
          <Field label="Support URL" value={form.support_url} onChange={(v) => set("support_url", v)} placeholder="https://…" />
          <Field label="Help center URL" value={form.help_center_url} onChange={(v) => set("help_center_url", v)} placeholder="https://…" />
          <Field label="Contact email" value={form.contact_email} onChange={(v) => set("contact_email", v)} placeholder="support@…" />
          <Field label="Contact phone" value={form.contact_phone} onChange={(v) => set("contact_phone", v)} placeholder="+1 555…" />
        </div>
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-medium">Social media</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {SOCIAL_KEYS.map((k) => (
              <div key={k}>
                <Label className="text-xs capitalize">{k}</Label>
                <Input aria-label={`${k} social media URL`} value={form.social_links?.[k] ?? ""} onChange={(e) =>
                  set("social_links", { ...(form.social_links ?? {}), [k]: e.target.value })
                } placeholder={`https://${k}.com/…`} />
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string | null; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}
function TextField({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string) => void }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Textarea aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value)} rows={3} />
    </div>
  );
}
