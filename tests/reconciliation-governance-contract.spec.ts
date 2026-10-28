import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260914170000_harden_reconciliation_review_and_assignment.sql", "utf8");

describe("reconciliation assignment and review governance", () => {
  it("moves assignment into one permission-bound audited database operation", () => {
    expect(migration).toContain("assign_exceptions_from_rule");
    expect(migration).toContain("break.assign permission required");
    expect(migration).toContain("exception.auto_assigned");
    expect(migration).toContain("member.active=true");
  });

  it("makes proposed-match acceptance atomic and learning-producing", () => {
    expect(migration).toContain("review_proposed_match_atomic");
    expect(migration).toContain("proposed match already decided");
    expect(migration).toContain("INSERT INTO public.recon_match_feedback");
    expect(migration).toContain("recon.match.approve permission required");
  });

  it("enforces manual-match scope and maker-checker in the database", () => {
    expect(migration).toContain("decide_manual_match_atomic");
    expect(migration).toContain("maker cannot approve own manual match");
    expect(migration).toContain("manual match exception scope mismatch");
    expect(migration).toContain("REVOKE UPDATE ON public.proposed_matches, public.manual_match_approvals FROM authenticated");
  });
});
