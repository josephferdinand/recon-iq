// Phase 6 — Calendar-aware SLA computation
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const computeBusinessSlaDueAt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      start: z.string().datetime(),
      sla_minutes: z.number().int().min(1).max(60 * 24 * 30),
      mic_code: z.string().min(3).max(8).default("XNYS"),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: due, error } = await context.supabase.rpc("sla_business_due_at", {
      _start: data.start,
      _sla_minutes: data.sla_minutes,
      _mic_code: data.mic_code,
    } as never);
    if (error) throw new Error(error.message);
    return { due_at: due as string };
  });
