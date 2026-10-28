import { createFileRoute, redirect } from "@tanstack/react-router";
import { assertMktRolesFn } from "@/lib/mkt-admin.functions";
import { MKT_TAB_ROLES } from "@/lib/mkt-admin-roles";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  listSiteThemes,
  upsertSiteTheme,
  activateSiteTheme,
  archiveSiteTheme,
  listThemeVersions,
  rollbackSiteTheme,
  type SiteTheme,
  type ThemeTokens,
  type DarkThemeTokens,
} from "@/lib/mkt-site-themes.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Palette, Play, Archive, Eye, Save, Copy, History, Undo2, Moon, Sun } from "lucide-react";

export const Route = createFileRoute("/mkt-admin/themes")({
  beforeLoad: async () => {
    try {
      await assertMktRolesFn({ data: { allowed: MKT_TAB_ROLES.themes } });
    } catch {
      throw redirect({ to: "/mkt-admin" });
    }
  },
  component: ThemesPage,
});

const DEFAULT_TOKENS: ThemeTokens = {
  primary: "#1E4E8C",
  secondary: "#EAF4FF",
  accent: "#4DA3FF",
  background: "#F8FBFF",
  foreground: "#0B1F3A",
  button_style: "solid",
  radius: "0.75rem",
  display_font: "Space Grotesk",
  body_font: "DM Sans",
};

const DEFAULT_DARK: DarkThemeTokens = {
  primary: "#4DA3FF",
  secondary: "#111827",
  accent: "#38BDF8",
  background: "#0B1220",
  foreground: "#F8FAFC",
};

type Preset = { label: string; kind: "light" | "dark"; tokens: ThemeTokens; dark: DarkThemeTokens };

const PRESETS: Preset[] = [
  // ---------- 4 LIGHT ----------
  {
    label: "Executive Blue", kind: "light",
    tokens: DEFAULT_TOKENS,
    dark: DEFAULT_DARK,
  },
  {
    label: "Modern Platinum", kind: "light",
    tokens: {
      primary: "#2D3748", secondary: "#F7FAFC", accent: "#38B2AC",
      background: "#FFFFFF", foreground: "#1A202C",
      button_style: "solid", radius: "0.5rem",
      display_font: "Space Grotesk", body_font: "DM Sans",
    },
    dark: { primary: "#81E6D9", secondary: "#1A202C", accent: "#38B2AC",
            background: "#0F172A", foreground: "#F7FAFC" },
  },
  {
    label: "Sovereign Ivory", kind: "light",
    tokens: {
      primary: "#7C2D12", secondary: "#FEF3C7", accent: "#C2410C",
      background: "#FFFBEB", foreground: "#1C1917",
      button_style: "solid", radius: "0.375rem",
      display_font: "Fraunces", body_font: "Inter",
    },
    dark: { primary: "#FDBA74", secondary: "#292524", accent: "#FB923C",
            background: "#1C1917", foreground: "#FAFAF9" },
  },
  {
    label: "Verdant Trust", kind: "light",
    tokens: {
      primary: "#047857", secondary: "#ECFDF5", accent: "#10B981",
      background: "#F8FAF9", foreground: "#0F172A",
      button_style: "soft", radius: "1rem",
      display_font: "Space Grotesk", body_font: "DM Sans",
    },
    dark: { primary: "#34D399", secondary: "#0F1F1A", accent: "#10B981",
            background: "#0A1512", foreground: "#ECFDF5" },
  },

  // ---------- 4 DARK ----------
  {
    label: "Midnight Aurora", kind: "dark",
    tokens: {
      primary: "#818CF8", secondary: "#1E1B4B", accent: "#22D3EE",
      background: "#0B1020", foreground: "#E0E7FF",
      button_style: "solid", radius: "0.75rem",
      display_font: "Space Grotesk", body_font: "DM Sans",
    },
    dark: { primary: "#A5B4FC", secondary: "#1E1B4B", accent: "#22D3EE",
            background: "#0B1020", foreground: "#E0E7FF" },
  },
  {
    label: "Obsidian Gold", kind: "dark",
    tokens: {
      primary: "#F59E0B", secondary: "#1F2937", accent: "#FCD34D",
      background: "#0A0A0A", foreground: "#FAFAF9",
      button_style: "outline", radius: "0.25rem",
      display_font: "Fraunces", body_font: "Inter",
    },
    dark: { primary: "#FBBF24", secondary: "#111827", accent: "#F59E0B",
            background: "#0A0A0A", foreground: "#FAFAF9" },
  },
  {
    label: "Cyber Slate", kind: "dark",
    tokens: {
      primary: "#22D3EE", secondary: "#0F172A", accent: "#A78BFA",
      background: "#020617", foreground: "#F1F5F9",
      button_style: "solid", radius: "0.5rem",
      display_font: "Space Grotesk", body_font: "JetBrains Mono",
    },
    dark: { primary: "#67E8F9", secondary: "#0F172A", accent: "#C4B5FD",
            background: "#020617", foreground: "#F1F5F9" },
  },
  {
    label: "Deep Emerald", kind: "dark",
    tokens: {
      primary: "#10B981", secondary: "#064E3B", accent: "#6EE7B7",
      background: "#022C22", foreground: "#ECFDF5",
      button_style: "soft", radius: "1rem",
      display_font: "Space Grotesk", body_font: "DM Sans",
    },
    dark: { primary: "#34D399", secondary: "#064E3B", accent: "#6EE7B7",
            background: "#022C22", foreground: "#ECFDF5" },
  },
];

function ThemesPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listSiteThemes);
  const upsertFn = useServerFn(upsertSiteTheme);
  const activateFn = useServerFn(activateSiteTheme);
  const archiveFn = useServerFn(archiveSiteTheme);

  const themesQ = useQuery({
    queryKey: ["mkt", "themes"],
    queryFn: () => listFn({ data: undefined }),
  });

  const [editing, setEditing] = useState<Partial<SiteTheme> | null>(null);
  const [tokens, setTokens] = useState<ThemeTokens>(DEFAULT_TOKENS);
  const [darkTokens, setDarkTokens] = useState<DarkThemeTokens>(DEFAULT_DARK);

  const openNew = () => {
    setEditing({ name: "New theme", description: "" });
    setTokens(DEFAULT_TOKENS);
    setDarkTokens(DEFAULT_DARK);
  };
  const openEdit = (t: SiteTheme) => {
    setEditing(t);
    setTokens({ ...DEFAULT_TOKENS, ...t.tokens });
    setDarkTokens({ ...DEFAULT_DARK, ...(t.dark_tokens ?? {}) });
  };
  const applyPreset = (i: number) => {
    setTokens(PRESETS[i].tokens);
    setDarkTokens(PRESETS[i].dark);
  };

  const save = useMutation({
    mutationFn: async () => upsertFn({
      data: {
        id: editing?.id,
        name: editing?.name || "Untitled",
        description: editing?.description ?? null,
        tokens,
        dark_tokens: darkTokens,
        scheduled_at: editing?.scheduled_at ?? null,
      },
    }),
    onSuccess: () => {
      toast.success("Theme saved");
      qc.invalidateQueries({ queryKey: ["mkt", "themes"] });
      setEditing(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activate = useMutation({
    mutationFn: async (id: string) => activateFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Theme activated — live on marketing site");
      qc.invalidateQueries({ queryKey: ["mkt", "themes"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const archiveM = useMutation({
    mutationFn: async (id: string) => archiveFn({ data: { id } }),
    onSuccess: () => { toast.success("Archived"); qc.invalidateQueries({ queryKey: ["mkt", "themes"] }); },
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-semibold">
            <Palette className="h-6 w-6 text-primary" /> Website theme management
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Change the marketing website's palette, dark-mode pair, typography and buttons in
            real time. Only one theme is live; preview any draft with
            <code className="mx-1 rounded bg-muted px-1 text-xs">?theme_preview=&lt;id&gt;</code>.
            Every change, activation, schedule and rollback is written to the audit log.
          </p>
        </div>
        <Button onClick={openNew}><Palette className="mr-2 h-4 w-4" />New theme</Button>
      </header>

      {editing && <ThemeEditor
        editing={editing} setEditing={setEditing}
        tokens={tokens} setTokens={setTokens}
        darkTokens={darkTokens} setDarkTokens={setDarkTokens}
        onSave={() => save.mutate()} saving={save.isPending}
        onCancel={() => setEditing(null)}
        applyPreset={applyPreset}
      />}

      <section className="mt-6 grid gap-3">
        {themesQ.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {(themesQ.data ?? []).map((t) => (
          <Card key={t.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-16 overflow-hidden rounded border border-border">
                <div style={{ background: t.tokens.primary }} className="h-full w-1/3" />
                <div style={{ background: t.tokens.secondary }} className="h-full w-1/3" />
                <div style={{ background: t.tokens.accent }} className="h-full w-1/3" />
              </div>
              <div>
                <div className="flex items-center gap-2 font-medium">
                  {t.name}
                  <Badge variant={t.status === "active" ? "default" : "secondary"}>{t.status}</Badge>
                  {t.is_preset && <Badge variant="outline">preset</Badge>}
                  {t.dark_tokens && <Badge variant="outline"><Moon className="mr-1 h-3 w-3" />dark</Badge>}
                  <span className="text-xs text-muted-foreground">v{t.version}</span>
                </div>
                <div className="text-xs text-muted-foreground">{t.description}</div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="sm" asChild>
                <a href={`/?theme_preview=${t.id}`} target="_blank" rel="noreferrer">
                  <Eye className="mr-1 h-4 w-4" />Preview
                </a>
              </Button>
              <Button variant="outline" size="sm" onClick={() => openEdit(t)}>Edit</Button>
              {t.status !== "active" && (
                <Button size="sm" onClick={() => activate.mutate(t.id)} disabled={activate.isPending}>
                  <Play className="mr-1 h-4 w-4" />Activate
                </Button>
              )}
              {t.status !== "archived" && t.status !== "active" && (
                <Button variant="ghost" size="sm" onClick={() => archiveM.mutate(t.id)}>
                  <Archive className="mr-1 h-4 w-4" />Archive
                </Button>
              )}
              <VersionsPanel themeId={t.id} />
            </div>
          </Card>
        ))}
      </section>
    </div>
  );
}

function ThemeEditor({
  editing, setEditing, tokens, setTokens, darkTokens, setDarkTokens,
  onSave, saving, onCancel, applyPreset,
}: {
  editing: Partial<SiteTheme>;
  setEditing: (t: Partial<SiteTheme>) => void;
  tokens: ThemeTokens; setTokens: (t: ThemeTokens) => void;
  darkTokens: DarkThemeTokens; setDarkTokens: (t: DarkThemeTokens) => void;
  onSave: () => void; saving: boolean;
  onCancel: () => void;
  applyPreset: (i: number) => void;
}) {
  const [mode, setMode] = useState<"light" | "dark">("light");
  const active = mode === "light" ? tokens : { ...tokens, ...darkTokens };
  const setActive = (patch: Partial<ThemeTokens>) => {
    if (mode === "light") setTokens({ ...tokens, ...patch });
    else setDarkTokens({ ...darkTokens, ...patch });
  };
  const colorKeys: (keyof ThemeTokens)[] = ["primary","secondary","accent","background","foreground"];

  const previewHref = useMemo(() => editing.id ? `/?theme_preview=${editing.id}` : "/", [editing.id]);

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold">
          {editing.id ? "Edit theme" : "New theme"}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-md border border-border">
            <button type="button" onClick={() => setMode("light")}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs ${mode === "light" ? "bg-primary text-primary-foreground" : "bg-background text-foreground"}`}>
              <Sun className="h-3.5 w-3.5" />Light
            </button>
            <button type="button" onClick={() => setMode("dark")}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs ${mode === "dark" ? "bg-primary text-primary-foreground" : "bg-background text-foreground"}`}>
              <Moon className="h-3.5 w-3.5" />Dark
            </button>
          </div>
        </div>
      </div>

      <div className="mb-4 grid gap-2 rounded-md border border-border bg-muted/40 p-3">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Sun className="h-3.5 w-3.5" /> Light presets
        </div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p, i) => p.kind === "light" && (
            <button key={p.label} type="button" onClick={() => applyPreset(i)}
              className="group flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs hover:border-primary">
              <span className="flex h-4 w-8 overflow-hidden rounded-sm border border-border">
                <span className="w-1/3" style={{ background: p.tokens.primary }} />
                <span className="w-1/3" style={{ background: p.tokens.secondary }} />
                <span className="w-1/3" style={{ background: p.tokens.accent }} />
              </span>
              {p.label}
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Moon className="h-3.5 w-3.5" /> Dark presets
        </div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p, i) => p.kind === "dark" && (
            <button key={p.label} type="button" onClick={() => applyPreset(i)}
              className="group flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs hover:border-primary">
              <span className="flex h-4 w-8 overflow-hidden rounded-sm border border-border">
                <span className="w-1/3" style={{ background: p.dark.primary }} />
                <span className="w-1/3" style={{ background: p.dark.secondary }} />
                <span className="w-1/3" style={{ background: p.dark.accent }} />
              </span>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="hidden">
        <Copy className="h-3.5 w-3.5" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label>Name</Label>
            <Input value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </div>
          <div className="grid gap-1">
            <Label>Description</Label>
            <Textarea value={editing.description ?? ""} rows={2}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {colorKeys.map((k) => (
              <div key={k} className="grid gap-1">
                <Label className="text-xs capitalize">{k} ({mode})</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={String(active[k])}
                    onChange={(e) => setActive({ [k]: e.target.value } as Partial<ThemeTokens>)}
                    className="h-9 w-12 cursor-pointer rounded border border-border bg-transparent"
                  />
                  <Input
                    value={String(active[k])}
                    onChange={(e) => setActive({ [k]: e.target.value } as Partial<ThemeTokens>)}
                    className="font-mono text-xs"
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label className="text-xs">Radius</Label>
              <Input value={tokens.radius} onChange={(e) => setTokens({ ...tokens, radius: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Button style</Label>
              <select
                value={tokens.button_style}
                onChange={(e) => setTokens({ ...tokens, button_style: e.target.value as ThemeTokens["button_style"] })}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="solid">Solid</option>
                <option value="outline">Outline</option>
                <option value="soft">Soft</option>
              </select>
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Display font</Label>
              <Input value={tokens.display_font} onChange={(e) => setTokens({ ...tokens, display_font: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">Body font</Label>
              <Input value={tokens.body_font} onChange={(e) => setTokens({ ...tokens, body_font: e.target.value })} />
            </div>
          </div>
          <div className="grid gap-1">
            <Label className="text-xs">Schedule activation (optional)</Label>
            <Input
              type="datetime-local"
              value={editing.scheduled_at ? editing.scheduled_at.slice(0, 16) : ""}
              onChange={(e) => setEditing({
                ...editing,
                scheduled_at: e.target.value ? new Date(e.target.value).toISOString() : null,
              })}
            />
          </div>
        </div>

        <div className="grid gap-3">
          <Label className="text-xs">Live preview ({mode})</Label>
          <div
            className="rounded-lg border border-border p-6"
            style={{ background: active.background, color: active.foreground, borderRadius: tokens.radius }}
          >
            <div className="text-xs uppercase tracking-wide" style={{ color: active.accent }}>Preview</div>
            <h3 className="mt-2 text-2xl font-semibold" style={{ fontFamily: `"${tokens.display_font}", sans-serif` }}>
              Reconciliation, verified by intelligence.
            </h3>
            <p className="mt-2 text-sm opacity-80" style={{ fontFamily: `"${tokens.body_font}", sans-serif` }}>
              Enterprise-grade AI reconciliation. Agentic, auditable, sovereign.
            </p>
            <div className="mt-4 flex gap-2">
              <button className="px-4 py-2 text-sm font-medium"
                style={{
                  background: tokens.button_style === "solid" ? active.primary : "transparent",
                  color: tokens.button_style === "solid" ? active.background : active.primary,
                  border: tokens.button_style === "outline" ? `1px solid ${active.primary}` : "none",
                  borderRadius: tokens.radius,
                }}>
                Book demo
              </button>
              <button className="px-4 py-2 text-sm"
                style={{ background: active.secondary, color: active.foreground, borderRadius: tokens.radius }}>
                Learn more
              </button>
            </div>
          </div>
          {editing.id && (
            <a href={previewHref} target="_blank" rel="noreferrer" className="text-xs text-primary underline">
              Open full site preview →
            </a>
          )}
        </div>
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button onClick={onSave} disabled={saving}>
          <Save className="mr-1 h-4 w-4" />{saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </Card>
  );
}

function VersionsPanel({ themeId }: { themeId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const versionsFn = useServerFn(listThemeVersions);
  const rollbackFn = useServerFn(rollbackSiteTheme);
  const q = useQuery({
    queryKey: ["mkt", "theme-versions", themeId],
    queryFn: () => versionsFn({ data: { id: themeId } }),
    enabled: open,
  });
  const rollback = useMutation({
    mutationFn: async (version_id: string) => rollbackFn({ data: { theme_id: themeId, version_id } }),
    onSuccess: (r) => {
      toast.success(`Rolled back to v${r.restored_from} (now live as v${r.version})`);
      qc.invalidateQueries({ queryKey: ["mkt", "themes"] });
      qc.invalidateQueries({ queryKey: ["mkt", "theme-versions", themeId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
        <History className="mr-1 h-4 w-4" />History
      </Button>
      {open && (
        <div className="mt-2 w-full rounded-md border border-border bg-popover p-3 text-xs text-popover-foreground">
          {q.isLoading && "Loading…"}
          {(q.data ?? []).map((v) => (
            <div key={v.id} className="flex items-center justify-between gap-2 py-1.5">
              <div className="flex items-center gap-2">
                <span className="font-mono">v{v.version}</span>
                <span className="text-muted-foreground">{new Date(v.activated_at).toLocaleString()}</span>
                {v.note && <span className="text-muted-foreground">— {v.note}</span>}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (confirm(`Roll back this theme to v${v.version}? A new active version will be created.`)) {
                    rollback.mutate(v.id);
                  }
                }}
                disabled={rollback.isPending}
              >
                <Undo2 className="mr-1 h-3.5 w-3.5" />Rollback
              </Button>
            </div>
          ))}
          {(q.data ?? []).length === 0 && !q.isLoading && (
            <span className="text-muted-foreground">No activations yet.</span>
          )}
        </div>
      )}
    </>
  );
}
