import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let validate = (value: unknown) => value;
    const chain = {
      middleware: () => chain,
      validator: (fn: (value: unknown) => unknown) => { validate = fn; return chain; },
      handler: (fn: (args: any) => unknown) => (args: { data: unknown; context: unknown }) =>
        fn({ ...args, data: validate(args.data) }),
    };
    return chain;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: () => vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: () => ({ insert: async () => ({ error: null }) }) },
}));

import {
  deleteRecon,
  decideReconEditRequest,
  decideReconPromotion,
  requestReconEdit,
  submitReconPromotion,
} from "@/lib/recons.functions";

const tenantId = "11111111-1111-4111-8111-111111111111";
const definitionId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";

function ctx(data: unknown = requestId, error: { message?: string } | null = null) {
  const rpc = vi.fn(async () => ({ data, error }));
  return { context: { supabase: { rpc } }, rpc };
}

describe("reconciliation definition maker-checker API adapters", () => {
  it("retains a governed draft instead of attempting a physical delete", async () => {
    const deleteRow = vi.fn();
    const readRow = vi.fn(async () => ({ data: { status: "draft", access_mode: "mapped_exact" }, error: null }));
    const supabase = {
      rpc: vi.fn(async () => ({ data: true, error: null })),
      from: vi.fn(() => ({
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: readRow }) }) }),
        delete: deleteRow,
      })),
    };
    await expect((deleteRecon as any)({
      data: { id: definitionId, tenant_id: tenantId },
      context: { supabase, userId: requestId },
    })).rejects.toThrow("retained for audit");
    expect(deleteRow).not.toHaveBeenCalled();
  });

  it("binds edit-request scope and reason to the exact RPC", async () => {
    const db = ctx();
    await expect((requestReconEdit as any)({
      data: { tenant_id: tenantId, recon_id: definitionId, reason: "Update matching keys" }, context: db.context,
    })).resolves.toBe(requestId);
    expect(db.rpc).toHaveBeenCalledWith("request_recon_definition_edit", {
      _tenant_id: tenantId, _recon_id: definitionId, _reason: "Update matching keys",
    });
  });

  it("maps independent edit and promotion decisions without accepting caller actor IDs", async () => {
    const edit = ctx(definitionId);
    await (decideReconEditRequest as any)({
      data: { request_id: requestId, approve: true, reason: "Approved for isolated staging" }, context: edit.context,
    });
    expect(edit.rpc).toHaveBeenCalledWith("decide_recon_definition_edit", {
      _request_id: requestId, _approve: true, _reason: "Approved for isolated staging",
    });

    const promotion = ctx(2);
    await (decideReconPromotion as any)({
      data: { request_id: requestId, approve: false, reason: "Rules require correction" }, context: promotion.context,
    });
    expect(promotion.rpc).toHaveBeenCalledWith("decide_recon_definition_promotion", {
      _request_id: requestId, _approve: false, _reason: "Rules require correction",
    });
    const rejectedEdit = ctx(null);
    await expect((decideReconEditRequest as any)({
      data: { request_id: requestId, approve: false, reason: "Needs more work" }, context: rejectedEdit.context,
    })).resolves.toBe(true);
  });

  it("submits only the staging identity and keeps unavailable RPCs from becoming success", async () => {
    const db = ctx(requestId);
    await (submitReconPromotion as any)({
      data: { tenant_id: tenantId, staging_id: definitionId, reason: "Ready for production review" }, context: db.context,
    });
    expect(db.rpc).toHaveBeenCalledWith("submit_recon_definition_promotion", {
      _tenant_id: tenantId, _staging_id: definitionId, _reason: "Ready for production review",
    });
    const unavailable = ctx(null, { message: "PGRST202 private schema details" });
    await expect((submitReconPromotion as any)({
      data: { tenant_id: tenantId, staging_id: definitionId, reason: "Ready" }, context: unavailable.context,
    })).rejects.toThrow("Definition governance is temporarily unavailable.");
  });

  it("rejects missing IDs, empty reasons, and request fields outside the contract", async () => {
    const db = ctx();
    expect(() => (requestReconEdit as any)({ data: { tenant_id: "bad", recon_id: definitionId, reason: "ok" }, context: db.context }))
      .toThrow();
    expect(() => (decideReconEditRequest as any)({ data: { request_id: requestId, approve: true, reason: " " }, context: db.context }))
      .toThrow();
    expect(() => (submitReconPromotion as any)({ data: { tenant_id: tenantId, staging_id: definitionId, reason: "ok", actor_id: requestId }, context: db.context }))
      .toThrow();
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
