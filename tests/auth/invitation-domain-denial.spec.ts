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
vi.mock("@/lib/rbac-guards.server", () => ({ requireTenantAdmin: vi.fn() }));

import { acceptInvitation } from "@/lib/members.functions";

const userId = "f4530000-0000-4000-8000-000000000001";
const tenantId = "f4530000-0000-4000-8000-000000000002";
const inviteId = "f4530000-0000-4000-8000-000000000003";

describe("invitation domain denial", () => {
  it("does not create grants, accept the invitation, or audit acceptance after membership denial", async () => {
    const grantInsert = vi.fn();
    const groupInsert = vi.fn();
    const inviteUpdate = vi.fn();
    const auditInsert = vi.fn();
    const memberInsert = vi.fn(async () => ({ error: { code: "23514", message: "Membership is unavailable" } }));
    const invitation = {
      id: inviteId, tenant_id: tenantId, email: "user@other.invalid", role: "tenant_viewer",
      role_ids: ["f4530000-0000-4000-8000-000000000004"],
      group_ids: ["f4530000-0000-4000-8000-000000000005"],
      bu_id: null, accepted_at: null, expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
    const supabase = {
      rpc: vi.fn(async () => ({ data: { id: inviteId }, error: null })),
      from: vi.fn((table: string) => {
        if (table === "tenant_invitations") return {
          select: () => ({ eq: () => ({ single: async () => ({ data: invitation }) }) }),
          update: inviteUpdate,
        };
        if (table === "tenant_members") return { insert: memberInsert };
        if (table === "rbac_user_grants") return { insert: grantInsert };
        if (table === "tenant_group_members") return { insert: groupInsert };
        if (table === "audit_log") return { insert: auditInsert };
        throw new Error(`Unexpected table ${table}`);
      }),
    };
    await expect((acceptInvitation as any)({
      data: { token: "fixture-invite-token" },
      context: { userId, supabase, claims: { email: "user@other.invalid" } },
    })).rejects.toThrow("Invitation cannot be accepted for this account.");
    expect(memberInsert).toHaveBeenCalledOnce();
    expect(grantInsert).not.toHaveBeenCalled();
    expect(groupInsert).not.toHaveBeenCalled();
    expect(inviteUpdate).not.toHaveBeenCalled();
    expect(auditInsert).not.toHaveBeenCalled();
  });
});
