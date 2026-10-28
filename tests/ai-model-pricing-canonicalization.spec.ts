import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  path.resolve("supabase/migrations/20260901202000_canonicalize_ai_model_pricing.sql"),
  "utf8",
).toLowerCase();

describe("AI model pricing canonicalization", () => {
  it("fails before narrowing rate precision if any live value would change", () => {
    expect(migration).toContain("values do not fit canonical numeric(10,6) schema");
    expect(migration).toContain("input_usd_per_1m <> round(input_usd_per_1m, 6)");
    expect(migration).toContain("abs(output_usd_per_1m) >= 10000");
  });

  it("removes broad and duplicate policies before recreating authenticated controls", () => {
    expect(migration).toContain("drop policy if exists amp_read");
    expect(migration).toContain("drop policy if exists amp_admin");
    expect(migration).toContain("for all to authenticated");
    expect(migration).toContain("public.is_platform_admin(auth.uid())");
  });

  it("preserves time-versioned rate cards with one canonical effective-date index", () => {
    expect(migration).toContain("drop constraint if exists ai_model_pricing_provider_model_uniq");
    expect(migration).toContain("ai_model_pricing_provider_model_effective_uq");
    expect(migration).toContain("provider_code, model_key, effective_at");
  });
});
