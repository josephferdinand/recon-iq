import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import type { ThemeTokens, DarkThemeTokens } from "@/lib/mkt-site-themes.functions";

const PUBLIC_PREFIXES = ["/", "/about", "/pricing", "/security", "/contact",
  "/book-demo", "/roi", "/status", "/retention", "/due-diligence", "/solutions"];

function isMarketingPath(p: string): boolean {
  if (p === "/") return true;
  if (p.startsWith("/mkt-admin") || p.startsWith("/auth") ||
      p.startsWith("/reset-password") || p.startsWith("/confirm-auth") ||
      p.startsWith("/api") || p.startsWith("/t/") ||
      p.startsWith("/m/") || p.startsWith("/_")) return false;
  return PUBLIC_PREFIXES.some((prefix) => prefix !== "/" && p.startsWith(prefix));
}

/** Derive an accessible dark pair when admin has not provided explicit
 * dark_tokens: swap background/foreground so contrast is preserved. */
function deriveDark(t: ThemeTokens, override: DarkThemeTokens | null | undefined): ThemeTokens {
  const base: ThemeTokens = {
    ...t,
    background: t.foreground,
    foreground: t.background,
    secondary: t.foreground,
  };
  return { ...base, ...(override ?? {}) } as ThemeTokens;
}

function toCssVars(light: ThemeTokens, dark: ThemeTokens): string {
  return `
:root[data-mkt-theme="on"] {
  --mkt-primary: ${light.primary};
  --mkt-secondary: ${light.secondary};
  --mkt-accent: ${light.accent};
  --mkt-background: ${light.background};
  --mkt-foreground: ${light.foreground};
  --mkt-radius: ${light.radius};
  --mkt-display-font: "${light.display_font}", ui-sans-serif, system-ui, sans-serif;
  --mkt-body-font: "${light.body_font}", ui-sans-serif, system-ui, sans-serif;
}
:root[data-mkt-theme="on"].dark,
:root[data-mkt-theme="on"][data-mkt-mode="dark"] {
  --mkt-primary: ${dark.primary};
  --mkt-secondary: ${dark.secondary};
  --mkt-accent: ${dark.accent};
  --mkt-background: ${dark.background};
  --mkt-foreground: ${dark.foreground};
}
`.trim();
}

export function MktThemeMount() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [css, setCss] = useState<string | null>(null);

  useEffect(() => {
    if (!isMarketingPath(pathname)) {
      document.documentElement.removeAttribute("data-mkt-theme");
      setCss(null);
      return;
    }
    let cancelled = false;
    (async () => {
      let previewId: string | null = null;
      try {
        const url = new URL(window.location.href);
        previewId = url.searchParams.get("theme_preview");
      } catch { /* ignore */ }

      const query = previewId
        ? supabase.from("mkt_site_themes").select("tokens, dark_tokens").eq("id", previewId).maybeSingle()
        : supabase.from("mkt_site_themes").select("tokens, dark_tokens").eq("status", "active").maybeSingle();
      const { data } = await query;
      if (cancelled) return;
      if (data?.tokens) {
        const light = data.tokens as unknown as ThemeTokens;
        const dark = deriveDark(light, data.dark_tokens as unknown as DarkThemeTokens | null);
        document.documentElement.setAttribute("data-mkt-theme", "on");
        setCss(toCssVars(light, dark));
      } else {
        document.documentElement.removeAttribute("data-mkt-theme");
        setCss(null);
      }
    })().catch(() => { /* silent — fall back to default brand palette */ });

    return () => { cancelled = true; };
  }, [pathname]);

  if (!css) return null;
  return <style data-mkt-theme-runtime="1">{css}</style>;
}
