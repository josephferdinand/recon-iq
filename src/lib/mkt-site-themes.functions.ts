import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertMktRole } from "./mkt-admin.functions";
import { MKT_TAB_ROLES } from "./mkt-admin-roles";
import { z } from "zod";
import { logMktChange, resolveMktActorContext } from "./mkt-audit.server";

/** Tokens managed by the dynamic site-theme engine. */
export const themeTokensSchema = z.object({
  primary: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  secondary: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  background: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  foreground: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  button_style: z.enum(["solid", "outline", "soft"]).default("solid"),
  radius: z.string().max(16).default("0.75rem"),
  display_font: z.string().max(60).default("Space Grotesk"),
  body_font: z.string().max(60).default("DM Sans"),
});
export type ThemeTokens = z.infer<typeof themeTokensSchema>;

/** Dark-mode override tokens. Optional; when omitted, MktThemeMount
 * auto-derives an accessible pair by swapping background/foreground. */
export const darkThemeTokensSchema = themeTokensSchema.partial();
export type DarkThemeTokens = z.infer<typeof darkThemeTokensSchema>;

export type SiteTheme = {
  id: string;
  name: string;
  description: string | null;
  tokens: ThemeTokens;
  dark_tokens: DarkThemeTokens | null;
  status: "draft" | "scheduled" | "active" | "archived";
  scheduled_at: string | null;
  activated_at: string | null;
  version: number;
  is_preset: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ThemeVersion = {
  id: string;
  version: number;
  tokens: ThemeTokens;
  dark_tokens: DarkThemeTokens | null;
  activated_at: string;
  activated_by: string | null;
  note: string | null;
};

const upsertInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional().nullable(),
  tokens: themeTokensSchema,
  dark_tokens: darkThemeTokensSchema.optional().nullable(),
  scheduled_at: z.string().datetime().optional().nullable(),
});

async function actorEmail(context: { userId: string; supabase: { auth: { getUser: () => Promise<{ data: { user: { email?: string | null } | null } }> } } }): Promise<string | null> {
  try {
    const { data } = await context.supabase.auth.getUser();
    return data.user?.email ?? null;
  } catch { return null; }
}

/** Admin: list all themes. */
export const listSiteThemes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    await assertMktRole(context, MKT_TAB_ROLES.themes);
    const { data, error } = await context.supabase
      .from("mkt_site_themes")
      .select("*")
      .order("status", { ascending: true })
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return ((data ?? []) as unknown) as SiteTheme[];
  });

/** Admin: create or update a theme. Never activates. */
export const upsertSiteTheme = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => upsertInput.parse(d))
  .handler(async ({ data, context }) => {
    const effectiveRoles = await assertMktRole(context, MKT_TAB_ROLES.themes);
    const isNew = !data.id;
    const row = {
      ...data,
      status: data.scheduled_at ? "scheduled" : "draft",
      created_by: context.userId,
    };
    const { data: out, error } = await context.supabase
      .from("mkt_site_themes")
      .upsert(row)
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const actor = await resolveMktActorContext(context, { roles: effectiveRoles, source: "assertMktRole:themes" });
    await logMktChange({
      entity_type: "site_theme",
      entity_key: out.id,
      action: isNew ? "create" : (data.scheduled_at ? "schedule" : "update"),
      actor_id: context.userId,
      actor_email: actor.email,
      actor_context: actor,
      after: { name: data.name, tokens: data.tokens, dark_tokens: data.dark_tokens ?? null, scheduled_at: data.scheduled_at ?? null },
      summary: `Theme "${data.name}" ${isNew ? "created" : (data.scheduled_at ? "scheduled" : "updated")}`,
    });
    return { id: out.id };
  });

/** Admin: activate a theme immediately. Requires MFA step-up. */
export const activateSiteTheme = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid(), note: z.string().max(500).optional() }).parse(d))
  .handler(async ({ data, context }) => {
    const effectiveRoles = await assertMktRole(context, MKT_TAB_ROLES.themes);
    const { requireMktStepUp } = await import("./mkt-stepup.server");
    await requireMktStepUp(context, { entity_type: "site_theme", entity_key: data.id, action: "activate" });
    const { data: theme, error: readErr } = await context.supabase
      .from("mkt_site_themes")
      .select("id, name, tokens, dark_tokens, version")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr || !theme) throw new Error(readErr?.message || "Theme not found");
    const nextVersion = (theme.version ?? 1) + 1;
    const { error: upErr } = await context.supabase
      .from("mkt_site_themes")
      .update({ status: "active", version: nextVersion, activated_at: new Date().toISOString() })
      .eq("id", data.id);
    if (upErr) throw new Error(upErr.message);
    await context.supabase.from("mkt_site_theme_versions").insert({
      theme_id: data.id,
      version: nextVersion,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tokens: theme.tokens as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      dark_tokens: (theme.dark_tokens ?? null) as any,
      activated_by: context.userId,
      note: data.note ?? null,
    });
    const actor = await resolveMktActorContext(context, { roles: effectiveRoles, source: "assertMktRole:themes+stepup" });
    await logMktChange({
      entity_type: "site_theme",
      entity_key: data.id,
      action: "activate",
      actor_id: context.userId,
      actor_email: actor.email,
      actor_context: actor,
      after: { version: nextVersion, name: (theme as { name?: string }).name ?? null },
      summary: `Activated theme v${nextVersion}${data.note ? ` — ${data.note}` : ""}`,
    });
    return { ok: true, version: nextVersion };
  });

/** Admin: archive a theme (soft-remove). Requires MFA step-up. */
export const archiveSiteTheme = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const effectiveRoles = await assertMktRole(context, MKT_TAB_ROLES.themes);
    const { requireMktStepUp } = await import("./mkt-stepup.server");
    await requireMktStepUp(context, { entity_type: "site_theme", entity_key: data.id, action: "archive" });
    const { error } = await context.supabase
      .from("mkt_site_themes")
      .update({ status: "archived" })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    const actor = await resolveMktActorContext(context, { roles: effectiveRoles, source: "assertMktRole:themes+stepup" });
    await logMktChange({
      entity_type: "site_theme",
      entity_key: data.id,
      action: "archive",
      actor_id: context.userId,
      actor_email: actor.email,
      actor_context: actor,
      summary: `Theme archived`,
    });
    return { ok: true };
  });

/** Admin: version history for one theme. */
export const listThemeVersions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMktRole(context, MKT_TAB_ROLES.themes);
    const { data: rows, error } = await context.supabase
      .from("mkt_site_theme_versions")
      .select("id, version, tokens, dark_tokens, activated_at, activated_by, note")
      .eq("theme_id", data.id)
      .order("version", { ascending: false });
    if (error) throw new Error(error.message);
    return ((rows ?? []) as unknown) as ThemeVersion[];
  });

/** Admin: one-click rollback. Restores the tokens from a prior version
 * onto the theme, then activates it as a new version (so history is
 * append-only). Audited as `rollback`. */
export const rollbackSiteTheme = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    theme_id: z.string().uuid(),
    version_id: z.string().uuid(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const effectiveRoles = await assertMktRole(context, MKT_TAB_ROLES.themes);
    const { requireMktStepUp } = await import("./mkt-stepup.server");
    await requireMktStepUp(context, { entity_type: "site_theme", entity_key: data.theme_id, action: "rollback" });

    const { data: ver, error: verErr } = await context.supabase
      .from("mkt_site_theme_versions")
      .select("id, theme_id, version, tokens, dark_tokens")
      .eq("id", data.version_id)
      .maybeSingle();
    if (verErr || !ver) throw new Error(verErr?.message || "Version not found");
    if (ver.theme_id !== data.theme_id) throw new Error("Version does not belong to theme");

    const { data: cur, error: curErr } = await context.supabase
      .from("mkt_site_themes")
      .select("id, name, version, tokens, dark_tokens")
      .eq("id", data.theme_id)
      .maybeSingle();
    if (curErr || !cur) throw new Error(curErr?.message || "Theme not found");

    const nextVersion = (cur.version ?? 1) + 1;
    const { error: upErr } = await context.supabase
      .from("mkt_site_themes")
      .update({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tokens: ver.tokens as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        dark_tokens: (ver.dark_tokens ?? null) as any,
        status: "active",
        version: nextVersion,
        activated_at: new Date().toISOString(),
      })
      .eq("id", data.theme_id);
    if (upErr) throw new Error(upErr.message);

    await context.supabase.from("mkt_site_theme_versions").insert({
      theme_id: data.theme_id,
      version: nextVersion,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tokens: ver.tokens as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      dark_tokens: (ver.dark_tokens ?? null) as any,
      activated_by: context.userId,
      note: `Rollback to v${ver.version}`,
    });

    const actor = await resolveMktActorContext(context, { roles: effectiveRoles, source: "assertMktRole:themes+stepup" });
    await logMktChange({
      entity_type: "site_theme",
      entity_key: data.theme_id,
      action: "rollback",
      actor_id: context.userId,
      actor_email: actor.email,
      actor_context: actor,
      before: { version: cur.version, tokens: cur.tokens, dark_tokens: cur.dark_tokens },
      after:  { version: nextVersion, restored_from_version: ver.version, tokens: ver.tokens, dark_tokens: ver.dark_tokens },
      summary: `Rolled back "${cur.name}" to v${ver.version} (now live as v${nextVersion})`,
    });

    return { ok: true, version: nextVersion, restored_from: ver.version };
  });
