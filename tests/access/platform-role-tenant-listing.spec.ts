/**
 * Verifies role-tagging + read-only enforcement for platform_admin vs
 * platform_member on the tenant list surface.
 *
 * Targets the pure `mergeTenantsForUser` helper so the test runs without a
 * TanStack Start server runtime.
 */
import { describe, expect, it } from "vitest";
import { mergeTenantsForUser } from "@/lib/tenants.functions";

const t1 = { id: "t1", slug: "acme",    name: "Acme",    environment: "prod", ai_enabled: true,  family_id: "f1" };
const t2 = { id: "t2", slug: "globex",  name: "Globex",  environment: "dev",  ai_enabled: false, family_id: "f1" };
const t3 = { id: "t3", slug: "initech", name: "Initech", environment: "uat",  ai_enabled: false, family_id: "f2" };

const WRITE_ROLES = ["tenant_admin", "tenant_analyst"];

describe("mergeTenantsForUser — role tagging & read-only enforcement", () => {
  it("returns only explicit memberships for a regular signed-in user", () => {
    const rows = mergeTenantsForUser({
      memberships: [{ role: "tenant_analyst", tenant: t1 }],
      isPlatformAdmin: false,
      isPlatformMember: false,
      allTenants: [t1, t2, t3],
    });
    expect(rows.map((r) => r.id)).toEqual(["t1"]);
    expect(rows[0].role).toBe("tenant_analyst");
  });

  it("platform_admin sees every tenant and can perform tenant writes elsewhere", () => {
    const rows = mergeTenantsForUser({
      memberships: [{ role: "tenant_admin", tenant: t1 }],
      isPlatformAdmin: true,
      isPlatformMember: false,
      allTenants: [t1, t2, t3],
    });
    expect(rows.map((r) => r.id).sort()).toEqual(["t1", "t2", "t3"]);
    // Explicit membership wins
    expect(rows.find((r) => r.id === "t1")!.role).toBe("tenant_admin");
    expect(rows.find((r) => r.id === "t2")!.role).toBe("platform_admin");
    expect(rows.find((r) => r.id === "t3")!.role).toBe("platform_admin");
  });

  it("platform_member sees every tenant tagged read-only (never a tenant write role)", () => {
    const rows = mergeTenantsForUser({
      memberships: [],
      isPlatformAdmin: false,
      isPlatformMember: true,
      allTenants: [t1, t2, t3],
    });
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r.role).toBe("platform_member");
    // No synthetic write role must ever be produced for platform_member.
    expect(rows.some((r) => WRITE_ROLES.includes(r.role))).toBe(false);
  });

  it("explicit tenant_member membership is preserved even for a platform_admin", () => {
    const rows = mergeTenantsForUser({
      memberships: [{ role: "tenant_analyst", tenant: t2 }],
      isPlatformAdmin: true,
      isPlatformMember: false,
      allTenants: [t1, t2, t3],
    });
    const t2Row = rows.find((r) => r.id === "t2")!;
    expect(t2Row.role).toBe("tenant_analyst");
    // No duplicate rows introduced
    expect(rows.filter((r) => r.id === "t2")).toHaveLength(1);
  });

  it("if a platform_member later also joins as tenant_analyst, membership wins", () => {
    const rows = mergeTenantsForUser({
      memberships: [{ role: "tenant_analyst", tenant: t1 }],
      isPlatformAdmin: false,
      isPlatformMember: true,
      allTenants: [t1, t2, t3],
    });
    expect(rows.find((r) => r.id === "t1")!.role).toBe("tenant_analyst"); // write-capable
    expect(rows.find((r) => r.id === "t2")!.role).toBe("platform_member"); // read-only
    expect(rows.find((r) => r.id === "t3")!.role).toBe("platform_member"); // read-only
  });
});
