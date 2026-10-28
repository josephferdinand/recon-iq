import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260924180000_collateral_csa_governed_lifecycle.sql",
  "utf8",
);
const server = readFileSync("src/lib/collateral-csa.functions.ts", "utf8");
const ui = readFileSync("src/components/collateral-tab.tsx", "utf8");

describe("bilateral CSA source governance contract", () => {
  it("routes lifecycle mutations only through authenticated tenant-admin RPCs", () => {
    for (const name of [
      "create_collateral_csa_draft",
      "submit_collateral_csa_version",
      "decide_collateral_csa_version",
      "calculate_collateral_vm_call",
      "approve_collateral_vm_call",
      "dispute_collateral_vm_call",
      "resolve_collateral_vm_dispute",
      "record_collateral_vm_settlement",
    ]) {
      expect(migration).toContain(`public.${name}`);
      expect(server).toContain(`"${name}"`);
    }
    expect(
      server.match(/\.middleware\(\[requireSupabaseAuth\(\)\]\)/g)?.length,
    ).toBeGreaterThanOrEqual(3);
    expect(server).toContain("const lifecycleAction = <T extends z.ZodTypeAny>(");
    expect(migration).toContain("Active tenant administrator required");
    expect(migration).toContain("Maker and checker must be different users");
    expect(migration).toContain("actor=c.calculated_by");
    expect(migration).toContain(
      "REVOKE INSERT, UPDATE, DELETE ON public.collateral_csa_agreements",
    );
  });

  it("labels unsupported valuation, eligibility and product scope instead of implying integrations", () => {
    expect(ui).toContain("manually supplied exposure and already-valued eligible collateral held");
    expect(ui).toMatch(/FVI does not\s+source valuations/);
    expect(ui).toMatch(/IM and Triparty lifecycle controls are unavailable/);
    expect(migration).toContain(
      "This does not integrate collateral valuation or the reconciliation engine.",
    );
  });
});
