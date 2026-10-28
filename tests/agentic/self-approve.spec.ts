// @ts-nocheck
// tests/agentic/self-approve.spec.ts — Phase 1.5 item #1
// Verifies the DB trigger `agent_actions_no_self_approve` raises when an
// approver matches the requester (run.user_id), and passes otherwise.
import { describe, it, expect, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

describe("Phase 1.5 · agent self-approval guard", () => {
  let tenantId: string;
  let requesterId: string;
  let approverId: string;
  let runId: string;

  beforeAll(async () => {
    const { data: t } = await admin.from("tenants").insert({
      name: "SelfApprove Test", slug: `sa-${Date.now()}`, environment: "dev", region: "eu-west-1",
    }).select("id").single();
    tenantId = t!.id;
    const { data: a } = await admin.auth.admin.createUser({
      email: `req+${Date.now()}@fvi.test`, password: "Test!12345", email_confirm: true,
    });
    requesterId = a.user!.id;
    const { data: b } = await admin.auth.admin.createUser({
      email: `app+${Date.now()}@fvi.test`, password: "Test!12345", email_confirm: true,
    });
    approverId = b.user!.id;
    const { data: r } = await admin.from("agent_runs").insert({
      tenant_id: tenantId, user_id: requesterId, objective: "fixture", mode: "plan", status: "awaiting_approval",
    }).select("id").single();
    runId = r!.id;
  });

  async function insertAction(approved_by: string | null) {
    return admin.from("agent_actions").insert({
      tenant_id: tenantId, run_id: runId, tool: "set_break_lifecycle",
      input: {}, status: "pending", proposed: true, policy_ceiling: "assist",
      approved_by,
    }).select("id").single();
  }

  it("rejects when approver === requester", async () => {
    const { error } = await insertAction(requesterId);
    expect(error?.message ?? "").toMatch(/agent\.self_approve_blocked/);
  });

  it("passes when approver !== requester", async () => {
    const { error, data } = await insertAction(approverId);
    expect(error).toBeNull();
    expect(data!.id).toBeTruthy();
  });

  it("passes when approver is NULL (pending)", async () => {
    const { error, data } = await insertAction(null);
    expect(error).toBeNull();
    expect(data!.id).toBeTruthy();
  });
});
