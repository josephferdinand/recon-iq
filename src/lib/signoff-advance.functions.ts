// Certification stepper — server fns that drive the eod_signoffs state machine.
// Step 2 of Period-Close v2.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const AllowedStatuses = [
  "prepared",
  "reviewed",
  "certified",
  "rejected",
  "reopened",
] as const;

const AdvanceInput = z.object({
  signoff_id: z.string().uuid(),
  to_status: z.enum(AllowedStatuses),
  comment: z.string().max(2000).optional().nullable(),
  evidence_hash: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional()
    .nullable(),
});

export const advanceSignoff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => AdvanceInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.rpc("advance_signoff", {
      _signoff_id: data.signoff_id,
      _to_status: data.to_status,
      _comment: data.comment ?? undefined,
      _evidence_hash: data.evidence_hash ?? undefined,
    });
    if (error) throw new Error(error.message);
    return row;
  });

export const listAllowedSignoffTransitions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { signoff_id: string }) =>
    z.object({ signoff_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc(
      "list_allowed_signoff_transitions",
      { _signoff_id: data.signoff_id },
    );
    if (error) throw new Error(error.message);
    return (rows ?? []) as string[];
  });

export const listSignoffTransitions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { signoff_id: string }) =>
    z.object({ signoff_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("signoff_transitions")
      .select("*")
      .eq("signoff_id", data.signoff_id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
