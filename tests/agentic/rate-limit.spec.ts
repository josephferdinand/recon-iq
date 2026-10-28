// @ts-nocheck
// tests/agentic/rate-limit.spec.ts — Phase 1.5 item #4 (Fable close-out).
//
// Proves the hourly limiter buckets by `action_kind` (not by raw `tool`).
// Each seeded agent_action sets action_kind explicitly so the test does NOT
// rely on the BEFORE-INSERT backfill trigger; we want the assertion to fail
// loudly if the schema column or the limiter query ever drift apart again.

import { describe, it, expect, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { enforceHourlyActionLimit, countActionsLastHour } from "@/lib/agent-runner.server";

const admin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

describe("Phase 1.5 · per-(tenant, action_kind) hourly rate-limit", () => {
  let tenantA: string;
  let tenantB: string;
  let tenantC: string;
  let runId: string;

  async function makeTenant(label: string) {
    const safe = label.toLowerCase().replace(/[^a-z0-9]/g, "");
    const { data } = await admin.from("tenants").insert({
      name: label,
      slug: `${safe}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      environment: "dev", region: "eu-west-1",
    }).select("id").single();
    return data!.id;
  }

  beforeAll(async () => {
    tenantA = await makeTenant("RL_A");
    tenantB = await makeTenant("RL_B");
    tenantC = await makeTenant("RL_C");

    // Tight limit on tenant A so the original at-limit test still passes.
    await admin.from("agent_action_hourly_limits").insert({
      tenant_id: tenantA, agent_key: "default", action_kind: "resolve_breaks", limit_per_hour: 2,
    });
    // Fable's mandated fixture: limit=3 on tenant C.
    await admin.from("agent_action_hourly_limits").insert({
      tenant_id: tenantC, agent_key: "default", action_kind: "resolve_breaks", limit_per_hour: 3,
    });

    const { data: u } = await admin.auth.admin.createUser({
      email: `rl+${Date.now()}@fvi.test`, password: "Test!12345", email_confirm: true,
    });
    const { data: r } = await admin.from("agent_runs").insert({
      tenant_id: tenantA, user_id: u.user!.id, objective: "rl", mode: "execute", status: "succeeded",
    }).select("id").single();
    runId = r!.id;
  });

  async function seedAction(tenantId: string, tool: string, actionKind: string) {
    await admin.from("agent_actions").insert({
      run_id: runId, tenant_id: tenantId, tool,
      action_kind: actionKind,
      input: {}, status: "completed", proposed: false, policy_ceiling: "assist",
    });
  }

  it("under limit passes", async () => {
    await seedAction(tenantA, "set_break_lifecycle", "resolve_breaks"); // 1 of 2
    await expect(enforceHourlyActionLimit(admin as any, {
      tenantId: tenantA, agentKey: "default", actionKind: "resolve_breaks",
    })).resolves.not.toThrow();
  });

  it("at limit throws agent.rate_limit_exceeded", async () => {
    await seedAction(tenantA, "set_break_lifecycle", "resolve_breaks"); // 2 of 2
    await expect(enforceHourlyActionLimit(admin as any, {
      tenantId: tenantA, agentKey: "default", actionKind: "resolve_breaks",
    })).rejects.toThrowError(/agent\.rate_limit_exceeded/);
  });

  it("tenants are independent (tenant B unaffected)", async () => {
    await expect(enforceHourlyActionLimit(admin as any, {
      tenantId: tenantB, agentKey: "default", actionKind: "resolve_breaks",
    })).resolves.not.toThrow();
  });

  // Fable-mandated fixture: 5 actions against a limit of 3 MUST throw — proving
  // the limiter actually counts (not silently passes because column mismatch).
  it("5 actions vs limit=3 throws (regression for tool-vs-action_kind mismatch)", async () => {
    // Seed 5 actions on tenant C; mix the tools to prove kind-bucketing,
    // not tool-bucketing, is what the limiter uses.
    for (let i = 0; i < 5; i++) {
      await seedAction(
        tenantC,
        i % 2 === 0 ? "set_break_lifecycle" : "set_break_lifecycle",
        "resolve_breaks",
      );
    }
    const used = await countActionsLastHour(admin as any, tenantC, "resolve_breaks");
    expect(used).toBe(5);

    await expect(enforceHourlyActionLimit(admin as any, {
      tenantId: tenantC, agentKey: "default", actionKind: "resolve_breaks",
    })).rejects.toThrowError(/agent\.rate_limit_exceeded/);
  });

  it("different action_kinds on same tenant do NOT cross-count", async () => {
    // Seed a different kind on tenant C; should not affect resolve_breaks bucket.
    await seedAction(tenantC, "add_break_comment", "assign_breaks");
    const usedOther = await countActionsLastHour(admin as any, tenantC, "assign_breaks");
    expect(usedOther).toBe(1);
    const usedResolve = await countActionsLastHour(admin as any, tenantC, "resolve_breaks");
    expect(usedResolve).toBe(5); // unchanged
  });
});
