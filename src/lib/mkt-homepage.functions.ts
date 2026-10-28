import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertMktRole } from "./mkt-admin.functions";
import { MKT_TAB_ROLES } from "./mkt-admin-roles";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

/* -------------------------------------------------------------------------- */
/* JSON-safe types                                                             */
/* -------------------------------------------------------------------------- */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];
export type SectionContent = { [key: string]: Json };

/* -------------------------------------------------------------------------- */
/* Section keys & default content                                              */
/* -------------------------------------------------------------------------- */

export const HOMEPAGE_SECTION_KEYS = [
  "announcement_bar",
  "nav",
  "hero",
  "video_hero",
  "trusted_strip",
  "stats_band",
  "features_grid",
  "agentic_showcase",
  "reel_gallery",
  "testimonials",
  "faq_preview",
  "cta_band",
  "talk_to_falcon",
  "footer",
  "social_links",
  "seo_meta",
] as const;
export type HomepageSectionKey = (typeof HOMEPAGE_SECTION_KEYS)[number];

export const HOMEPAGE_DEFAULTS: Record<HomepageSectionKey, SectionContent> = {
  announcement_bar: {
    enabled_message: "New — ReconIQ 2.0 with Agentic Reconciliation is live.",
    cta_label: "Read the announcement",
    cta_href: "/blog/fvi-2",
    dismissible: true,
  },
  nav: {
    logo_text: "ReconIQ",
    logo_image_url: "",
    items: [
      { label: "Product", href: "#product" },
      { label: "Solutions", href: "/solutions" },
      { label: "Pricing", href: "/pricing" },
      { label: "Security", href: "/security" },
      { label: "Developers", href: "/developers" },
    ],
    primary_cta_label: "Book a demo",
    primary_cta_href: "/book-demo",
    secondary_cta_label: "Sign in",
    secondary_cta_href: "/auth",
  },
  hero: {
    eyebrow: "ReconIQ · ReconIQ",
    headline_line_1: "A reconciliation platform",
    headline_line_2: "designed for regulated finance.",
    subhead:
      "Architected to Tier-1 banking control requirements. Agentic AI, hash-chained audit, and BYO-LLM — built in, not bolted on.",
    primary_cta_label: "Book a demo",
    primary_cta_href: "/book-demo",
    secondary_cta_label: "Talk to ReconIQ Copilot",
    secondary_cta_href: "#chat",
    background_image_url: "",
  },
  video_hero: {
    kicker: "Watch the platform in 90 seconds",
    heading: "See ReconIQ end-to-end.",
    subhead: "A guided tour of ingestion, agentic matching, break workflow, and audit chain.",
    video_url: "",
    poster_url: "",
    autoplay: false,
    loop: false,
    muted: true,
  },
  trusted_strip: {
    kicker: "Enterprise positioning",
    heading: "Engineered for regulated financial services.",
    note: "Named customer references will be published as launch partners go live.",
    tags: [
      "Multi-tenant",
      "Zero-trust",
      "BYO-LLM",
      "SHA-256 audit",
      "SOC 2-aligned controls",
      "DORA-aligned resilience",
    ],
  },
  stats_band: {
    kicker: "Proof, not promises",
    heading: "Numbers we operate to.",
    stats: [
      { value: "99.99%", label: "Platform availability target" },
      { value: "< 5 min", label: "Break-to-analyst SLA" },
      { value: "SHA-256", label: "Hash-chained audit trail" },
      { value: "BYO-LLM", label: "Any model, any region" },
    ],
  },
  features_grid: {
    kicker: "Product",
    heading: "One platform. Every reconciliation.",
    subhead: "One-, two-, and tri-party. Cash, positions, trades, corporate actions, NAV.",
    features: [
      { icon: "shield", title: "Zero-trust tenant isolation", body: "Per-tenant KMS, RLS on every table, hash-chained audit." },
      { icon: "bot", title: "Agentic AI, human-controlled", body: "Scoped mandates, policy gates, HITL on every write." },
      { icon: "workflow", title: "Configurable to your data", body: "No-code recon designer with tolerance ladders and cascades." },
      { icon: "chart", title: "Observable end-to-end", body: "OpenTelemetry traces, SLO snapshots, drift alerts." },
    ],
  },
  agentic_showcase: {
    kicker: "Agentic AI",
    heading: "A team of specialised agents — under human control.",
    subhead:
      "Each agent has a scoped mandate, policy gates, and a hash-chained audit trail. Nothing writes back without approval.",
  },
  reel_gallery: {
    kicker: "In motion",
    heading: "Micro-reels of the platform at work.",
    subhead: "Short clips (30–60s) of real operator workflows.",
    reels: [
      { title: "Break triage in 30 seconds", video_url: "", poster_url: "", duration_sec: 30 },
      { title: "Agentic auto-match cascade", video_url: "", poster_url: "", duration_sec: 45 },
      { title: "Audit chain walk-through", video_url: "", poster_url: "", duration_sec: 60 },
    ],
  },
  testimonials: {
    kicker: "Voices",
    heading: "What operators and CFOs are saying.",
    items: [
      { quote: "The most rigorous reconciliation platform we've evaluated.", author: "Head of Operations", org: "Tier-1 Bank (reference on request)" },
      { quote: "Agentic AI without giving up control — finally.", author: "Chief Data Officer", org: "Asset Manager" },
    ],
  },
  faq_preview: {
    kicker: "Frequently asked",
    heading: "The short answers.",
    items: [
      { q: "Is this an AI wrapper?", a: "No — reconciliation engine first, agents on top, all auditable." },
      { q: "Can we bring our own LLM keys?", a: "Yes — per-tenant BYO-LLM with envelope-encrypted key vault." },
      { q: "What are the security certifications?", a: "None yet — we claim only what we've earned. Controls are aligned by design to the SOC 2 Trust Services Criteria, with DORA-aligned resilience practices and a hash-chained audit trail. Formal certifications are on the roadmap." },
      { q: "How is data isolated?", a: "Per-tenant RLS everywhere and optional per-tenant KMS/schema." },
    ],
  },
  cta_band: {
    kicker: "Ready?",
    heading: "See ReconIQ on your data.",
    subhead: "Bring a sample file. We'll show recon, breaks, agents, and audit in one session.",
    primary_cta_label: "Book a demo",
    primary_cta_href: "/book-demo",
    secondary_cta_label: "Enterprise FAQ",
    secondary_cta_href: "/enterprise-faq",
  },
  talk_to_falcon: {
    kicker: "Talk to us",
    heading: "Tell us where you are — we'll bring a plan.",
    subhead:
      "ReconIQ Copilot answers product questions and can book time with our team. Or leave your details and we'll reach out within one business day.",
    footnote: "First-response and availability figures are engineered design targets.",
  },
  footer: {
    tagline: "Reconciliation, re-architected for regulated finance.",
    columns: [
      { heading: "Product", links: [{ label: "Overview", href: "/" }, { label: "Solutions", href: "/solutions" }, { label: "Pricing", href: "/pricing" }] },
      { heading: "Company", links: [{ label: "Security", href: "/security" }, { label: "Enterprise FAQ", href: "/enterprise-faq" }, { label: "Status", href: "/status" }] },
      { heading: "Developers", links: [{ label: "API reference", href: "/developers/api-reference" }, { label: "Guides", href: "/developers/guides" }, { label: "Changelog", href: "/developers/changelog" }] },
      { heading: "Legal", links: [{ label: "Due diligence", href: "/due-diligence" }, { label: "Data retention", href: "/retention" }] },
    ],
    address: "ReconIQ · London · Singapore · New York",
    copyright: "© ReconIQ. All rights reserved.",
  },
  social_links: {
    linkedin: "https://www.linkedin.com/company/reconiq",
    x_twitter: "",
    youtube: "",
    github: "",
  },
  seo_meta: {
    site_title: "ReconIQ — AI-native reconciliation for regulated finance",
    site_description: "Enterprise reconciliation with agentic AI, hash-chained audit, and BYO-LLM. Controls aligned by design to SOC 2 and DORA.",
    og_image_url: "",
    twitter_handle: "@falconveritas",
    canonical_domain: "reconiq.example",
    keywords: ["reconciliation", "financial services", "agentic AI", "BYO-LLM", "SOC 2"],
  },
};

const KeyEnum = z.enum(HOMEPAGE_SECTION_KEYS);

export type HomepageBundle = Record<HomepageSectionKey, SectionContent>;

export type HomepageSectionRow = {
  section_key: HomepageSectionKey;
  enabled: boolean;
  content: SectionContent;
  defaults: SectionContent;
  updated_at: string | null;
  updated_by: string | null;
  has_override: boolean;
};

/* -------------------------------------------------------------------------- */
/* Public read (SSR-safe, no auth)                                             */
/* -------------------------------------------------------------------------- */

export const getHomepageSections = createServerFn({ method: "GET" }).handler(
  async (): Promise<HomepageBundle> => {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return { ...HOMEPAGE_DEFAULTS };

    const sb = createClient(url, key, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await sb
      .from("mkt_homepage_sections")
      .select("section_key,content,enabled");

    const merged: HomepageBundle = { ...HOMEPAGE_DEFAULTS };
    if (!error && data) {
      for (const row of data) {
        const k = row.section_key as HomepageSectionKey;
        if (!HOMEPAGE_SECTION_KEYS.includes(k)) continue;
        if (row.enabled === false) continue;
        merged[k] = {
          ...HOMEPAGE_DEFAULTS[k],
          ...((row.content as SectionContent) ?? {}),
        };
      }
    }
    return merged;
  },
);

/* -------------------------------------------------------------------------- */
/* Admin ops                                                                   */
/* -------------------------------------------------------------------------- */

export const listHomepageSectionsAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }): Promise<HomepageSectionRow[]> => {
    await assertMktRole(context, MKT_TAB_ROLES.homepage);

    const { data, error } = await context.supabase
      .from("mkt_homepage_sections")
      .select("section_key,content,enabled,updated_at,updated_by");
    if (error) throw new Error(error.message);
    const rows = new Map<string, {
      content: SectionContent;
      enabled: boolean;
      updated_at: string | null;
      updated_by: string | null;
    }>();
    for (const r of data ?? []) {
      rows.set(r.section_key, {
        content: (r.content as SectionContent) ?? {},
        enabled: r.enabled ?? true,
        updated_at: r.updated_at ?? null,
        updated_by: r.updated_by ?? null,
      });
    }
    return HOMEPAGE_SECTION_KEYS.map((k) => {
      const existing = rows.get(k);
      const defaults = HOMEPAGE_DEFAULTS[k];
      return {
        section_key: k,
        enabled: existing?.enabled ?? true,
        content: { ...defaults, ...(existing?.content ?? {}) },
        defaults,
        updated_at: existing?.updated_at ?? null,
        updated_by: existing?.updated_by ?? null,
        has_override: Boolean(existing),
      };
    });
  });

export const upsertHomepageSection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z
      .object({
        section_key: KeyEnum,
        content: z.record(z.any()),
        enabled: z.boolean().default(true),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertMktRole(context, MKT_TAB_ROLES.homepage);
    const { data: existing } = await context.supabase

      .from("mkt_homepage_sections")
      .select("content, enabled")
      .eq("section_key", data.section_key)
      .maybeSingle();
    const { error } = await context.supabase.from("mkt_homepage_sections").upsert({
      section_key: data.section_key,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      content: data.content as any,
      enabled: data.enabled,
      updated_by: context.userId,
    });
    if (error) throw new Error(error.message);
    const { logMktChange } = await import("./mkt-audit.server");
    await logMktChange({
      entity_type: "homepage_section",
      entity_key: data.section_key,
      action: existing ? "update" : "create",
      actor_id: context.userId,
      actor_email: (context.claims as { email?: string } | undefined)?.email ?? null,
      before: (existing ?? null) as never,
      after: { content: data.content, enabled: data.enabled } as never,
      summary: `${existing ? "Updated" : "Created"} homepage section "${data.section_key}"`,
    });
    return { ok: true };
  });

export const resetHomepageSection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ section_key: KeyEnum }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMktRole(context, MKT_TAB_ROLES.homepage);
    const { data: existing } = await context.supabase

      .from("mkt_homepage_sections")
      .select("content, enabled")
      .eq("section_key", data.section_key)
      .maybeSingle();
    const { error } = await context.supabase
      .from("mkt_homepage_sections")
      .delete()
      .eq("section_key", data.section_key);
    if (error) throw new Error(error.message);
    const { logMktChange } = await import("./mkt-audit.server");
    await logMktChange({
      entity_type: "homepage_section",
      entity_key: data.section_key,
      action: "reset",
      actor_id: context.userId,
      actor_email: (context.claims as { email?: string } | undefined)?.email ?? null,
      before: (existing ?? null) as never,
      after: null,
      summary: `Reset homepage section "${data.section_key}" to defaults`,
    });
    return { ok: true };
  });
