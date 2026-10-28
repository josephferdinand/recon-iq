import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";

/**
 * Onboarding Wizard — Sprint 3 Feature 3.
 *
 * The wizard persists to the `onboarding_progress` table via the SQL function
 * `upsert_onboarding_step(_tenant_id, _step, _payload)`. The RLS policy
 * already restricts reads/writes to the row's owner, so we use the user's
 * own JWT (via `context.supabase`) — never service_role — for step writes.
 *
 * Step 6 (first test run) is the only step that requires service_role
 * because it creates a `recon_runs` row that bootstraps the matching engine.
 */

const TenantStepSchema = z.object({
  tenant_id: z.string().uuid(),
  step: z.number().int().min(1).max(6),
  payload: z.unknown(),
});

export type OnboardingProgress = {
  id: string;
  tenant_id: string;
  user_id: string;
  current_step: number;
  completed_steps: number[];
  step1_tenant: Json | null;
  step2_data_source: Json | null;
  step3_rule: Json | null;
  step4_team: Json | null;
  step5_sso: Json | null;
  step6_first_run: Json | null;
  started_at: string;
  last_resumed_at: string;
  completed_at: string | null;
};

export const getOnboardingProgress = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string }) =>
    z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("onboarding_progress")
      .select("*")
      .eq("tenant_id", data.tenant_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (row ?? null) as OnboardingProgress | null;
  });

export const upsertOnboardingStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string; step: number; payload: unknown }) =>
    TenantStepSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.rpc("upsert_onboarding_step", {
      _tenant_id: data.tenant_id,
      _step: data.step,
      _payload: data.payload as never,
    });
    if (error) throw new Error(error.message);
    return row as OnboardingProgress;
  });

export const completeOnboardingWizard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string }) =>
    z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.rpc("complete_onboarding", {
      _tenant_id: data.tenant_id,
    });
    if (error) throw new Error(error.message);
    return row as OnboardingProgress;
  });

/**
 * Step 6 first test run — creates a minimal recon_runs row so the wizard's
 * final step actually demonstrates the matching engine. Wraps service_role
 * because creating recon_runs requires elevated write access.
 */
const FirstRunSchema = z.object({
  tenant_id: z.string().uuid(),
  recon_definition_id: z.string().uuid().optional(),
});

export const launchFirstTestRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string; recon_definition_id?: string }) =>
    FirstRunSchema.parse(d))
  .handler(async ({ data, context }) => {
    // Pick the first active recon_definitions row for the tenant if not supplied
    let reconId = data.recon_definition_id;
    if (!reconId) {
      const { data: rd, error: rdErr } = await context.supabase
        .from("recon_definitions")
        .select("id")
        .eq("tenant_id", data.tenant_id)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (rdErr) throw new Error(rdErr.message);
      if (!rd) {
        throw new Error("No active reconciliation definition found for this tenant");
      }
      reconId = (rd as { id: string }).id;
    }

    const { data: run, error } = await supabaseAdmin
      .from("recon_runs")
      .insert({
        tenant_id: data.tenant_id,
        definition_id: reconId,
        status: "queued",
        started_at: new Date().toISOString(),
        run_by: context.userId,
      })
       .select("id, run_uid, status, started_at")
      .single();
    if (error) throw new Error(error.message);

    // Persist the run reference back into the wizard state
    const { error: persistErr } = await context.supabase.rpc("upsert_onboarding_step", {
      _tenant_id: data.tenant_id,
      _step: 6,
      _payload: { run },
    });
    if (persistErr) throw new Error(persistErr.message);

    return run;
  });
