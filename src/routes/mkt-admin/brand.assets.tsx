import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { listBrandAssetsAdmin, registerBrandAssetAdmin, publishBrandAssetAdmin, deleteBrandAssetAdmin, type BrandAsset } from "@/lib/mkt-brand.functions";
import { requestBrandApproval, myBrandWorkflowRoles } from "@/lib/mkt-brand-approvals.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Upload, Trash2, CheckCircle2, Loader2, GitPullRequest } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/mkt-admin/brand/assets")({
  component: BrandAssetsPage,
});

const SLOTS = [
  { value: "primary_logo", label: "Primary logo" },
  { value: "secondary_logo", label: "Secondary logo" },
  { value: "dark_logo", label: "Dark-mode logo" },
  { value: "light_logo", label: "Light-mode logo" },
  { value: "login_logo", label: "Login screen logo" },
  { value: "mobile_logo", label: "Mobile logo" },
  { value: "favicon", label: "Favicon" },
  { value: "email_header_logo", label: "Email header logo" },
  { value: "email_footer_logo", label: "Email footer logo" },
  { value: "document_watermark", label: "Document watermark" },
  { value: "partner_logo", label: "Partner logo" },
  { value: "white_label_logo", label: "White-label logo" },
] as const;

function BrandAssetsPage() {
  const listFn = useServerFn(listBrandAssetsAdmin);
  const regFn = useServerFn(registerBrandAssetAdmin);
  const pubFn = useServerFn(publishBrandAssetAdmin);
  const delFn = useServerFn(deleteBrandAssetAdmin);
  const requestFn = useServerFn(requestBrandApproval);
  const rolesFn = useServerFn(myBrandWorkflowRoles);
  const qc = useQueryClient();
  const [slot, setSlot] = useState<typeof SLOTS[number]["value"]>("primary_logo");
  const [publishNow, setPublishNow] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const q = useQuery({ queryKey: ["mkt","brand","assets"], queryFn: () => listFn({ data: undefined }) });
  const rolesQ = useQuery({ queryKey: ["mkt","brand","approvals","me"], queryFn: () => rolesFn({ data: undefined }) });
  const canDirectPublish = !!rolesQ.data?.canPublish;

  const onFile = async (file: File) => {
    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() ?? "png").toLowerCase();
      const path = `${slot}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("brand-assets").upload(path, file, {
        contentType: file.type, upsert: false,
      });
      if (upErr) throw upErr;
      await regFn({ data: { slot, storage_path: path, content_type: file.type, size_bytes: file.size, publish: publishNow } });
      toast.success(publishNow ? "Uploaded & published" : "Uploaded as draft");
      qc.invalidateQueries({ queryKey: ["mkt","brand"] });
      qc.invalidateQueries({ queryKey: ["published-brand"] });
    } catch (e) { toast.error((e as Error).message); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const grouped = new Map<string, BrandAsset[]>();
  for (const a of q.data ?? []) {
    const arr = grouped.get(a.slot) ?? []; arr.push(a); grouped.set(a.slot, arr);
  }

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[220px]">
            <Label className="text-xs">Slot</Label>
            <Select value={slot} onValueChange={(v) => setSlot(v as typeof slot)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SLOTS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={publishNow} onCheckedChange={setPublishNow} /> Publish immediately
          </label>
          <div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            <Button onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Upload asset
            </Button>
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        {SLOTS.map(({ value, label }) => {
          const assets = grouped.get(value) ?? [];
          return (
            <Card key={value} className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold">{label}</h3>
                <Badge variant="secondary">{assets.length} version{assets.length === 1 ? "" : "s"}</Badge>
              </div>
              {assets.length === 0 ? (
                <p className="text-sm text-muted-foreground">No asset uploaded for this slot.</p>
              ) : (
                <div className="grid gap-3 md:grid-cols-3">
                  {assets.map((a) => (
                    <div key={a.id} className={`relative rounded-lg border p-3 ${a.is_published ? "border-primary/60 bg-primary/5" : "border-border/60"}`}>
                      <div className="flex h-24 items-center justify-center overflow-hidden rounded bg-muted/40">
                        <img src={a.public_url} alt={a.slot} className="max-h-full max-w-full object-contain" />
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                        <span>v{a.version} · {new Date(a.created_at).toLocaleDateString()}</span>
                        {a.is_published && <Badge className="h-5 text-[10px]"><CheckCircle2 className="mr-1 h-3 w-3" />Live</Badge>}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {!a.is_published && (
                          <>
                            <Button size="sm" variant="secondary" className="flex-1"
                              onClick={async () => {
                                try {
                                  await requestFn({ data: {
                                    subject_type: "asset", subject_id: a.id, action: "publish",
                                    title: `Publish ${a.slot} v${a.version}`,
                                    notes: `Requested from Brand Assets · slot ${a.slot}`,
                                    payload: {},
                                  } });
                                  toast.success("Submitted for review");
                                  qc.invalidateQueries({ queryKey: ["mkt","brand","approvals"] });
                                } catch (e) { toast.error((e as Error).message); }
                              }}>
                              <GitPullRequest className="mr-1 h-3 w-3" /> Submit
                            </Button>
                            {canDirectPublish && (
                              <Button size="sm" variant="outline" className="flex-1"
                                onClick={async () => { await pubFn({ data: { id: a.id } }); toast.success("Published"); qc.invalidateQueries({ queryKey: ["mkt","brand"] }); qc.invalidateQueries({ queryKey: ["published-brand"] }); }}>
                                Publish
                              </Button>
                            )}
                          </>
                        )}
                        <Button size="sm" variant="ghost" className="text-destructive"
                          onClick={async () => {
                            if (!confirm("Delete this asset version?")) return;
                            await delFn({ data: { id: a.id } }); toast.success("Deleted");
                            qc.invalidateQueries({ queryKey: ["mkt","brand"] });
                          }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
