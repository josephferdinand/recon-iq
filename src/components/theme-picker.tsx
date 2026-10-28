import { Check, Loader2, RotateCcw, Save, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { toast } from "sonner";
import {
  CHROMES,
  FVI_FACTORY_PRESET,
  PALETTES,
  useTheme,
  type ChromeId,
  type ChromeMeta,
  type PaletteId,
} from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { getTenantBySlug } from "@/lib/tenants.functions";
import { getTenantTheme, setTenantTheme } from "@/lib/tenant-theme.functions";

export function ThemePicker({ className }: { className?: string }) {
  const {
    theme, setMode,
    palette, setPalette,
    chrome, setChrome,
    topChrome, setTopChrome,
    dualMode, setDualMode,
    applyRemote,
  } = useTheme();

  // We're inside a tenant context when /$slug/ is in the URL.
  const params = useParams({ strict: false }) as { slug?: string };
  const slug = params.slug;

  const fetchTenant = useServerFn(getTenantBySlug);
  const fetchTheme = useServerFn(getTenantTheme);
  const saveTheme = useServerFn(setTenantTheme);
  const qc = useQueryClient();

  const tenantQ = useQuery({
    queryKey: ["tenant-by-slug", slug],
    queryFn: () => fetchTenant({ data: { slug: slug! } }),
    enabled: !!slug,
    staleTime: 60_000,
  });
  const tenantId: string | undefined = (tenantQ.data as any)?.id;

  const themeQ = useQuery({
    queryKey: ["tenant-theme", tenantId],
    queryFn: () => fetchTheme({ data: { tenantId: tenantId! } }),
    enabled: !!tenantId,
    staleTime: 60_000,
  });

  const saveMut = useMutation({
    mutationFn: () =>
      saveTheme({
        data: {
          tenantId: tenantId!,
          paletteId: palette,
          sideChromeId: chrome,
          topChromeId: dualMode ? topChrome : chrome,
          dualMode,
        },
      }),
    onSuccess: () => {
      toast.success("Saved as tenant default", { description: "All members will see this theme on next login." });
      qc.invalidateQueries({ queryKey: ["tenant-theme", tenantId] });
    },
    onError: (e: any) => toast.error("Could not save", { description: e?.message ?? "Permission denied" }),
  });

  const loadDefault = () => {
    const r = themeQ.data as any;
    if (!r) return;
    applyRemote({
      palette: r.palette_id as PaletteId,
      chrome: r.side_chrome_id as ChromeId,
      topChrome: r.top_chrome_id as ChromeId,
      dualMode: !!r.dual_mode,
    });
    toast.success("Loaded tenant default");
  };

  /** Apply the built-in ReconIQ factory preset locally (no save). */
  const applyFactoryPreset = () => {
    applyRemote({ ...FVI_FACTORY_PRESET });
    toast.success("Reverted to ReconIQ factory preset", {
      description: "Preview only — click 'Save as tenant default' to make it the tenant default.",
    });
  };

  /** Reset the tenant default to the built-in ReconIQ factory preset in one click. */
  const resetTenantMut = useMutation({
    mutationFn: () =>
      saveTheme({
        data: {
          tenantId: tenantId!,
          paletteId: FVI_FACTORY_PRESET.palette,
          sideChromeId: FVI_FACTORY_PRESET.chrome,
          topChromeId: FVI_FACTORY_PRESET.topChrome,
          dualMode: FVI_FACTORY_PRESET.dualMode,
        },
      }),
    onSuccess: () => {
      applyRemote({ ...FVI_FACTORY_PRESET });
      toast.success("Tenant default reset to ReconIQ factory preset", {
        description: "All members will see the factory preset on next login.",
      });
      qc.invalidateQueries({ queryKey: ["tenant-theme", tenantId] });
    },
    onError: (e: any) =>
      toast.error("Could not reset tenant default", { description: e?.message ?? "Permission denied" }),
  });


  const sideMeta = useMemo(() => CHROMES.find((c) => c.id === chrome)!, [chrome]);
  const topMeta = useMemo(() => CHROMES.find((c) => c.id === (dualMode ? topChrome : chrome))!, [dualMode, topChrome, chrome]);
  const canvasMeta = useMemo(() => PALETTES.find((p) => p.id === palette)!, [palette]);

  return (
    <div className={cn("space-y-5", className)}>
      {/* Live preview */}
      <LivePreview top={topMeta} side={sideMeta} canvas={canvasMeta} dual={dualMode} />

      <section className="space-y-2" aria-labelledby="appearance-mode-label">
        <div id="appearance-mode-label" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Appearance
        </div>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label="Appearance mode">
          <Button type="button" variant={theme === "light" ? "default" : "outline"} onClick={() => setMode("light")} aria-pressed={theme === "light"}>
            Light
          </Button>
          <Button type="button" variant={theme === "dark" ? "default" : "outline"} onClick={() => setMode("dark")} aria-pressed={theme === "dark"}>
            Dark
          </Button>
        </div>
      </section>

      {/* Mode toggle */}
      <div className="flex items-center justify-between rounded-lg border bg-card px-3 py-2.5">
        <div className="min-w-0">
          <Label htmlFor="dual-mode-toggle" className="text-sm font-medium">Dual-tone navigation</Label>
          <p className="text-[11px] text-muted-foreground leading-snug">
            {dualMode ? "Top bar and side rail use different chromes." : "Top bar and side rail share one chrome."}
          </p>
        </div>
        <Switch
          id="dual-mode-toggle"
          checked={dualMode}
          onCheckedChange={(v) => setDualMode(!!v)}
          aria-label="Toggle dual-tone navigation"
        />
      </div>

      {/* Side rail chrome */}
      <ChromeSection
        title={dualMode ? "Side rail chrome" : "Navigation chrome"}
        value={chrome}
        onChange={setChrome}
      />

      {/* Top bar chrome — only meaningful in dual mode */}
      {dualMode && (
        <ChromeSection
          title="Top bar chrome"
          value={topChrome}
          onChange={setTopChrome}
        />
      )}

      {/* Canvas palette */}
      <section className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Canvas — workspace panel
        </div>
        <div className="grid grid-cols-2 gap-2">
          {PALETTES.map((p) => (
            <PaletteTile
              key={p.id}
              id={p.id}
              name={p.name}
              description={p.description}
              swatches={p.swatches}
              active={palette === p.id}
              onSelect={() => setPalette(p.id)}
            />
          ))}
        </div>
      </section>

      {/* Tenant default management */}
      {slug && tenantId && (
        <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Tenant default theme
            </div>
            <p className="text-[11px] leading-snug text-muted-foreground">
              The tenant default is applied to every member on first login and whenever they click
              <em> Reset to tenant default</em>. Tenant admins can change it below or roll back to
              ReconIQ's factory preset in one click.
            </p>
          </div>

          {/* Current saved default summary */}
          <div className="rounded-md border border-border/60 bg-background/60 p-2 text-[11px] text-muted-foreground">
            {themeQ.isLoading ? (
              <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" /> Loading current default…</span>
            ) : themeQ.data ? (
              <>
                <span className="text-foreground font-medium">Current default:</span>{" "}
                {(PALETTES.find((p) => p.id === (themeQ.data as any).palette_id)?.name) ?? (themeQ.data as any).palette_id}
                {" · "}
                {(CHROMES.find((c) => c.id === (themeQ.data as any).side_chrome_id)?.name) ?? (themeQ.data as any).side_chrome_id}
                {(themeQ.data as any).dual_mode ? (
                  <> {" / "} {(CHROMES.find((c) => c.id === (themeQ.data as any).top_chrome_id)?.name) ?? (themeQ.data as any).top_chrome_id} (dual)</>
                ) : null}
              </>
            ) : (
              <>No tenant default saved yet — members see the ReconIQ factory preset.</>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
              {saveMut.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
              Save current as tenant default
            </Button>
            <Button size="sm" variant="outline" onClick={loadDefault} disabled={!themeQ.data}>
              <Undo2 className="mr-1.5 h-3.5 w-3.5" />
              Revert my view to tenant default
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={applyFactoryPreset}
              title="Preview the ReconIQ factory preset without changing the tenant default"
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Preview ReconIQ factory preset
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                if (typeof window !== "undefined" &&
                  !window.confirm("Reset the tenant default to the ReconIQ factory preset? Every member will see it on next login.")) return;
                resetTenantMut.mutate();
              }}
              disabled={resetTenantMut.isPending}
              title="One-click reset — restore ReconIQ's factory preset as the tenant default"
            >
              {resetTenantMut.isPending
                ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
              Reset tenant default to factory preset
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ────────── Sections ────────── */

function ChromeSection({
  title, value, onChange,
}: {
  title: string;
  value: ChromeId;
  onChange: (c: ChromeId) => void;
}) {
  return (
    <section className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
      <div className="grid grid-cols-2 gap-2">
        {CHROMES.map((c) => (
          <ChromeTile key={c.id} meta={c} active={value === c.id} onSelect={() => onChange(c.id)} />
        ))}
      </div>
    </section>
  );
}

function ChromeTile({ meta, active, onSelect }: { meta: ChromeMeta; active: boolean; onSelect: () => void }) {
  const [bg, accent, brand, fg] = meta.swatches;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      aria-label={`Apply ${meta.name}`}
      data-chrome-id={meta.id}
      className={cn(
        "group relative flex flex-col gap-2 overflow-hidden rounded-lg border bg-card p-0 text-left transition-all hover:border-primary/60 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && "border-primary ring-2 ring-primary/30",
      )}
    >
      <div className="flex h-14 w-full" style={{ backgroundColor: bg, color: fg }}>
        <div className="flex w-9 flex-col items-center justify-start gap-1 py-1.5" style={{ borderRight: `1px solid ${accent}` }}>
          <span className="grid h-4 w-4 place-items-center rounded-sm text-[8px] font-bold" style={{ backgroundColor: brand, color: bg }}>F</span>
          <span className="h-1 w-5 rounded-full" style={{ backgroundColor: accent }} />
          <span className="h-1 w-5 rounded-full" style={{ backgroundColor: accent }} />
        </div>
        <div className="flex flex-1 items-center gap-1 px-2">
          <span className="h-1.5 w-10 rounded-full" style={{ backgroundColor: accent }} />
          <span className="ml-auto h-3 w-6 rounded-sm" style={{ backgroundColor: brand }} />
        </div>
      </div>
      <div className="flex items-center justify-between px-2.5 pt-0.5">
        <span className="text-sm font-medium leading-none">{meta.name}</span>
        {active && <Check className="h-3.5 w-3.5 text-primary" aria-hidden />}
      </div>
      <p className="line-clamp-2 px-2.5 pb-2.5 text-[11px] leading-snug text-muted-foreground">{meta.description}</p>
    </button>
  );
}

function PaletteTile({
  id, name, description, swatches, active, onSelect,
}: {
  id: PaletteId; name: string; description: string; swatches: string[];
  active: boolean; onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      aria-label={`Apply ${name} canvas`}
      className={cn(
        "group relative flex flex-col gap-2 rounded-lg border bg-card p-3 text-left transition-all hover:border-primary/60 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && "border-primary ring-2 ring-primary/30",
      )}
      data-palette-id={id}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium leading-none">{name}</span>
        {active && <Check className="h-3.5 w-3.5 text-primary" aria-hidden />}
      </div>
      <div className="flex h-6 w-full overflow-hidden rounded-md ring-1 ring-border">
        {swatches.map((c, i) => (
          <span key={i} className="flex-1" style={{ backgroundColor: c }} aria-hidden />
        ))}
      </div>
      <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{description}</p>
    </button>
  );
}

/* ────────── Live preview composing top + side + canvas ────────── */

function LivePreview({
  top, side, canvas, dual,
}: { top: ChromeMeta; side: ChromeMeta; canvas: PaletteMetaLite; dual: boolean }) {
  const [tBg, tAccent, tBrand, tFg] = top.swatches;
  const [sBg, sAccent, sBrand, sFg] = side.swatches;
  const [cBg, cAccent, _cInk, cBrandish] = canvas.swatches;
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Live preview</div>
        <div className="text-[10px] text-muted-foreground">
          {dual ? "Dual-tone" : "Single-tone"} · top {top.name} · side {side.name}
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border shadow-sm">
        {/* Top bar */}
        <div className="flex h-9 items-center gap-2 px-3" style={{ backgroundColor: tBg, color: tFg, borderBottom: `1px solid ${tAccent}` }}>
          <span className="grid h-5 w-5 place-items-center rounded text-[9px] font-bold" style={{ backgroundColor: tBrand, color: tBg }}>F</span>
          <span className="text-[11px] font-medium tracking-wide">ReconIQ · Workspace</span>
          <span className="ml-auto h-2 w-14 rounded-full" style={{ backgroundColor: tAccent }} />
          <span className="h-4 w-4 rounded-full" style={{ backgroundColor: tBrand }} />
        </div>
        <div className="flex h-28">
          {/* Side rail */}
          <div className="flex w-16 flex-col gap-1.5 px-2 py-2" style={{ backgroundColor: sBg, color: sFg, borderRight: `1px solid ${sAccent}` }}>
            <span className="h-1.5 w-full rounded-full" style={{ backgroundColor: sBrand }} />
            <span className="h-1.5 w-3/4 rounded-full" style={{ backgroundColor: sAccent }} />
            <span className="h-1.5 w-2/3 rounded-full" style={{ backgroundColor: sAccent }} />
            <span className="h-1.5 w-5/6 rounded-full" style={{ backgroundColor: sAccent }} />
            <span className="mt-auto h-1.5 w-1/2 rounded-full" style={{ backgroundColor: sAccent }} />
          </div>
          {/* Canvas */}
          <div className="flex flex-1 flex-col gap-2 p-3" style={{ backgroundColor: cBg }}>
            <div className="h-3 w-1/3 rounded-full" style={{ backgroundColor: cAccent }} />
            <div className="grid flex-1 grid-cols-3 gap-2">
              <div className="rounded-md ring-1" style={{ backgroundColor: "#ffffff", boxShadow: `inset 0 0 0 1px ${cAccent}` }} />
              <div className="rounded-md ring-1" style={{ backgroundColor: "#ffffff", boxShadow: `inset 0 0 0 1px ${cAccent}` }} />
              <div className="rounded-md ring-1 grid place-items-end p-1.5" style={{ backgroundColor: "#ffffff", boxShadow: `inset 0 0 0 1px ${cAccent}` }}>
                <span className="h-2 w-6 rounded-sm" style={{ backgroundColor: cBrandish }} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

type PaletteMetaLite = { swatches: string[] };
