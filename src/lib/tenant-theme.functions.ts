import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantAdmin } from "@/lib/rbac-guards.server";
import { z } from "zod";
import {
  THEME_CHROME_IDS,
  THEME_PALETTE_IDS,
  normalizeChromeId,
  normalizePaletteId,
} from "@/lib/theme-config";

export type TenantThemeRow = {
  tenant_id: string;
  palette_id: string;
  side_chrome_id: string;
  top_chrome_id: string;
  dual_mode: boolean;
  updated_at: string;
};

export const getTenantTheme = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenantId: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("tenant_theme_settings")
      .select("tenant_id,palette_id,side_chrome_id,top_chrome_id,dual_mode,updated_at")
      .eq("tenant_id", data.tenantId)
      .maybeSingle();
    if (error) throw error;
    if (!row) return null;
    return {
      ...(row as TenantThemeRow),
      palette_id: normalizePaletteId(row.palette_id),
      side_chrome_id: normalizeChromeId(row.side_chrome_id),
      top_chrome_id: normalizeChromeId(row.top_chrome_id),
    };
  });

export const setTenantTheme = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenantId: z.string().uuid(),
    paletteId: z.enum(THEME_PALETTE_IDS),
    sideChromeId: z.enum(THEME_CHROME_IDS),
    topChromeId: z.enum(THEME_CHROME_IDS),
    dualMode: z.boolean(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await requireTenantAdmin(context, data.tenantId, { fnName: "setTenantTheme" });
    const payload = {
      tenant_id: data.tenantId,
      palette_id: data.paletteId,
      side_chrome_id: data.sideChromeId,
      top_chrome_id: data.dualMode ? data.topChromeId : data.sideChromeId,
      dual_mode: data.dualMode,
      updated_by: context.userId,
    };
    const { error } = await context.supabase
      .from("tenant_theme_settings")
      .upsert(payload, { onConflict: "tenant_id" });
    if (error) throw error;
    return { ok: true as const };
  });
