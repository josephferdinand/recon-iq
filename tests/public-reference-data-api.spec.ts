import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  referenceCsvCell,
  referenceErrorMessage,
  stableReferenceFailure,
} from "@/lib/public-reference-data-api.server";

describe("public Reference Data API", () => {
  it("publishes the full bounded route set with explicit read, write and approval scopes", async () => {
    const [source, tree, catalogue] = await Promise.all([
      readFile("src/lib/public-reference-data-api.server.ts", "utf8"),
      readFile("src/routeTree.gen.ts", "utf8"),
      readFile("src/lib/api-catalog.ts", "utf8"),
    ]);
    for (const route of [
      "reference-data/",
      "reference-data/$tableId/versions/",
      "versions/$versionId/submit",
      "versions/$versionId/decision",
      "versions/$versionId/rollback",
      "versions/$versionId/export",
    ]) expect(tree).toContain(route);
    expect(source).toContain('requiredScope: "reference-data.read"');
    expect(source).toContain('requiredScope: "reference-data.write"');
    expect(source).toContain('requiredScope: "reference-data.approve"');
    expect(source).toContain("requirePublicIdempotencyKey");
    expect(source).toContain("claimPublicMutation");
    expect(source).toContain('.eq("tenant_id", auth.principal.tenantId)');
    expect(source).not.toContain('.select("*")');
    expect(catalogue).toContain('{ name: "reference-data.read"');
    expect(catalogue).toContain('{ name: "reference-data.write"');
    expect(catalogue).toContain('{ name: "reference-data.approve"');
  });

  it("maps database failures to stable non-sensitive API contracts", () => {
    expect(referenceErrorMessage({ message: "Reference table not found", details: "private" })).toBe(
      "Reference table not found",
    );
    expect(stableReferenceFailure("Reference table not found")).toEqual({
      status: 404,
      body: { error: "reference_data_not_found" },
    });
    expect(stableReferenceFailure("Maker cannot approve their own version")).toEqual({
      status: 403,
      body: { error: "reference_data_forbidden" },
    });
    expect(stableReferenceFailure("Only a pending version may be decided")).toEqual({
      status: 409,
      body: { error: "reference_data_conflict" },
    });
    expect(stableReferenceFailure("raw database connection failure")).toEqual({
      status: 503,
      body: { error: "reference_data_unavailable" },
    });
  });

  it("fails closed when read or export audit evidence cannot be written", async () => {
    const source = await readFile("src/lib/public-reference-data-api.server.ts", "utf8");
    expect(source.match(/reference_data_audit_unavailable/gu)).toHaveLength(3);
    expect(source).not.toMatch(/writePublicApiAudit\([\s\S]{0,500}\.catch\(\(\) => undefined\)/gu);
  });

  it("escapes quotes and neutralizes spreadsheet formula injection", () => {
    expect(referenceCsvCell('Fee "break"')).toBe('"Fee ""break"""');
    expect(referenceCsvCell("=HYPERLINK(\"https://attacker.invalid\")")).toContain("'=HYPERLINK");
    expect(referenceCsvCell("@SUM(A1:A2)")).toContain("'@SUM");
    expect(referenceCsvCell(-12.5)).toBe('"-12.5"');
  });

  it("keeps API service wrappers unavailable to browser-authenticated clients", async () => {
    const migration = await readFile(
      "supabase/migrations/20260906114500_reference_data_version_lifecycle.sql",
      "utf8",
    );
    for (const fn of [
      "stage_reference_data_version_for_api",
      "submit_reference_data_version_for_api",
      "decide_reference_data_version_for_api",
      "request_reference_data_rollback_for_api",
    ]) {
      expect(migration).toMatch(new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${fn}[\\s\\S]*?FROM PUBLIC, anon, authenticated`,
        "u",
      ));
    }
  });

  it("ships a credential-free deployed negative assurance script", async () => {
    const script = await readFile("scripts/verify-fvi-reference-data-api-negative.mjs", "utf8");
    expect(script).toContain("missing bearer read");
    expect(script).toContain("hostile origin denied");
    expect(script).toContain("invalid bearer denied");
    expect(script).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("captures an MFA-authenticated QA session without changing credentials", async () => {
    const script = await readFile("scripts/capture-fvi-prod-qa-storage-state.mjs", "utf8");
    expect(script).toContain("FVI-Codex-QA-Assurance-Lab-PROD.md");
    expect(script).toContain("FVI-Codex-QA-Native-MFA-PROD.md");
    expect(script).toContain("context.storageState");
    expect(script).not.toContain("updateUserById");
    expect(script).not.toContain("unenroll");
  });

  it("captures an existing owner checker session without changing credentials", async () => {
    const script = await readFile("scripts/capture-fvi-prod-owner-storage-state.mjs", "utf8");
    expect(script).toContain("FVI-PROD-Temporary-Password.md");
    expect(script).toContain("context.storageState");
    expect(script).not.toContain("updateUserById");
    expect(script).not.toContain("createUser");
  });

  it("ships a read-only explicit-target live state verifier", async () => {
    const script = await readFile("scripts/verify-fvi-reference-data-live-state.mjs", "utf8");
    expect(script).toContain('prod: { ref: "YOUR_PROJECT_REF"');
    expect(script).toContain("read_only: true");
    expect(script).toContain("lifecycle_audits");
    expect(script).not.toContain("read_only: false");
  });

  it("ships authenticated lifecycle API assurance without credential mutation", async () => {
    const script = await readFile("scripts/run-fvi-reference-data-authenticated-assurance.mjs", "utf8");
    expect(script).toContain('rpc("submit_reference_data_version"');
    expect(script).toContain("status_after");
    expect(script).not.toContain("updateUserById");
    expect(script).not.toContain("createUser");
  });
});
