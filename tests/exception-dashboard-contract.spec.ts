import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const server = readFileSync("src/lib/exception-dashboard.functions.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260915003000_create_exception_dashboard.sql",
  "utf8",
);

describe("Exception dashboard backend contract", () => {
  it("keeps the authenticated, bounded server interface", () => {
    expect(server).toContain("export const getExceptionDashboard");
    expect(server).toContain("requireSupabaseAuth()");
    expect(server).toContain("z.literal(7)");
    expect(server).toContain("z.literal(30)");
    expect(server).toContain("z.literal(90)");
    expect(server).toContain(".default(30)");
    expect(server).toContain('"get_exception_dashboard"');
    expect(server).toContain("exceptionDashboardSchema.parse(result)");
    expect(server).not.toContain("enforceRateLimit");
    expect(server).not.toContain("rate-limit.server");
  });

  it("enforces active membership and break.read inside the database function", () => {
    expect(migration).toContain("SECURITY INVOKER");
    expect(migration).toContain("SET row_security = on");
    expect(migration).toContain("VOLATILE");
    expect(migration).toContain("membership.active");
    expect(migration).toContain(
      "public.user_has_permission(actor_id, _tenant_id, 'break.read', NULL)",
    );
    expect(migration).toContain("forbidden: break.read permission required");
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.get_exception_dashboard(uuid, integer) FROM PUBLIC, anon",
    );
    expect(migration).toContain(
      "GRANT EXECUTE ON FUNCTION public.get_exception_dashboard(uuid, integer) TO authenticated",
    );
  });

  it("rate-limits every server and direct RPC call after database authorization", () => {
    expect(migration).toContain("private.exception_dashboard_rate_limit_hit");
    expect(migration).toContain("exception.dashboard.db:");
    expect(server).not.toContain("exception.dashboard.db:");
    expect(migration).toContain("RAISE SQLSTATE 'PGRST'");
    expect(migration).toContain("'status', 429");
    expect(migration).toContain("'Retry-After'");
    expect(migration.indexOf("SELECT * INTO rate_state")).toBeGreaterThan(
      migration.lastIndexOf("forbidden: break.read permission required"),
    );
  });

  it("uses real closed-state semantics and never infers a resolution timestamp", () => {
    expect(migration).toContain("exception.lifecycle_state IN ('resolved','written_off')");
    expect(migration).toContain("exception.status IN ('resolved','wont_fix')");
    expect(migration).not.toMatch(/\bupdated_at\b\s*[-+<>=]/u);
    expect(migration).not.toMatch(/\bresolved_at\b/u);
    expect(migration).not.toMatch(/\b(?:sla|exposure)_[a-z_]+\b/iu);
  });

  it("returns fixed buckets, bounded cohorts and tenant-safe reconciliation labels", () => {
    for (const bucket of ["0–2", "3–7", "8–30", "31–90", "90+"]) {
      expect(migration).toContain(`'${bucket}'`);
    }
    expect(migration).toContain("count(*) FILTER (WHERE is_open) AS still_open");
    expect(migration).toContain("WHERE created_at >= trend_start");
    expect(migration).toContain("definition.tenant_id = exception.tenant_id");
    expect(migration).toContain("run.tenant_id = exception.tenant_id");
    expect(migration).toContain("LIMIT 10");
  });

  it("does not return exception payloads, reasons or user identifiers", () => {
    expect(server).not.toMatch(/\bpayload\b|\breason\b|\bassignee\b/u);
    expect(server).toContain("by_reconciliation");
    expect(server).toContain("oldest_open_days");
  });
});
