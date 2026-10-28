import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ThemeSchema = z.enum(["light", "dark", "system"]);
const DensitySchema = z.enum(["compact", "cozy", "comfortable"]);

export const getUiPreferences = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("user_ui_preferences")
      .select("theme, density, reduce_motion, high_contrast, sidebar_collapsed, keyboard_hints, palette_slug")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (
      data ?? {
        theme: "system",
        density: "comfortable",
        reduce_motion: false,
        high_contrast: false,
        sidebar_collapsed: false,
        keyboard_hints: true,
        palette_slug: null,
      }
    );
  });

export const updateUiPreferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z
      .object({
        theme: ThemeSchema.optional(),
        density: DensitySchema.optional(),
        reduce_motion: z.boolean().optional(),
        high_contrast: z.boolean().optional(),
        sidebar_collapsed: z.boolean().optional(),
        keyboard_hints: z.boolean().optional(),
        palette_slug: z.string().max(64).nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const payload = { user_id: context.userId, ...data } as any;
    const { error } = await context.supabase
      .from("user_ui_preferences")
      .upsert(payload, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const registerMobileDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z
      .object({
        platform: z.enum(["ios", "android", "web"]),
        push_token: z.string().min(8).max(512),
        device_name: z.string().max(120).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("mobile_devices")
      .upsert(
        {
          user_id: context.userId,
          platform: data.platform,
          push_token: data.push_token,
          device_name: data.device_name ?? null,
          last_seen_at: new Date().toISOString(),
        } as any,
        { onConflict: "user_id,push_token" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
