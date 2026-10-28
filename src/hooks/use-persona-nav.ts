/**
 * usePersonaNav — Phase 3 Strategic (Item S5).
 *
 * Dynamic left-rail composition from the current user's role bundles +
 * entitlements. Returns the ordered list of nav items the user is
 * entitled to see, so the sidebar is composed from data rather than a
 * static route list per surface.
 *
 * Backed by `rbac_user_grants` + `entitlement_scope_grants` under RLS.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PersonaNavItem {
  key: string;
  label: string;
  href: string;
  domain: string;
  entitlement?: string;
}

// Canonical catalog — each surface declares the entitlement it requires.
const CATALOG: PersonaNavItem[] = [
  // Platform
  { key: "platform.tenants",      label: "Tenants",              href: "/platform?page=tenants",       domain: "Tenancy",              entitlement: "platform.tenants.read" },
  { key: "platform.marketplace",  label: "Marketplace analytics", href: "/platform-marketplace-analytics", domain: "Marketplace",       entitlement: "platform.marketplace.read" },
  { key: "platform.ai-ops",       label: "AI Ops",               href: "/hub/ai-ops",                   domain: "AI Control Plane",     entitlement: "platform.ai.read" },
  { key: "platform.observability", label: "Observability",        href: "/hub/observability",           domain: "Reliability",          entitlement: "platform.observability.read" },
  { key: "platform.resilience",   label: "Resilience Center",     href: "/hub/resilience",              domain: "Reliability",          entitlement: "platform.resilience.read" },
  { key: "platform.vault",        label: "Key & Secret Vault",    href: "/hub/vault",                   domain: "Security",             entitlement: "platform.vault.read" },
  { key: "platform.access",       label: "Access Control",        href: "/hub/access",                  domain: "Identity & Access",    entitlement: "platform.access.read" },
  { key: "platform.reporting",    label: "Reporting Studio",      href: "/hub/reporting",               domain: "Reporting",            entitlement: "platform.reporting.read" },
  // Workspace-scoped
  { key: "workspace.exceptions",  label: "Exception Workbench",   href: "/hub/exceptions",              domain: "Recon",                entitlement: "workspace.recon.read" },
  { key: "workspace.analytics",   label: "Analytics Hub",         href: "/hub/analytics",               domain: "Analytics",            entitlement: "workspace.analytics.read" },
];

export function usePersonaNav(userId?: string) {
  return useQuery<PersonaNavItem[]>({
    queryKey: ["persona-nav", userId ?? null],
    staleTime: 60_000,
    queryFn: async () => {
      if (!userId) return CATALOG;
      // Best-effort: fetch entitlements; RLS filters to caller.
      const { data: grants } = await supabase
        .from("entitlement_scope_grants")
        .select("entitlement_key")
        .limit(500);
      const held = new Set((grants ?? []).map((g: any) => g.entitlement_key as string));
      // If we can't see grants, don't hide anything — server RLS will still gate the pages.
      if (held.size === 0) return CATALOG;
      return CATALOG.filter((item) => !item.entitlement || held.has(item.entitlement));
    },
  });
}
