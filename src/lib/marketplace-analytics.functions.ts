/**
 * Phase 3 Strategic — Marketplace analytics.
 *
 * Reads the SQL view `v_marketplace_analytics` (installs → workspace usage →
 * outcome telemetry) under the caller's RLS. Platform staff see every
 * listing; tenant users see only what their installs joined into.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getMarketplaceAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("v_marketplace_analytics" as never)
      .select(
        "listing_id, slug, title, kind, tier, channel, status, install_count, installed_tenants, active_workspaces, usage_events, rating_avg, rating_count, last_installed_at, last_used_at",
      )
      .order("install_count", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return (data ?? []) as Array<{
      listing_id: string;
      slug: string;
      title: string;
      kind: string;
      tier: string;
      channel: string;
      status: string;
      install_count: number;
      installed_tenants: number;
      active_workspaces: number;
      usage_events: number;
      rating_avg: number | null;
      rating_count: number;
      last_installed_at: string | null;
      last_used_at: string | null;
    }>;
  });
