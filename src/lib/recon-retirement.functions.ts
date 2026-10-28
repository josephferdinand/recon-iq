import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const Scope = z.object({ tenant_id: z.string().uuid() });
const Request = Scope.extend({ recon_id: z.string().uuid(), reason: z.string().trim().min(12).max(1000) });
const Decision = z.object({ request_id: z.string().uuid(), approve: z.boolean(), reason: z.string().trim().min(12).max(1000) });

type RetirementRequest = {
  id: string;
  recon_id: string;
  reason: string;
  requested_at: string;
  mine: boolean;
};

// The retirement table/RPCs are installed by the additive database migration.
// A local preview pointed at a pre-migration DEV database must say unavailable,
// never present an empty queue as if the control is already active.
export const listReconRetirementRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => Scope.parse(input))
  .handler(async ({ data, context }): Promise<{ available: boolean; rows: RetirementRequest[] }> => {
    const { data: rows, error } = await (context.supabase as any)
      .from("recon_retirement_requests")
      .select("id, recon_id, reason, requested_by, requested_at")
      .eq("tenant_id", data.tenant_id)
      .eq("status", "pending")
      .order("requested_at", { ascending: false })
      .limit(100);
    if (error?.code === "42P01" || error?.code === "PGRST205") return { available: false, rows: [] };
    if (error) throw new Error("Retirement requests are unavailable. Please try again.");
    return {
      available: true,
      rows: (rows ?? []).map((row: any) => ({
        id: row.id, recon_id: row.recon_id, reason: row.reason,
        requested_at: row.requested_at, mine: row.requested_by === context.userId,
      })),
    };
  });

export const requestReconRetirement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => Request.parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).rpc("request_recon_retirement", {
      _tenant_id: data.tenant_id, _recon_id: data.recon_id, _reason: data.reason,
    });
    if (error) throw new Error("The retirement request could not be submitted. Check your access and try again.");
    return result?.[0] ?? null;
  });

export const decideReconRetirement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => Decision.parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as any).rpc("decide_recon_retirement", {
      _request_id: data.request_id, _approve: data.approve, _reason: data.reason,
    });
    if (error) throw new Error("The retirement decision was not saved. Check your access and try again.");
    return result?.[0] ?? null;
  });
