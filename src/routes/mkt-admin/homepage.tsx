import { createFileRoute, redirect } from "@tanstack/react-router";
import { assertMktRolesFn } from "@/lib/mkt-admin.functions";
import { MKT_TAB_ROLES } from "@/lib/mkt-admin-roles";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  HOMEPAGE_DEFAULTS,
  HOMEPAGE_SECTION_KEYS,
  type HomepageSectionKey,
  type HomepageSectionRow,
  type Json,
  type SectionContent,
  listHomepageSectionsAdmin,
  resetHomepageSection,
  upsertHomepageSection,
} from "@/lib/mkt-homepage.functions";
import {
  HOMEPAGE_PREVIEW_PARAM,
  HOMEPAGE_PREVIEW_TOKEN,
  useHomepagePreviewPublisher,
  type HomepagePreviewDraft,
} from "@/lib/homepage-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles,
  ShieldCheck,
  Bot,
  MessageSquareHeart,
  RotateCcw,
  Save,
  Building2,
  ExternalLink,
  Eye,
  EyeOff,
  RefreshCcw,
  Monitor,
  Tablet,
  Smartphone,
  LayoutTemplate,
} from "lucide-react";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/mkt-admin/homepage")({
  beforeLoad: async () => {
    try {
      await assertMktRolesFn({ data: { allowed: MKT_TAB_ROLES.homepage } });
    } catch {
      throw redirect({ to: "/mkt-admin" });
    }
  },
  component: HomepageHub,
});



/* -------------------------------------------------------------------------- */
/* Section schema (drives the editor UI)                                       */
/* -------------------------------------------------------------------------- */

type FieldKind = "text" | "textarea" | "tags" | "url" | "bool" | "json";
type FieldDef = { key: string; label: string; kind: FieldKind; help?: string };
type SectionMeta = {
  key: HomepageSectionKey;
  title: string;
  blurb: string;
  icon: React.ComponentType<{ className?: string }>;
  fields: FieldDef[];
};

const SECTIONS: SectionMeta[] = [
  {
    key: "announcement_bar",
    title: "Announcement bar",
    blurb: "Thin bar above the nav for launches, releases, and notices.",
    icon: Sparkles,
    fields: [
      { key: "enabled_message", label: "Message", kind: "text" },
      { key: "cta_label", label: "CTA label", kind: "text" },
      { key: "cta_href", label: "CTA link", kind: "url" },
      { key: "dismissible", label: "Dismissible", kind: "bool" },
    ],
  },
  {
    key: "nav",
    title: "Top navigation",
    blurb: "Logo, primary nav items, and the two header CTAs.",
    icon: LayoutTemplate,
    fields: [
      { key: "logo_text", label: "Wordmark", kind: "text" },
      { key: "logo_image_url", label: "Logo image URL", kind: "url", help: "Leave empty to use the wordmark." },
      { key: "items", label: "Nav items (JSON)", kind: "json", help: '[{ "label": "...", "href": "..." }]' },
      { key: "primary_cta_label", label: "Primary CTA · label", kind: "text" },
      { key: "primary_cta_href", label: "Primary CTA · link", kind: "url" },
      { key: "secondary_cta_label", label: "Secondary CTA · label", kind: "text" },
      { key: "secondary_cta_href", label: "Secondary CTA · link", kind: "url" },
    ],
  },
  {
    key: "hero",
    title: "Hero — top of homepage",
    blurb: "Eyebrow, headline, subhead, and the two primary CTAs.",
    icon: Sparkles,
    fields: [
      { key: "eyebrow", label: "Eyebrow", kind: "text" },
      { key: "headline_line_1", label: "Headline · line 1", kind: "text" },
      { key: "headline_line_2", label: "Headline · line 2", kind: "text" },
      { key: "subhead", label: "Sub-headline", kind: "textarea" },
      { key: "primary_cta_label", label: "Primary CTA · label", kind: "text" },
      { key: "primary_cta_href", label: "Primary CTA · link", kind: "url" },
      { key: "secondary_cta_label", label: "Secondary CTA · label", kind: "text" },
      { key: "secondary_cta_href", label: "Secondary CTA · link", kind: "url" },
      { key: "background_image_url", label: "Background image URL", kind: "url" },
    ],
  },
  {
    key: "video_hero",
    title: "Video hero band",
    blurb: "A 90-second product tour video embedded on the homepage.",
    icon: Sparkles,
    fields: [
      { key: "kicker", label: "Kicker", kind: "text" },
      { key: "heading", label: "Heading", kind: "text" },
      { key: "subhead", label: "Sub-headline", kind: "textarea" },
      { key: "video_url", label: "Video URL (MP4 / HLS / YouTube / Vimeo)", kind: "url" },
      { key: "poster_url", label: "Poster image URL", kind: "url" },
      { key: "autoplay", label: "Autoplay", kind: "bool" },
      { key: "loop", label: "Loop", kind: "bool" },
      { key: "muted", label: "Start muted", kind: "bool" },
    ],
  },
  {
    key: "trusted_strip",
    title: "Enterprise positioning strip",
    blurb: "Replaces the trusted-by logo carousel until launch partners go live.",
    icon: ShieldCheck,
    fields: [
      { key: "kicker", label: "Kicker", kind: "text" },
      { key: "heading", label: "Heading", kind: "text" },
      { key: "note", label: "Footnote", kind: "textarea" },
      { key: "tags", label: "Capability tags", kind: "tags", help: "One per line." },
    ],
  },
  {
    key: "stats_band",
    title: "Stats band",
    blurb: "A row of headline numbers with short labels.",
    icon: ShieldCheck,
    fields: [
      { key: "kicker", label: "Kicker", kind: "text" },
      { key: "heading", label: "Heading", kind: "text" },
      { key: "stats", label: "Stats (JSON)", kind: "json", help: '[{ "value": "99.99%", "label": "Availability" }]' },
    ],
  },
  {
    key: "features_grid",
    title: "Features grid",
    blurb: "Four-up (or six-up) product-pillar grid with icons.",
    icon: LayoutTemplate,
    fields: [
      { key: "kicker", label: "Kicker", kind: "text" },
      { key: "heading", label: "Heading", kind: "text" },
      { key: "subhead", label: "Sub-headline", kind: "textarea" },
      { key: "features", label: "Features (JSON)", kind: "json", help: '[{ "icon":"shield","title":"...","body":"..." }]' },
    ],
  },
  {
    key: "agentic_showcase",
    title: "Agentic AI showcase",
    blurb: "Header copy above the agent list + live terminal.",
    icon: Bot,
    fields: [
      { key: "kicker", label: "Kicker", kind: "text" },
      { key: "heading", label: "Heading", kind: "text" },
      { key: "subhead", label: "Sub-headline", kind: "textarea" },
    ],
  },
  {
    key: "reel_gallery",
    title: "Reels / micro-videos gallery",
    blurb: "Short 30–60 second clips of real operator workflows.",
    icon: Sparkles,
    fields: [
      { key: "kicker", label: "Kicker", kind: "text" },
      { key: "heading", label: "Heading", kind: "text" },
      { key: "subhead", label: "Sub-headline", kind: "textarea" },
      { key: "reels", label: "Reels (JSON)", kind: "json", help: '[{ "title":"...","video_url":"...","poster_url":"...","duration_sec":30 }]' },
    ],
  },
  {
    key: "testimonials",
    title: "Testimonials",
    blurb: "Named quotes from operators, CDOs, and CFOs.",
    icon: MessageSquareHeart,
    fields: [
      { key: "kicker", label: "Kicker", kind: "text" },
      { key: "heading", label: "Heading", kind: "text" },
      { key: "items", label: "Testimonials (JSON)", kind: "json", help: '[{ "quote":"...","author":"...","org":"..." }]' },
    ],
  },
  {
    key: "faq_preview",
    title: "FAQ preview",
    blurb: "Short answers to the most common enterprise questions.",
    icon: MessageSquareHeart,
    fields: [
      { key: "kicker", label: "Kicker", kind: "text" },
      { key: "heading", label: "Heading", kind: "text" },
      { key: "items", label: "FAQ items (JSON)", kind: "json", help: '[{ "q":"...","a":"..." }]' },
    ],
  },
  {
    key: "cta_band",
    title: "Bottom CTA band",
    blurb: "Full-width CTA band above the footer.",
    icon: Sparkles,
    fields: [
      { key: "kicker", label: "Kicker", kind: "text" },
      { key: "heading", label: "Heading", kind: "text" },
      { key: "subhead", label: "Sub-headline", kind: "textarea" },
      { key: "primary_cta_label", label: "Primary CTA · label", kind: "text" },
      { key: "primary_cta_href", label: "Primary CTA · link", kind: "url" },
      { key: "secondary_cta_label", label: "Secondary CTA · label", kind: "text" },
      { key: "secondary_cta_href", label: "Secondary CTA · link", kind: "url" },
    ],
  },
  {
    key: "talk_to_falcon",
    title: "Talk to ReconIQ",
    blurb: "Header for the split-screen lead-capture section.",
    icon: MessageSquareHeart,
    fields: [
      { key: "kicker", label: "Kicker", kind: "text" },
      { key: "heading", label: "Heading", kind: "text" },
      { key: "subhead", label: "Sub-headline", kind: "textarea" },
      { key: "footnote", label: "Small footnote", kind: "textarea" },
    ],
  },
  {
    key: "footer",
    title: "Footer",
    blurb: "Tagline, link columns, address, and copyright line.",
    icon: LayoutTemplate,
    fields: [
      { key: "tagline", label: "Tagline", kind: "text" },
      { key: "columns", label: "Link columns (JSON)", kind: "json", help: '[{ "heading":"Product","links":[{ "label":"...","href":"..." }] }]' },
      { key: "address", label: "Address / offices line", kind: "text" },
      { key: "copyright", label: "Copyright line", kind: "text" },
    ],
  },
  {
    key: "social_links",
    title: "Social links",
    blurb: "LinkedIn, X/Twitter, YouTube, GitHub URLs.",
    icon: Building2,
    fields: [
      { key: "linkedin", label: "LinkedIn URL", kind: "url" },
      { key: "x_twitter", label: "X / Twitter URL", kind: "url" },
      { key: "youtube", label: "YouTube URL", kind: "url" },
      { key: "github", label: "GitHub URL", kind: "url" },
    ],
  },
  {
    key: "seo_meta",
    title: "SEO & social metadata",
    blurb: "Title, description, canonical domain, and Open Graph image.",
    icon: ShieldCheck,
    fields: [
      { key: "site_title", label: "Site title (<60 chars)", kind: "text" },
      { key: "site_description", label: "Meta description (<160 chars)", kind: "textarea" },
      { key: "og_image_url", label: "Open Graph image URL (absolute https)", kind: "url" },
      { key: "twitter_handle", label: "Twitter handle", kind: "text" },
      { key: "canonical_domain", label: "Canonical domain", kind: "text" },
      { key: "keywords", label: "Keywords", kind: "tags", help: "One per line." },
    ],
  },
];

/* -------------------------------------------------------------------------- */
/* Hub                                                                         */
/* -------------------------------------------------------------------------- */

function HomepageHub() {
  const listFn = useServerFn(listHomepageSectionsAdmin);
  const q = useQuery({
    queryKey: ["mkt", "homepage-sections"],
    queryFn: () => listFn({ data: undefined }),
  });

  // Live-preview state — draft edits per section, broadcast to the iframe.
  const publisher = useHomepagePreviewPublisher();
  const [draft, setDraft] = useState<HomepagePreviewDraft>({});
  const [previewOpen, setPreviewOpen] = useState(true);
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Broadcast on every draft change (debounced by React batching).
  useEffect(() => {
    publisher.publish(draft);
  }, [draft, publisher]);

  const setSectionDraft = (
    key: HomepageSectionKey,
    patch: { content: SectionContent; enabled: boolean } | null,
  ) => {
    setDraft((prev) => {
      const next = { ...prev };
      if (patch === null) delete next[key];
      else next[key] = patch;
      return next;
    });
  };

  const draftCount = Object.keys(draft).length;
  const previewSrc = `/?${HOMEPAGE_PREVIEW_PARAM}=${HOMEPAGE_PREVIEW_TOKEN}`;
  const deviceWidth = device === "mobile" ? 390 : device === "tablet" ? 820 : "100%";

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Main website · content control
          </div>
          <h1 className="mt-1 font-display text-2xl font-semibold">Homepage sections</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Edit every section of the public homepage in one place. The live preview panel
            reflects unsaved edits instantly — nothing goes to visitors until you press
            <span className="font-semibold text-foreground"> Save section</span>.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setPreviewOpen((v) => !v)}>
            {previewOpen ? (
              <>
                <EyeOff className="mr-2 h-4 w-4" /> Hide preview
              </>
            ) : (
              <>
                <Eye className="mr-2 h-4 w-4" /> Show preview
              </>
            )}
          </Button>
          <Button asChild variant="outline">
            <Link to="/mkt-admin/site-logos">
              <Building2 className="mr-2 h-4 w-4" /> Trusted-by logos
            </Link>
          </Button>
        </div>
      </header>

      <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">How it works:</span> type in any field
        and the preview on the right updates in real time. Drafts stay in your browser only —
        press <span className="font-mono">Save section</span> to persist for real visitors, or
        <span className="font-mono"> Reset to defaults</span> to remove an override.
      </div>

      {q.isLoading && (
        <div className="rounded-md border border-border p-6 text-sm text-muted-foreground">
          Loading sections…
        </div>
      )}
      {q.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load: {(q.error as Error).message}
        </div>
      )}

      <div className={previewOpen ? "grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(520px,0.9fr)]" : ""}>
        <div className="grid gap-5">
          {SECTIONS.map((meta) => {
            const row = q.data?.find((r) => r.section_key === meta.key);
            return (
              <SectionEditor
                key={meta.key}
                meta={meta}
                row={
                  row ?? {
                    section_key: meta.key,
                    enabled: true,
                    content: HOMEPAGE_DEFAULTS[meta.key],
                    defaults: HOMEPAGE_DEFAULTS[meta.key],
                    updated_at: null,
                    updated_by: null,
                    has_override: false,
                  }
                }
                onDraftChange={(patch) => setSectionDraft(meta.key, patch)}
              />
            );
          })}
        </div>

        {previewOpen && (
          <aside className="xl:sticky xl:top-4 h-fit rounded-xl border border-border bg-card shadow-sm">
            <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_6px_theme(colors.emerald.500)]" />
                <span className="font-semibold">Live preview</span>
                <span className="text-muted-foreground">
                  · {draftCount === 0 ? "showing saved content" : `${draftCount} draft section${draftCount === 1 ? "" : "s"}`}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <DeviceBtn active={device === "desktop"} onClick={() => setDevice("desktop")} icon={Monitor} label="Desktop" />
                <DeviceBtn active={device === "tablet"} onClick={() => setDevice("tablet")} icon={Tablet} label="Tablet" />
                <DeviceBtn active={device === "mobile"} onClick={() => setDevice("mobile")} icon={Smartphone} label="Mobile" />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => iframeRef.current?.contentWindow?.location.reload()}
                  title="Reload preview"
                >
                  <RefreshCcw className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" asChild title="Open in new tab">
                  <a href={previewSrc} target="_blank" rel="noreferrer">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              </div>
            </div>
            <div className="flex justify-center bg-muted/40 p-3">
              <div
                className="overflow-hidden rounded-md border border-border bg-background shadow-inner transition-[width] duration-200"
                style={{ width: deviceWidth, maxWidth: "100%" }}
              >
                <iframe
                  ref={iframeRef}
                  title="Homepage live preview"
                  src={previewSrc}
                  className="h-[78vh] w-full"
                />
              </div>
            </div>
            <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
              Preview overlays draft edits over the current saved content using a same-origin
              broadcast channel. It is only visible in this browser tab.
            </div>
          </aside>
        )}
      </div>

      <footer className="pt-4 text-[11px] text-muted-foreground">
        Section keys managed here: {HOMEPAGE_SECTION_KEYS.join(", ")}.
      </footer>
    </div>
  );
}

function DeviceBtn({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <Button
      size="sm"
      variant={active ? "secondary" : "ghost"}
      onClick={onClick}
      title={label}
      className="h-7 w-7 p-0"
    >
      <Icon className="h-3.5 w-3.5" />
    </Button>
  );
}


/* -------------------------------------------------------------------------- */
/* Section editor                                                              */
/* -------------------------------------------------------------------------- */

function SectionEditor({
  meta,
  row,
  onDraftChange,
}: {
  meta: SectionMeta;
  row: HomepageSectionRow;
  onDraftChange?: (patch: { content: SectionContent; enabled: boolean } | null) => void;
}) {
  const upsertFn = useServerFn(upsertHomepageSection);
  const resetFn = useServerFn(resetHomepageSection);
  const qc = useQueryClient();
  const Icon = meta.icon;

  const [content, setContent] = useState<SectionContent>(row.content);
  const [enabled, setEnabled] = useState<boolean>(row.enabled);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setContent(row.content);
    setEnabled(row.enabled);
    setDirty(false);
    onDraftChange?.(null);
    // Reset when the underlying saved row changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.content, row.enabled]);

  // Push the current draft to the preview iframe whenever the editor changes.
  useEffect(() => {
    if (!onDraftChange) return;
    if (dirty) onDraftChange({ content, enabled });
    else onDraftChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, enabled, dirty]);

  const save = useMutation({
    mutationFn: () =>
      upsertFn({ data: { section_key: meta.key, content, enabled } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["mkt", "homepage-sections"] });
      onDraftChange?.(null);
      setDirty(false);
    },
  });

  const reset = useMutation({
    mutationFn: () => resetFn({ data: { section_key: meta.key } }),
    onSuccess: () => {
      onDraftChange?.(null);
      return qc.invalidateQueries({ queryKey: ["mkt", "homepage-sections"] });
    },
  });


  const updated = useMemo(() => {
    if (!row.updated_at) return "Never — showing defaults";
    return `Last edit: ${new Date(row.updated_at).toLocaleString()}`;
  }, [row.updated_at]);

  const patch = (k: string, v: Json) => {
    setContent((prev) => ({ ...prev, [k]: v }));
    setDirty(true);
  };

  return (
    <section className="rounded-xl border border-border bg-background p-5 shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-lg font-semibold">{meta.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{meta.blurb}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <Badge variant={row.has_override ? "default" : "outline"}>
                {row.has_override ? "Override active" : "Using defaults"}
              </Badge>
              <span>·</span>
              <span>{updated}</span>
              <span>·</span>
              <code className="rounded bg-muted px-1.5 py-0.5">{meta.key}</code>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5">
            <Switch
              id={`enabled-${meta.key}`}
              checked={enabled}
              onCheckedChange={(v) => {
                setEnabled(v);
                setDirty(true);
              }}
            />
            <Label htmlFor={`enabled-${meta.key}`} className="text-xs">
              Enabled on site
            </Label>
          </div>
        </div>
      </header>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {meta.fields.map((f) => (
          <FieldControl key={f.key} field={f} value={content[f.key]} onChange={(v) => patch(f.key, v)} />
        ))}
      </div>

      <footer className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <div className="text-xs text-muted-foreground">
          {dirty ? "Unsaved changes." : "No pending changes."}
        </div>
        <div className="flex gap-2">
          {row.has_override && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (confirm("Remove override and revert this section to the built-in defaults?")) {
                  reset.mutate();
                }
              }}
              disabled={reset.isPending}
            >
              <RotateCcw className="mr-1 h-4 w-4" />
              Reset to defaults
            </Button>
          )}
          <Button asChild variant="ghost" size="sm">
            <a href="/" target="_blank" rel="noreferrer">
              Preview <ExternalLink className="ml-1 h-3.5 w-3.5" />
            </a>
          </Button>
          <Button size="sm" onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
            <Save className="mr-1 h-4 w-4" />
            {save.isPending ? "Saving…" : "Save section"}
          </Button>
        </div>
      </footer>

      {save.error && (
        <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {(save.error as Error).message}
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Field control                                                               */
/* -------------------------------------------------------------------------- */

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: Json | undefined;
  onChange: (v: Json) => void;
}) {
  const id = `f-${field.key}`;
  if (field.kind === "textarea") {
    return (
      <div className="md:col-span-2">
        <Label htmlFor={id} className="text-xs">
          {field.label}
        </Label>
        <Textarea
          id={id}
          rows={3}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          className="mt-1"
        />
        {field.help && <p className="mt-1 text-[11px] text-muted-foreground">{field.help}</p>}
      </div>
    );
  }
  if (field.kind === "tags") {
    const arr = Array.isArray(value) ? (value.filter((v) => typeof v === "string") as string[]) : [];
    return (
      <div className="md:col-span-2">
        <Label htmlFor={id} className="text-xs">
          {field.label}
        </Label>
        <Textarea
          id={id}
          rows={4}
          value={arr.join("\n")}
          onChange={(e) =>
            onChange(
              e.target.value
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
          className="mt-1 font-mono text-xs"
        />
        {field.help && <p className="mt-1 text-[11px] text-muted-foreground">{field.help}</p>}
      </div>
    );
  }
  if (field.kind === "bool") {
    const b = value === true || value === "true";
    return (
      <div className="flex items-center gap-3">
        <Switch id={id} checked={b} onCheckedChange={(v) => onChange(!!v)} />
        <Label htmlFor={id} className="text-xs">{field.label}</Label>
      </div>
    );
  }
  if (field.kind === "json") {
    const pretty = (() => {
      try { return JSON.stringify(value ?? null, null, 2); } catch { return "null"; }
    })();
    return (
      <div className="md:col-span-2">
        <Label htmlFor={id} className="text-xs">{field.label}</Label>
        <Textarea
          id={id}
          rows={8}
          defaultValue={pretty}
          onBlur={(e) => {
            try { onChange(JSON.parse(e.target.value) as Json); }
            catch { /* keep last valid value */ }
          }}
          className="mt-1 font-mono text-[11px]"
        />
        {field.help && <p className="mt-1 text-[11px] text-muted-foreground">{field.help}</p>}
      </div>
    );
  }
  return (
    <div>
      <Label htmlFor={id} className="text-xs">
        {field.label}
      </Label>
      <Input
        id={id}
        type={field.kind === "url" ? "url" : "text"}
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1"
      />
      {field.help && <p className="mt-1 text-[11px] text-muted-foreground">{field.help}</p>}
    </div>
  );
}
