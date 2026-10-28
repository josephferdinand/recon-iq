import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Recon Studio source persistence", () => {
  it("submits bounded preview rows and materializes non-durable sources", async () => {
    const [wizard, server] = await Promise.all([
      readFile("src/components/new-recon-wizard.tsx", "utf8"),
      readFile("src/lib/rekon-wizard.functions.ts", "utf8"),
    ]);
    expect(wizard).toContain("rows: s.rows.slice(0, 5000)");
    expect(server).toContain("rows: z.array(z.record(z.string(), z.unknown())).max(5000)");
    expect(server).toContain("source snapshot exceeds the 5 MiB wizard limit");
    expect(server).toContain("content_sha256: contentSha256");
    expect(server).toContain("data_source_id: dataSourceId");
    expect(server).toContain("source snapshot could not be stored");
  });

  it("binds existing and refined sources by tenant and blocks fake database execution", async () => {
    const server = await readFile("src/lib/rekon-wizard.functions.ts", "utf8");
    expect(server).toContain('.eq("id", side.ref_id).eq("tenant_id", data.tenant_id)');
    expect(server).toContain('.eq("tenant_id", data.tenant_id).eq("status", "approved")');
    expect(server).toContain("run the database connector into a governed data source, then select Existing");
    expect(server).toContain('.eq("data_source_id", data.ref_id).eq("tenant_id", data.tenant_id)');
    expect(server).toContain('.eq("id", data.ref_id).eq("tenant_id", data.tenant_id)');
    expect(server).toContain('.in("status", ["approved", "completed"])');
    expect(server).toContain('from("aidp_outputs")');
    expect(server).toContain('.eq("tenant_id", tenantId).eq("document_id", documentId)');
    expect(server.indexOf('from("aidp_outputs")')).toBeLessThan(
      server.indexOf("rowsFromLegacyAidpExtraction(document.extraction)"),
    );
  });

  it("validates AI mapping output and never returns raw model text", async () => {
    const server = await readFile("src/lib/rekon-wizard.functions.ts", "utf8");
    expect(server).toContain("validateWizardMappingPlan(parsed, data.sides)");
    expect(server).toContain("AI returned an invalid structured mapping plan");
    expect(server).toContain("NoObjectGeneratedError.isInstance(error)");
    expect(server).toContain("parseStructuredPredictionText(error.text)");
    expect(server).not.toContain("_raw: text");
    expect(server).toContain("resolveModelVersion(context.supabase, data.tenant_id, null, undefined)");
    expect(server).toContain("model: resolved.model");
    expect(server).toContain('scope: "schema_map"');
    expect(server).not.toContain('provider("google/gemini-3-flash-preview")');
  });

  it("labels source controls and preserves dual-theme source surfaces", async () => {
    const wizard = await readFile("src/components/new-recon-wizard.tsx", "utf8");
    expect(wizard).toContain('data-testid={`recon-source-${side.side_id}`}');
    expect(wizard).toContain("aria-pressed={active}");
    expect(wizard).toContain('aria-label={`${side.label}: upload file`}');
    expect(wizard).toContain('aria-label={`${side.label}: paste CSV or TSV data`}');
    expect(wizard).toContain("dark:bg-blue-950/20");
  });
});
