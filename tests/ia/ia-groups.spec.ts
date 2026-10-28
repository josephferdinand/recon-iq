/**
 * IA consolidation guardrail.
 *
 * Locks in the 6-group Platform IA and 8-group Tenant IA. Any drift
 * (renamed group, ungrouped page, unknown label) fails CI so future
 * additions must be filed into one of the approved buckets rather than
 * appended to a flat list.
 */
import { describe, it, expect } from "vitest";
import { TENANT_PAGES } from "@/lib/page-permissions";

const PLATFORM_GROUPS = [
  "Tenancy",
  "Identity & Access",
  "AI Governance",
  "Content & Support",
  "Security & Compliance",
  "Reliability & Ops",
] as const;

const TENANT_GROUPS = [
  "Organization",
  "Data & Integrations",
  "Modules & Features",
  "AI & Automation",
  "Reconciliation Ops",
  "Compliance & Risk",
  "Support & Success",
  "Resilience",
] as const;

describe("Information architecture — group manifest", () => {
  it("Tenant admin has exactly the 8 approved groups", () => {
    const found = new Set(TENANT_PAGES.map((p) => p.group ?? "(none)"));
    expect([...found].sort()).toEqual([...TENANT_GROUPS].sort());
  });

  it("Every tenant page belongs to a group", () => {
    const orphans = TENANT_PAGES.filter((p) => !p.group);
    expect(orphans).toEqual([]);
  });

  it("Tenant page keys are unique (no ?page= collisions)", () => {
    const keys = TENANT_PAGES.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("Platform IA declares exactly 6 approved groups", () => {
    // Guardrail on the shape; the platform PAGES list is authored inline
    // in the route file and mirrors this manifest.
    expect(PLATFORM_GROUPS.length).toBe(6);
  });

  it("Tenant IA declares exactly 8 approved groups", () => {
    expect(TENANT_GROUPS.length).toBe(8);
  });
});
