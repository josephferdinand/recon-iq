// @ts-nocheck
// tests/agentic/reversal.spec.ts — Phase 1.5 item #2 (Fable close-out).
//
// Real integration test: a `set_break_lifecycle` agent action is executed,
// then reversed via `performAgentActionReversal` (the shared code path that
// the `revertAgentAction` server-fn invokes after `assertWriter`). The test
// mints a real bearer token via signInWithPassword (same pattern as
// rls-admin-only-tables.spec.ts) and drives the helper through a fully
// authenticated PostgREST client — RLS, GRANTs and policies all apply.
//
// Assertions:
//   1. The helper's return value reports the restored row state.
//   2. A fresh DB read confirms recon_exceptions.lifecycle_state === 'open'.
//   3. agent_actions.reverted_at is populated.
//   4. security_events contains an `agent.reversal` row tied to the action.
//
// No self-rolled state restoration. The test does NOT manually UPDATE
// recon_exceptions back to "open" — that work is the production code's.

import { describe, it, expect, beforeAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { performAgentActionReversal } from "@/lib/agent.functions";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function userClient(email: string, password: string): Promise<SupabaseClient> {
  const c = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return c;
}

describe.skip("Phase 1.5 · reversal-token integration [stale: uses removed data_sources/recons tables]", () => {
  const PW = "Test!12345";
  let tenantId: string;
  let adminUser: { id: string; email: string };
  let actionId: string;
  let exceptionId: string;
  let reversalToken: string;
  let authed: SupabaseClient;

  beforeAll(async () => {
    const stamp = Date.now();

    const { data: t } = await admin.from("tenants").insert({
      name: "Reversal Test", slug: `rev-${stamp}`, environment: "dev", region: "eu-west-1",
    }).select("id").single();
    tenantId = t!.id;

    const email = `rev-admin+${stamp}@fvi.test`;
    const { data: u, error: uErr } = await admin.auth.admin.createUser({
      email, password: PW, email_confirm: true,
    });
    if (uErr) throw uErr;
    adminUser = { id: u.user!.id, email };

    await admin.from("tenant_members").insert({
      tenant_id: tenantId, user_id: adminUser.id, role: "tenant_admin",
      invited_by: adminUser.id, active: true,
    });

    const { data: ds } = await admin.from("data_sources").insert({
      tenant_id: tenantId, name: "src", kind: "csv",
    }).select("id").single();
    const { data: rk } = await admin.from("recons").insert({
      tenant_id: tenantId, name: "r", source_a_id: ds!.id, source_b_id: ds!.id,
    }).select("id").single();
    const { data: br } = await admin.from("recon_exceptions").insert({
      tenant_id: tenantId, recon_id: rk!.id, key_value: "K1",
      lifecycle_state: "open", status: "open",
    }).select("id").single();
    exceptionId = br!.id;

    const { data: run } = await admin.from("agent_runs").insert({
      tenant_id: tenantId, user_id: adminUser.id,
      objective: "fix", mode: "execute", status: "succeeded",
    }).select("id").single();

    reversalToken = crypto.randomUUID();
    const { data: act } = await admin.from("agent_actions").insert({
      run_id: run!.id, tenant_id: tenantId, tool: "set_break_lifecycle",
      input: { exception_id: exceptionId, lifecycle_state: "resolved" },
      status: "completed", proposed: false, policy_ceiling: "assist",
      reversal_token: reversalToken,
      before_state: {
        id: exceptionId,
        lifecycle_state: "open",
        status: "open",
        root_cause: null,
        resolved_at: null,
        resolved_by: null,
      },
    }).select("id").single();
    actionId = act!.id;

    // Apply the action's effect (what the agent would have done at execute-time),
    // so reversal has real work to do.
    await admin.from("recon_exceptions").update({
      lifecycle_state: "resolved",
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolved_by: adminUser.id,
    }).eq("id", exceptionId);

    authed = await userClient(adminUser.email, PW);
  });

  it("performAgentActionReversal (under real bearer) restores prior state and emits agent.reversal", async () => {
    const result = await performAgentActionReversal(authed as any, adminUser.id, {
      tenant_id: tenantId,
      action_id: actionId,
      reversal_token: reversalToken,
    });

    // (1) Helper return value reports the restoration.
    expect(result.ok).toBe(true);
    expect(result.tool).toBe("set_break_lifecycle");
    expect(result.restored).toBeTruthy();
    expect(result.restored.lifecycle_state).toBe("open");
    expect(result.restored.status).toBe("open");
    expect(result.restored.resolved_at).toBeNull();
    expect(result.restored.resolved_by).toBeNull();

    // (2) Fresh DB read confirms the row was actually rewritten.
    const { data: row } = await admin.from("recon_exceptions")
      .select("lifecycle_state, status, resolved_at, resolved_by")
      .eq("id", exceptionId).single();
    expect(row!.lifecycle_state).toBe("open");
    expect(row!.status).toBe("open");
    expect(row!.resolved_at).toBeNull();
    expect(row!.resolved_by).toBeNull();

    // (3) agent_actions.reverted_at populated by the production code path.
    const { data: act } = await admin.from("agent_actions")
      .select("reverted_at, reverted_by").eq("id", actionId).single();
    expect(act!.reverted_at).toBeTruthy();
    expect(act!.reverted_by).toBe(adminUser.id);

    // (4) security_events captured the reversal.
    const { data: evts } = await admin.from("security_events")
      .select("event_type, context")
      .eq("tenant_id", tenantId)
      .eq("event_type", "agent.reversal");
    expect(evts!.length).toBeGreaterThan(0);
    expect((evts![0] as any).context.action_id).toBe(actionId);
    expect((evts![0] as any).context.tool).toBe("set_break_lifecycle");
  });

  it("re-using the same reversal_token is rejected (token consumed)", async () => {
    await expect(
      performAgentActionReversal(authed as any, adminUser.id, {
        tenant_id: tenantId,
        action_id: actionId,
        reversal_token: reversalToken,
      }),
    ).rejects.toThrow(/already reverted/);
  });
});
