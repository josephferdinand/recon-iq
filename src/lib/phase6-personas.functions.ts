// Phase 6 — Copilot personas (Auditor, etc.) read-only fetch.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listCopilotPersonas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator(() => ({}))
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("copilot_personas").select("*").order("name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getCopilotPersona = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ code: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("copilot_personas").select("*").eq("code", data.code).maybeSingle();
    if (error) throw new Error(error.message);
    return row;
  });

export const listBreakCategoryCatalog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator(() => ({}))
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("break_category_catalog").select("*").order("code");
    if (error) throw new Error(error.message);
    return data ?? [];
  });
