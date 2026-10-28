// @ts-nocheck
// tests/copilot/needs-approval.spec.ts — Phase 2 item #5
//
// Fixtures:
//  (1) Mutating tool call returns an awaiting_approval card (NOT inline mutation).
//  (2) Approve with a valid token executes the real mutation and consumes the token.
//  (3) Approve with an expired or already-used token is rejected.
//
// The tests drive the shared server helpers directly (the same code path the
// `/api/copilot/approve` endpoint invokes) under a real bearer token, so RLS,
// GRANTs, the agent_actions_no_self_approve trigger, and the
// confirmation-token TTL all apply end-to-end.

import { describe, it, expect, beforeAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  assignBreaks,
  executeConfirmedAction,
  ensureAgentRunForThread,
  CONFIRMATION_TTL_MS,
} from "@/lib/agent-write-tools.server";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY!;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function authClient(email: string, password: string): Promise<SupabaseClient> {
  const c = createClient(SUPABASE_URL, PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return c;
}

describe.skip("Phase 2 · needs-approval flow [stale: uses removed data_sources/recons tables]", () => {
  const PW = "Test!12345";
  let tenantId: string;
  let requester: { id: string; email: string; client: SupabaseClient };
  let approver: { id: string; email: string; client: SupabaseClient };
  let breakId: string;
  let runId: string;
  let threadId: string;

  beforeAll(async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const { data: t } = await admin.from("tenants").insert({
      name: "NeedsApproval Test", slug: `na-${stamp}`, environment: "dev", region: "eu-west-1",
    }).select("id").single();
    tenantId = t!.id;

    const reqEmail = `req+${stamp}@fvi.test`;
    const appEmail = `app+${stamp}@fvi.test`;
    const { data: r } = await admin.auth.admin.createUser({ email: reqEmail, password: PW, email_confirm: true });
    const { data: a } = await admin.auth.admin.createUser({ email: appEmail, password: PW, email_confirm: true });
    requester = { id: r.user!.id, email: reqEmail, client: await authClient(reqEmail, PW) };
    approver = { id: a.user!.id, email: appEmail, client: await authClient(appEmail, PW) };

    await admin.from("tenant_members").insert([
      { tenant_id: tenantId, user_id: requester.id, role: "tenant_admin", invited_by: requester.id, active: true },
      { tenant_id: tenantId, user_id: approver.id, role: "tenant_admin", invited_by: requester.id, active: true },
    ]);

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
    breakId = br!.id;

    threadId = crypto.randomUUID();
    runId = await ensureAgentRunForThread(requester.client as any, {
      tenantId, userId: requester.id, threadId,
    });
  });

  it("(1) mutating tool call returns awaiting_approval, does NOT mutate", async () => {
    const out = await assignBreaks(requester.client as any, {
      tenantId, runId,
      breakIds: [breakId],
      assigneeUserId: approver.id,
      requesterUserId: requester.id,
      needsApproval: true,
    });
    expect(out.status).toBe("awaiting_approval");
    expect(out.confirmation_token).toMatch(/^[0-9a-f]{64}$/);
    expect(out.expires_at).toBeTruthy();

    // assignee on the exception must still be null — no inline mutation.
    const { data: row } = await admin.from("recon_exceptions")
      .select("assignee").eq("id", breakId).single();
    expect(row!.assignee).toBeNull();

    // The pending agent_actions row exists with status='pending'.
    const { data: act } = await admin.from("agent_actions")
      .select("status, confirmation_token, confirmed_at")
      .eq("id", (out as any).action_id).single();
    expect(act!.status).toBe("pending");
    expect(act!.confirmed_at).toBeNull();
  });

  it("(2) approve with a valid token executes the mutation and consumes the token", async () => {
    const proposal = await assignBreaks(requester.client as any, {
      tenantId, runId,
      breakIds: [breakId],
      assigneeUserId: approver.id,
      requesterUserId: requester.id,
      needsApproval: true,
    }) as any;

    const result = await executeConfirmedAction(approver.client as any, approver.id, {
      tenantId,
      actionId: proposal.action_id,
      confirmationToken: proposal.confirmation_token,
    });
    expect(result.ok).toBe(true);
    expect(result.tool).toBe("assign_breaks");

    // The mutation actually landed.
    const { data: row } = await admin.from("recon_exceptions")
      .select("assignee, assigned_by").eq("id", breakId).single();
    expect(row!.assignee).toBe(approver.id);
    expect(row!.assigned_by).toBe(approver.id);

    // Token is consumed → second approval rejected.
    await expect(
      executeConfirmedAction(approver.client as any, approver.id, {
        tenantId,
        actionId: proposal.action_id,
        confirmationToken: proposal.confirmation_token,
      }),
    ).rejects.toThrowError(/agent\.token_already_used|agent\.action_not_pending/);
  });

  it("(3) approve with an expired token is rejected", async () => {
    const proposal = await assignBreaks(requester.client as any, {
      tenantId, runId,
      breakIds: [breakId],
      assigneeUserId: approver.id,
      requesterUserId: requester.id,
      needsApproval: true,
    }) as any;

    // Force-expire the token via admin.
    await admin.from("agent_actions")
      .update({ confirmation_expires_at: new Date(Date.now() - 1000).toISOString() })
      .eq("id", proposal.action_id);

    await expect(
      executeConfirmedAction(approver.client as any, approver.id, {
        tenantId,
        actionId: proposal.action_id,
        confirmationToken: proposal.confirmation_token,
      }),
    ).rejects.toThrowError(/agent\.token_expired/);

    // Sanity-check the documented TTL constant is still 5 minutes.
    expect(CONFIRMATION_TTL_MS).toBe(5 * 60_000);
  });

  it("(bonus) self-approval is blocked by the DB trigger", async () => {
    const proposal = await assignBreaks(requester.client as any, {
      tenantId, runId,
      breakIds: [breakId],
      assigneeUserId: approver.id,
      requesterUserId: requester.id,
      needsApproval: true,
    }) as any;

    await expect(
      executeConfirmedAction(requester.client as any, requester.id, {
        tenantId,
        actionId: proposal.action_id,
        confirmationToken: proposal.confirmation_token,
      }),
    ).rejects.toThrowError(/agent\.self_approve_blocked/);
  });
});
