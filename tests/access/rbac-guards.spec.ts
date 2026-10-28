/**
 * Integration-style RBAC unit tests for the shared server guard.
 *
 * These tests exercise `requireTenantAdmin`, `requireTenantMember`, and
 * `requirePlatformAdmin` with a mocked Supabase context that emulates the
 * six documented role/tenant combinations. They verify the boundary contract
 * every tenant-admin serverFn depends on:
 *
 *   | Role                              | Expect     |
 *   | --------------------------------- | ---------- |
 *   | unauthenticated (missing tenant)  | 403        |
 *   | tenant_member                     | 403        |
 *   | tenant_admin of same tenant       | allow      |
 *   | tenant_admin of different tenant  | 403        |
 *   | platform_admin                    | allow      |
 *   | analyst (read-only, extraRoles)   | allow read |
 *
 * Every deny path must also emit an `rbac.denied` audit_log row.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  requireTenantAdmin,
  requireTenantMember,
  requirePlatformAdmin,
  ForbiddenError,
} from "@/lib/rbac-guards.server";

type Role = "platform_admin" | "tenant_admin" | "tenant_analyst" | "tenant_viewer" | "none";

function makeCtx(
  role: Role,
  ownedTenantId: string,
  userId = "00000000-0000-0000-0000-000000000001",
) {
  const audits: any[] = [];
  const supabase = {
    rpc: vi.fn(async (fn: string, args: any) => {
      if (fn === "is_platform_admin") return { data: role === "platform_admin" };
      if (fn === "is_tenant_member") {
        return {
          data: role !== "none" && role !== "platform_admin" && args._tenant_id === ownedTenantId,
        };
      }
      if (fn === "has_tenant_role") {
        return {
          data: args._tenant_id === ownedTenantId && role === args._role,
        };
      }
      return { data: null };
    }),
    from: vi.fn((table: string) => ({
      insert: vi.fn(async (row: any) => {
        if (table === "audit_log") audits.push(row);
        return { error: null };
      }),
    })),
  };
  return { ctx: { supabase, userId }, audits };
}

const T_A = "11111111-1111-1111-1111-111111111111";
const T_B = "22222222-2222-2222-2222-222222222222";

describe("requireTenantAdmin", () => {
  it("allows a tenant_admin of the same tenant", async () => {
    const { ctx } = makeCtx("tenant_admin", T_A);
    const res = await requireTenantAdmin(ctx as any, T_A, { fnName: "test" });
    expect(res.role).toBe("tenant_admin");
  });

  it("allows a platform_admin regardless of tenant", async () => {
    const { ctx } = makeCtx("platform_admin", T_A);
    const res = await requireTenantAdmin(ctx as any, T_B, { fnName: "test" });
    expect(res.role).toBe("platform_admin");
  });

  it("denies a tenant_admin of a DIFFERENT tenant and audits", async () => {
    const { ctx, audits } = makeCtx("tenant_admin", T_A);
    await expect(
      requireTenantAdmin(ctx as any, T_B, { fnName: "test_cross_tenant" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe("rbac.denied");
    expect(audits[0].tenant_id).toBe(T_B);
    expect(audits[0].context.reason).toBe("not_tenant_admin");
    expect(audits[0].resource_id).toBe("test_cross_tenant");
  });

  it("denies a plain tenant_analyst by default", async () => {
    const { ctx, audits } = makeCtx("tenant_analyst", T_A);
    await expect(requireTenantAdmin(ctx, T_A, { fnName: "test" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(audits[0].action).toBe("rbac.denied");
  });

  it("allows analyst when passed in extraRoles", async () => {
    const { ctx } = makeCtx("tenant_analyst", T_A);
    const res = await requireTenantAdmin(ctx as any, T_A, {
      fnName: "test",
      extraRoles: ["tenant_analyst"],
    });
    expect(res.role).toBe("tenant_analyst");
  });

  it("denies missing tenant_id and audits with reason=missing_tenant_id", async () => {
    const { ctx, audits } = makeCtx("platform_admin", T_A);
    await expect(
      requireTenantAdmin(ctx as any, "" as any, { fnName: "test_missing" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(audits[0].context.reason).toBe("missing_tenant_id");
    expect(audits[0].tenant_id).toBeNull();
  });

  it("respects allowPlatformAdmin=false", async () => {
    const { ctx } = makeCtx("platform_admin", T_A);
    await expect(
      requireTenantAdmin(ctx as any, T_A, {
        fnName: "strict",
        allowPlatformAdmin: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("requireTenantMember", () => {
  it("allows any member (analyst) and returns the role", async () => {
    const { ctx } = makeCtx("tenant_analyst", T_A);
    const res = await requireTenantMember(ctx as any, T_A, { fnName: "test" });
    expect(res.role).toBe("tenant_analyst");
  });

  it("denies non-members and audits", async () => {
    const { ctx, audits } = makeCtx("tenant_admin", T_A);
    await expect(
      requireTenantMember(ctx as any, T_B, { fnName: "test_read" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(audits[0].context.reason).toBe("not_tenant_member");
  });

  it("allows platform_admin cross-tenant reads", async () => {
    const { ctx } = makeCtx("platform_admin", T_A);
    const res = await requireTenantMember(ctx as any, T_B, { fnName: "test" });
    expect(res.role).toBe("platform_admin");
  });
});

describe("requirePlatformAdmin", () => {
  it("allows platform_admin", async () => {
    const { ctx } = makeCtx("platform_admin", T_A);
    const res = await requirePlatformAdmin(ctx as any);
    expect(res.role).toBe("platform_admin");
  });

  it("denies tenant_admin and audits with scope=platform", async () => {
    const { ctx, audits } = makeCtx("tenant_admin", T_A);
    await expect(requirePlatformAdmin(ctx as any, { fnName: "test_plat" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(audits[0].scope).toBe("platform");
    expect(audits[0].context.reason).toBe("not_platform_admin");
  });

  it("fails closed when the platform-role RPC errors", async () => {
    const { ctx, audits } = makeCtx("platform_admin", T_A);
    ctx.supabase.rpc.mockResolvedValueOnce({
      data: true,
      error: { message: "role lookup unavailable" },
    });

    await expect(requirePlatformAdmin(ctx, { fnName: "rpc_error" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(audits[0].context.reason).toBe("not_platform_admin");
    expect(audits[0].resource_id).toBe("rpc_error");
  });
});

describe("audit_log deny writes never mask the original 403", () => {
  it("still throws Forbidden when audit insert fails", async () => {
    const brokenCtx = {
      userId: "u",
      supabase: {
        rpc: vi.fn(async () => ({ data: false })),
        from: vi.fn(() => ({
          insert: vi.fn(async () => {
            throw new Error("audit table exploded");
          }),
        })),
      },
    };
    await expect(
      requireTenantAdmin(brokenCtx as any, T_A, { fnName: "test" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
