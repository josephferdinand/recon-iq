import { describe, it, expect } from "vitest";
import { chunkMarkdown } from "@/lib/kb-embeddings.server";
import { buildCopilotTools } from "@/lib/copilot-tools.server";

describe("kb chunking", () => {
  it("returns [] for empty input", () => {
    expect(chunkMarkdown("")).toEqual([]);
    expect(chunkMarkdown("   \n  \n")).toEqual([]);
  });
  it("splits long markdown on paragraph boundaries", () => {
    const p = (n: number) => "x".repeat(n);
    const md = `${p(600)}\n\n${p(600)}\n\n${p(400)}`;
    const chunks = chunkMarkdown(md, 1000);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1200);
  });
  it("keeps a single short paragraph as one chunk", () => {
    expect(chunkMarkdown("Hello world")).toEqual(["Hello world"]);
  });
});

describe("buildCopilotTools", () => {
  const fakeSupa: any = { from: () => fakeSupa, rpc: () => Promise.resolve({ data: null }) };
  const tools = buildCopilotTools({
    supabase: fakeSupa,
    userId: "00000000-0000-0000-0000-000000000001",
    scope: "tenant",
    tenantId: "00000000-0000-0000-0000-000000000002",
    isPlatformAdmin: false,
  });

  it("exposes the expected tool surface", () => {
    const names = Object.keys(tools).sort();
    expect(names).toEqual(
      [
        "anomaly_scan",
        "breaks_aging",
        "breaks_by_reason",
        "cost_anomaly_alerter",
        "count_breaks",
        "count_reconciliations",
        "count_runs",
        "cross_recon_intelligence",
        "diagnose_recon_failure",
        "get_break",
        "get_reconciliation",
        "list_my_breaks",
        "list_my_tenants",
        "list_recent_reconciliations",
        "policy_auditor",
        "repeat_break_patterns",
        "runs_summary",
        "schema_drift_detector",
        "search_kb",
        "sla_at_risk",
        "whoami",
      ].sort(),
    );
  });

  it("every tool declares an input schema and execute()", () => {
    for (const [name, t] of Object.entries(tools)) {
      expect(t, name).toBeTruthy();
      expect((t as any).inputSchema, name).toBeTruthy();
      expect(typeof (t as any).execute, name).toBe("function");
    }
  });
});
