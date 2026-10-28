import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getTenantBranding, upsertTenantBranding } from "@/lib/tenant-branding.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Copy, Upload, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";

type FormState = {
  logo_url: string | null;
  primary_hex: string;
  accent_hex: string;
  surface_hex: string;
  ink_hex: string;
  headline: string;
  tagline: string;
  support_email: string;
  support_url: string;
  enabled: boolean;
};

const DEFAULTS: FormState = {
  logo_url: null,
  primary_hex: "#3B2A1F",
  accent_hex: "#C9A24B",
  surface_hex: "#F5EFE3",
  ink_hex: "#1A120B",
  headline: "Welcome back",
  tagline: "Reconciliation, verified by intelligence.",
  support_email: "",
  support_url: "",
  enabled: false,
};

export function BrandingTab({
  tenantId,
  tenantSlug,
  canWrite,
}: {
  tenantId: string;
  tenantSlug: string;
  canWrite: boolean;
}) {
  const qc = useQueryClient();
  const get = useServerFn(getTenantBranding);
  const save = useServerFn(upsertTenantBranding);
  const [form, setForm] = useState<FormState>(DEFAULTS);

  const q = useQuery({
    queryKey: ["tenant-branding", tenantId],
    queryFn: () => get({ data: { tenantId } }),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (q.data) {
      setForm({
        logo_url: (q.data as any).logo_url ?? null,
        primary_hex: (q.data as any).primary_hex ?? DEFAULTS.primary_hex,
        accent_hex: (q.data as any).accent_hex ?? DEFAULTS.accent_hex,
        surface_hex: (q.data as any).surface_hex ?? DEFAULTS.surface_hex,
        ink_hex: (q.data as any).ink_hex ?? DEFAULTS.ink_hex,
        headline: (q.data as any).headline ?? "",
        tagline: (q.data as any).tagline ?? "",
        support_email: (q.data as any).support_email ?? "",
        support_url: (q.data as any).support_url ?? "",
        enabled: !!(q.data as any).enabled,
      });
    }
  }, [q.data]);

  const m = useMutation({
    mutationFn: () =>
      save({
        data: {
          tenantId,
          logo_url: form.logo_url,
          primary_hex: form.primary_hex,
          accent_hex: form.accent_hex,
          surface_hex: form.surface_hex,
          ink_hex: form.ink_hex,
          headline: form.headline || null,
          tagline: form.tagline || null,
          support_email: form.support_email || null,
          support_url: form.support_url || null,
          enabled: form.enabled,
        },
      }),
    onSuccess: () => {
      toast.success("Branding saved");
      qc.invalidateQueries({ queryKey: ["tenant-branding", tenantId] });
    },
    onError: (e: any) => toast.error(e.message ?? "Save failed"),
  });

  const url = useMemo(
    () => (typeof window !== "undefined" ? `${window.location.origin}/t/${tenantSlug}/auth` : `/t/${tenantSlug}/auth`),
    [tenantSlug],
  );

  const onLogoFile = async (file: File | null) => {
    if (!file) return;
    if (file.size > 150_000) return toast.error("Logo must be under 150 KB");
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, logo_url: String(reader.result) }));
    reader.readAsDataURL(file);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>White-label sign-in</CardTitle>
          <CardDescription>
            Custom branded login at <code className="rounded bg-muted px-1.5 py-0.5">/t/{tenantSlug}/auth</code>.
            Public marketing and the ReconIQ sign-in stay on the ReconIQ brand.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <div className="font-medium">Publish branding</div>
              <p className="text-xs text-muted-foreground">When off, your tenant URL renders the ReconIQ palette.</p>
            </div>
            <Switch checked={form.enabled} disabled={!canWrite} onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))} />
          </div>

          <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs">
            <code className="truncate">{url}</code>
            <div className="flex shrink-0 gap-1">
              <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(url); toast.success("Copied"); }}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <a href={url} target="_blank" rel="noreferrer">
                <Button size="sm" variant="ghost"><ExternalLink className="h-3.5 w-3.5" /></Button>
              </a>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Logo</Label>
            <div className="flex items-center gap-3">
              <div className="grid h-16 w-16 place-items-center overflow-hidden rounded-md border bg-muted/40">
                {form.logo_url ? (
                  <img src={form.logo_url} alt="Logo" className="h-full w-full object-contain" />
                ) : (
                  <span className="text-[10px] text-muted-foreground">No logo</span>
                )}
              </div>
              <label className="cursor-pointer">
                <input type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp" className="hidden" disabled={!canWrite}
                       onChange={(e) => onLogoFile(e.target.files?.[0] ?? null)} />
                <span className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs hover:bg-muted">
                  <Upload className="h-3.5 w-3.5" /> Upload (≤150 KB)
                </span>
              </label>
              {form.logo_url ? (
                <Button size="sm" variant="ghost" disabled={!canWrite} onClick={() => setForm((f) => ({ ...f, logo_url: null }))}>
                  Remove
                </Button>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ["primary_hex", "Primary"],
                ["accent_hex", "Accent"],
                ["surface_hex", "Surface"],
                ["ink_hex", "Ink"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="space-y-1.5">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
                <div className="flex items-center gap-2">
                  <Input type="color" value={form[key]} disabled={!canWrite}
                         onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                         className="h-10 w-14 cursor-pointer p-1" />
                  <Input value={form[key]} disabled={!canWrite}
                         onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                         className="h-10 font-mono text-xs" />
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Headline</Label>
            <Input value={form.headline} disabled={!canWrite} maxLength={120}
                   onChange={(e) => setForm((f) => ({ ...f, headline: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">Tagline</Label>
            <Textarea value={form.tagline} disabled={!canWrite} maxLength={280} rows={2}
                      onChange={(e) => setForm((f) => ({ ...f, tagline: e.target.value }))} />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Support email</Label>
              <Input type="email" value={form.support_email} disabled={!canWrite}
                     onChange={(e) => setForm((f) => ({ ...f, support_email: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Support URL</Label>
              <Input type="url" value={form.support_url} disabled={!canWrite} placeholder="e.g. https://api.demo-bank.example/v1/nostro"
                     onChange={(e) => setForm((f) => ({ ...f, support_url: e.target.value }))} />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button disabled={!canWrite || m.isPending} onClick={() => m.mutate()}>
              {m.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save branding
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Live preview */}
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Preview</CardTitle>
          <CardDescription>Approximate render of your branded sign-in.</CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className="grid h-[420px] w-full grid-cols-[1.1fr_1fr] overflow-hidden rounded-lg border"
            style={{ background: `linear-gradient(90deg, ${form.primary_hex} 56%, ${form.surface_hex} 56%)` }}
          >
            <div className="flex flex-col justify-between p-5" style={{ color: form.surface_hex }}>
              <div className="flex items-center gap-3">
                {form.logo_url ? (
                  <img src={form.logo_url} alt="" className="h-12 w-12 rounded bg-white/5 object-contain p-1 ring-1 ring-white/15" />
                ) : (
                  <div className="grid h-12 w-12 place-items-center rounded bg-white/10 text-xs">Logo</div>
                )}
                <div className="text-[10px] font-semibold uppercase tracking-[0.3em]" style={{ color: form.accent_hex }}>
                  Secure sign-in
                </div>
              </div>
              <div>
                <div className="font-display text-xl font-semibold">{form.headline || "Welcome back"}</div>
                <p className="mt-1 text-[11px] opacity-80">{form.tagline || "Tagline preview"}</p>
              </div>
              <Badge variant="outline" className="w-fit border-white/30 text-[10px]" style={{ color: form.accent_hex }}>
                /t/{tenantSlug}/auth
              </Badge>
            </div>
            <div className="m-4 rounded-lg p-4 text-xs" style={{ background: form.surface_hex, color: form.ink_hex }}>
              <div className="font-display text-base font-semibold">Sign in</div>
              <div className="mt-3 h-8 rounded border" style={{ borderColor: `color-mix(in oklab, ${form.primary_hex} 20%, transparent)` }} />
              <div className="mt-2 h-8 rounded border" style={{ borderColor: `color-mix(in oklab, ${form.primary_hex} 20%, transparent)` }} />
              <div className="mt-3 grid h-8 place-items-center rounded text-[11px] font-semibold"
                   style={{ background: form.primary_hex, color: form.surface_hex }}>
                Sign In
              </div>
              <div className="mt-2 grid h-8 place-items-center rounded border text-[11px]"
                   style={{ borderColor: `color-mix(in oklab, ${form.primary_hex} 25%, transparent)` }}>
                Continue with Google
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
