import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { listThemePalettes } from "@/lib/platform-gap.functions";
import { getUiPreferences, updateUiPreferences } from "@/lib/ui-prefs.functions";

type PaletteTokens = {
  background?: string;
  foreground?: string;
  primary?: string;
  accent?: string;
};

type PaletteRow = {
  id: string;
  slug: string;
  display_name: string;
  mode: "light" | "dark";
  is_default: boolean;
  sort_order: number;
  tokens: PaletteTokens;
};

const TOKEN_VARS: Array<keyof PaletteTokens> = ["background", "foreground", "primary", "accent"];

function applyTokens(tokens: PaletteTokens | null | undefined) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const k of TOKEN_VARS) {
    const cssVar = `--${k}`;
    const v = tokens?.[k];
    if (v) root.style.setProperty(cssVar, v);
    else root.style.removeProperty(cssVar);
  }
}

/**
 * In-app theme switcher backed by seeded rows in `platform_theme_palettes`.
 * Selection persists to `user_ui_preferences.palette_slug` and is re-applied
 * on load. Tokens are pushed into shadcn's `--background/--foreground/
 * --primary/--accent` CSS variables at runtime.
 */
export function SeededPaletteSwitcher({ className }: { className?: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listThemePalettes);
  const prefsFn = useServerFn(getUiPreferences);
  const saveFn = useServerFn(updateUiPreferences);

  const palettesQ = useQuery({
    queryKey: ["platform-theme-palettes"],
    queryFn: () => listFn(),
    staleTime: 5 * 60_000,
  });
  const prefsQ = useQuery({
    queryKey: ["ui-prefs"],
    queryFn: () => prefsFn(),
    staleTime: 60_000,
  });

  const palettes = (palettesQ.data ?? []) as PaletteRow[];
  const selectedSlug = (prefsQ.data as any)?.palette_slug ?? null;
  const selected = useMemo(
    () => palettes.find((p) => p.slug === selectedSlug) ?? null,
    [palettes, selectedSlug],
  );

  // Reapply tokens whenever the persisted selection changes.
  useEffect(() => {
    if (selected) applyTokens(selected.tokens);
  }, [selected]);

  const saveMut = useMutation({
    mutationFn: (slug: string | null) => saveFn({ data: { palette_slug: slug } }),
    onSuccess: (_r, slug) => {
      qc.invalidateQueries({ queryKey: ["ui-prefs"] });
      toast.success(slug ? "Palette saved" : "Palette cleared", {
        description: slug ? "It will be reapplied on every device." : "Reverted to the app default.",
      });
    },
    onError: (e: any) => toast.error("Could not save palette", { description: e?.message ?? "" }),
  });

  const onSelect = (p: PaletteRow) => {
    applyTokens(p.tokens);
    saveMut.mutate(p.slug);
  };
  const onClear = () => {
    applyTokens(null);
    saveMut.mutate(null);
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Platform palettes
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            Seeded palettes managed by your platform administrator. Applied instantly across the app.
          </p>
        </div>
        {selectedSlug ? (
          <Button size="sm" variant="ghost" onClick={onClear} disabled={saveMut.isPending}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Reset
          </Button>
        ) : null}
      </div>

      {palettesQ.isLoading ? (
        <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading palettes…
        </div>
      ) : palettes.length === 0 ? (
        <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          No palettes seeded yet.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {palettes.map((p) => {
            const active = p.slug === selectedSlug;
            const tokens = p.tokens ?? {};
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelect(p)}
                disabled={saveMut.isPending}
                className={cn(
                  "group relative flex flex-col gap-1.5 rounded-lg border bg-card p-2 text-left transition",
                  "hover:border-primary/60 hover:shadow-sm",
                  active && "border-primary ring-1 ring-primary/40",
                )}
                aria-pressed={active}
              >
                <div className="flex items-center gap-1">
                  {TOKEN_VARS.map((k) => (
                    <span
                      key={k}
                      className="h-4 w-4 rounded border border-border/60"
                      style={{ background: tokens[k] ?? "transparent" }}
                      title={`${k}: ${tokens[k] ?? "—"}`}
                    />
                  ))}
                  {active ? (
                    <Check className="ml-auto h-3.5 w-3.5 text-primary" aria-hidden />
                  ) : null}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-foreground">{p.display_name}</span>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {p.mode}
                    {p.is_default ? " · default" : ""}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Mount once near the app root so the saved seeded palette is applied on every
 * page load before the user opens the switcher.
 */
export function SeededPaletteApplier() {
  const prefsFn = useServerFn(getUiPreferences);
  const listFn = useServerFn(listThemePalettes);
  const prefsQ = useQuery({
    queryKey: ["ui-prefs"],
    queryFn: () => prefsFn(),
    staleTime: 60_000,
    retry: false,
  });
  const palettesQ = useQuery({
    queryKey: ["platform-theme-palettes"],
    queryFn: () => listFn(),
    staleTime: 5 * 60_000,
    enabled: !!(prefsQ.data as any)?.palette_slug,
    retry: false,
  });
  useEffect(() => {
    const slug = (prefsQ.data as any)?.palette_slug;
    if (!slug) return;
    const rows = (palettesQ.data ?? []) as PaletteRow[];
    const match = rows.find((p) => p.slug === slug);
    if (match) applyTokens(match.tokens);
  }, [prefsQ.data, palettesQ.data]);
  return null;
}
