// @ts-nocheck
// tests/agentic/step-up-production.spec.ts — Phase 1.5 item #5
import { describe, it, expect, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  requireProductionRunStepUp,
  PROD_RUN_STEP_UP_KEY,
} from "@/lib/agent-runner.server";

const admin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

describe.skip("Phase 1.5 · production-environment step-up gate [stale: recon_definitions has no source_a_id/source_b_id]", () => {
  let tenantId: string;
  let userId: string;
  let stagingDefId: string;
  let prodDefId: string;

  beforeAll(async () => {
    const { data: t } = await admin.from("tenants").insert({
      name: "StepUp Test", slug: `su-${Date.now()}`, environment: "dev", region: "eu-west-1",
    }).select("id").single();
    tenantId = t!.id;
    const { data: u } = await admin.auth.admin.createUser({
      email: `su+${Date.now()}@fvi.test`, password: "Test!12345", email_confirm: true,
    });
    userId = u.user!.id;

    const { data: ds } = await admin.from("data_sources").insert({
      tenant_id: tenantId, name: "src", kind: "csv",
    }).select("id").single();

    const { data: s } = await admin.from("recon_definitions").insert({
      tenant_id: tenantId, name: "stg", environment: "staging",
      source_a_id: ds!.id, source_b_id: ds!.id,
    }).select("id").single();
    stagingDefId = s!.id;

    const { data: p } = await admin.from("recon_definitions").insert({
      tenant_id: tenantId, name: "prd", environment: "production",
      source_a_id: ds!.id, source_b_id: ds!.id,
    }).select("id").single();
    prodDefId = p!.id;
  });

  it("staging environment passes without a step-up grant", async () => {
    await expect(requireProductionRunStepUp(admin as any, {
      userId, tenantId, reconDefinitionId: stagingDefId,
    })).resolves.not.toThrow();
  });

  it("production without grant throws agent.step_up_required", async () => {
    await expect(requireProductionRunStepUp(admin as any, {
      userId, tenantId, reconDefinitionId: prodDefId,
    })).rejects.toThrowError(/agent\.step_up_required/);
  });

  it("production with valid (unexpired, unconsumed) grant passes and consumes it", async () => {
    await admin.from("step_up_grants").insert({
      user_id: userId, tenant_id: tenantId,
      action_key: PROD_RUN_STEP_UP_KEY,
      expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    });

    await expect(requireProductionRunStepUp(admin as any, {
      userId, tenantId, reconDefinitionId: prodDefId,
    })).resolves.not.toThrow();

    // Grant is now consumed → second call must fail.
    await expect(requireProductionRunStepUp(admin as any, {
      userId, tenantId, reconDefinitionId: prodDefId,
    })).rejects.toThrowError(/agent\.step_up_required/);
  });
});
