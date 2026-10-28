// Multi-tenant landing resolution — verifies users are redirected to the
// correct workspace based on preferred slug, default tenant, single
// membership, or fall back to the /home picker.
import { describe, it, expect } from "vitest";
import { computeLandingPath, type LandingTenant } from "@/lib/auth-landing-resolver";

const T = (slug: string, id = slug + "-id"): LandingTenant => ({
  id,
  slug,
  name: slug.toUpperCase(),
});

describe("computeLandingPath", () => {
  it("returns /home with no_memberships when user belongs to nothing", () => {
    const r = computeLandingPath({ tenants: [] });
    expect(r).toEqual({ path: "/home", reason: "no_memberships" });
  });

  it("routes single-tenant users straight to their workspace", () => {
    const r = computeLandingPath({ tenants: [T("jpmc")] });
    expect(r.path).toBe("/jpmc/workspace");
    expect(r.reason).toBe("single_tenant");
  });

  it("multi-tenant users land on the /home picker by default", () => {
    const r = computeLandingPath({ tenants: [T("jpmc"), T("hsbc"), T("acme")] });
    expect(r.path).toBe("/home");
    expect(r.reason).toBe("multi_tenant_picker");
    if (r.reason === "multi_tenant_picker") expect(r.tenantCount).toBe(3);
  });

  it("preferred_slug wins over default and picker", () => {
    const r = computeLandingPath({
      tenants: [T("jpmc"), T("hsbc"), T("acme")],
      defaultTenantId: "acme-id",
      preferredSlug: "hsbc",
    });
    expect(r.path).toBe("/hsbc/workspace");
    expect(r.reason).toBe("preferred_slug");
  });

  it("preferred_slug is case-insensitive and trimmed", () => {
    const r = computeLandingPath({
      tenants: [T("jpmc"), T("hsbc")],
      preferredSlug: "  JPMC  ",
    });
    expect(r.path).toBe("/jpmc/workspace");
    expect(r.reason).toBe("preferred_slug");
  });

  it("ignores preferred_slug when user is NOT a member of that tenant", () => {
    const r = computeLandingPath({
      tenants: [T("jpmc"), T("hsbc")],
      preferredSlug: "deutschebank",
      defaultTenantId: "hsbc-id",
    });
    // Falls through to default tenant.
    expect(r.path).toBe("/hsbc/workspace");
    expect(r.reason).toBe("default_tenant");
  });

  it("falls back to picker when default tenant_id no longer matches a membership", () => {
    const r = computeLandingPath({
      tenants: [T("jpmc"), T("hsbc")],
      defaultTenantId: "ghost-id",
    });
    expect(r.path).toBe("/home");
    expect(r.reason).toBe("multi_tenant_picker");
  });

  it("default tenant beats single_tenant ordering when membership is unique", () => {
    // Even with one membership, the path is still that workspace — reason
    // collapses to single_tenant (default short-circuits first when it
    // matches the sole tenant).
    const r = computeLandingPath({
      tenants: [T("only")],
      defaultTenantId: "only-id",
    });
    expect(r.path).toBe("/only/workspace");
    expect(r.reason).toBe("default_tenant");
  });

  it("empty/whitespace preferred_slug is treated as absent", () => {
    const r = computeLandingPath({ tenants: [T("jpmc")], preferredSlug: "   " });
    expect(r.reason).toBe("single_tenant");
    expect(r.path).toBe("/jpmc/workspace");
  });

  it("returned tenant object matches the destination slug", () => {
    const r = computeLandingPath({
      tenants: [T("jpmc"), T("hsbc")],
      preferredSlug: "hsbc",
    });
    if (r.reason === "preferred_slug") {
      expect(r.tenant.slug).toBe("hsbc");
      expect(r.tenant.id).toBe("hsbc-id");
    } else {
      throw new Error("expected preferred_slug reason");
    }
  });
});
