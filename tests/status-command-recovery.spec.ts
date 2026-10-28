import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: () => "synthetic-auth" }));
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let parse = (v: any) => v; const chain: any = { middleware: () => chain, validator: (v: any) => { parse = v; return chain; }, handler: (h: any) => (args: any) => h({ data: parse(args.data), context: args.context }) }; return chain;
} }));
import { executeStatusIncidentCommand, getStatusIncidentCommandReceipt } from "@/lib/status.workflow.functions";
const command = { request_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", incident_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", expected_revision: 2, action: "review", payload: { reason: "Synthetic independent review" } };
const receipt = { id: command.incident_id, revision: 2, workflow_state: "reviewed", request_id: command.request_id };
function context(data: unknown, error: unknown = null, admin = true) {
  return { userId: "11111111-1111-4111-8111-111111111111", supabase: { rpc: vi.fn((name: string) => name === "is_platform_admin" ? Promise.resolve({ data: admin, error: null }) : { abortSignal: async () => ({ data, error }) }) } };
}
describe("status interrupted-command recovery", () => {
  it("returns sanitized durable-refusal receipt rather than pretending publication succeeded", async () => {
    const ctx = context({ outcome: "refused", code: "PT409", request_id: command.request_id, denial_id: "9007199254740993", raw: "private diagnostic" });
    const result = await (executeStatusIncidentCommand as any)({ data: command, context: ctx });
    expect(result).toEqual({ outcome: "refused", code: "PT409", request_id: command.request_id, denial_id: "9007199254740993" });
    expect(result).not.toHaveProperty("id");
  });
  it("maps a PT409 from an older unwrapped schema without leaking SQL text", async () => {
    await expect((executeStatusIncidentCommand as any)({ data: command, context: context(null, { code: "PT409", message: "private SQL" }) })).rejects.toThrow("This incident changed");
  });
  it("recovers the committed exact request with fixed RPC and no actor override", async () => {
    const ctx = context(receipt); expect(await (getStatusIncidentCommandReceipt as any)({ data: { ...command, actor_id: "forged" }, context: ctx })).toEqual({ state: "recorded", receipt });
    expect(ctx.supabase.rpc.mock.calls[1]).toEqual(["status_incident_command_receipt", { _request_id: command.request_id, _incident_id: command.incident_id, _expected_revision: 2, _action: "review", _payload: command.payload }]);
  });
  it("does not mistake absent receipt for a definitive refusal", async () => {
    expect(await (getStatusIncidentCommandReceipt as any)({ data: command, context: context(null) })).toEqual({ state: "unconfirmed", request_id: command.request_id });
  });
  it("refuses receipt recovery after current access is lost before invoking its RPC", async () => {
    const ctx = context(receipt, null, false); await expect((getStatusIncidentCommandReceipt as any)({ data: command, context: ctx })).rejects.toThrow("Current platform"); expect(ctx.supabase.rpc).toHaveBeenCalledTimes(1);
  });
  it("rejects a receipt for a different request", async () => {
    await expect((getStatusIncidentCommandReceipt as any)({ data: command, context: context({ ...receipt, request_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }) })).rejects.toThrow("did not match");
  });
  it("keeps provider acknowledgement failure uncertain and secret-safe", async () => {
    await expect((getStatusIncidentCommandReceipt as any)({ data: command, context: context(null, { message: "private SQL" }) })).rejects.toThrow("could not be verified");
  });
});
describe("status SQL recovery source contract (not PostgreSQL execution)", () => {
  const root = "docs/evidence/status-lane-2026-10-03/";
  it("contains no explicit business serialization raise in either current proposal", () => {
    for (const file of ["guarded-status-workflow-proposal.sql", "guarded-status-escalation-proposal.sql"]) {
      const sql = fs.readFileSync(root + file, "utf8"); expect(sql).not.toMatch(/ERRCODE\s*=\s*'40001'/); expect(sql).toMatch(/ERRCODE\s*=\s*'PT409'/);
    }
  });
  it("isolates denial subtransaction, preserves genuine serialization errors, and closes bypass ACL", () => {
    const sql = fs.readFileSync(root + "guarded-status-command-recovery-proposal.sql", "utf8");
    expect(sql).toMatch(/EXCEPTION WHEN SQLSTATE 'PT409' OR SQLSTATE '42501' OR SQLSTATE 'P0001' OR SQLSTATE '22023'/);
    expect(sql).not.toMatch(/EXCEPTION WHEN[^;]*'40001'/); expect(sql).toContain("FROM PUBLIC,anon,authenticated,service_role;");
    expect(sql).toContain("actual IS DISTINCT FROM expected"); expect(sql).toContain("WHERE actor_id=actor AND request_id=_request_id"); expect(sql).toContain("prior.fingerprint IS DISTINCT FROM fingerprint");
  });
});
