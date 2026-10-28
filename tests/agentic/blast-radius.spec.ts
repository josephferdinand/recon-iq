// @ts-nocheck
// tests/agentic/blast-radius.spec.ts — Phase 1.5 item #3
import { describe, it, expect } from "vitest";
import { enforceBlastRadius } from "@/lib/agent-runner.server";

describe("Phase 1.5 · blast-radius cap", () => {
  it("49 actions passes", () => {
    expect(() => enforceBlastRadius({ plannedActions: 49, distinctTables: 5 })).not.toThrow();
  });
  it("51 actions throws agent.blast.radius", () => {
    expect(() => enforceBlastRadius({ plannedActions: 51, distinctTables: 5 }))
      .toThrowError(/agent\.blast\.radius/);
  });
  it("11 distinct tables throws agent.blast.radius", () => {
    expect(() => enforceBlastRadius({ plannedActions: 10, distinctTables: 11 }))
      .toThrowError(/agent\.blast\.radius/);
  });
  it("tenant_admin override allows 200 actions / 30 tables", () => {
    expect(() => enforceBlastRadius({
      plannedActions: 200, distinctTables: 30, isTenantAdminOverride: true,
    })).not.toThrow();
  });
  it("tenant_admin override still rejects above 500 / 50", () => {
    expect(() => enforceBlastRadius({
      plannedActions: 501, distinctTables: 10, isTenantAdminOverride: true,
    })).toThrowError(/agent\.blast\.radius/);
  });
});
