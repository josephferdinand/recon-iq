import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = "supabase/migrations/20260906110000_harden_reference_data_import.sql";
const versionsMigrationPath =
  "supabase/migrations/20260906113000_create_reference_data_versions.sql";
const lifecycleMigrationPath =
  "supabase/migrations/20260906114500_reference_data_version_lifecycle.sql";

describe("Reference Data atomic import contract", () => {
  it("binds every row to a same-tenant table and hashes ordered composite keys", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("table_tenant <> NEW.tenant_id");
    expect(sql).toContain("jsonb_agg(NEW.row_data -> key_name ORDER BY ordinal)");
    expect(sql).toContain("digest(key_payload::text, 'sha256')");
    expect(sql).toContain("reference_data_rows_table_key_uq");
  });

  it("keeps replace, insert, total update and audit inside one database function", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const body = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.bulk_import_reference_data"));
    expect(body).toContain("DELETE FROM public.reference_data_rows");
    expect(body).toContain("INSERT INTO public.reference_data_rows");
    expect(body).toContain("SELECT count(*)::integer INTO total_count");
    expect(body).toContain("'reference_data.bulk_load'");
  });

  it("enforces actor role, tenant ownership and bounded object rows", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("public.has_tenant_role(actor, _tenant_id, 'tenant_admin')");
    expect(sql).toContain("WHERE id = _table_id AND tenant_id = _tenant_id");
    expect(sql).toContain("incoming_count > 10000");
    expect(sql).toContain("jsonb_typeof(item) <> 'object'");
    expect(sql).toContain("FROM PUBLIC, anon");
  });

  it("keeps the legacy atomic importer service-only and out of browser server functions", async () => {
    const source = await readFile("src/lib/reference-data.functions.ts", "utf8");
    const lifecycle = await readFile(lifecycleMigrationPath, "utf8");
    expect(source).not.toContain("export const bulkLoadReferenceRows");
    expect(lifecycle).toMatch(
      /REVOKE ALL ON FUNCTION public\.bulk_import_reference_data[\s\S]*FROM PUBLIC, anon, authenticated/iu,
    );
    expect(lifecycle).toContain("REVOKE INSERT, UPDATE, DELETE ON public.reference_data_rows FROM authenticated");
  });

  it("requires non-empty unique key columns and contains no competitor support link", async () => {
    const server = await readFile("src/lib/reference-data.functions.ts", "utf8");
    const screen = await readFile("src/components/reference-data-tab.tsx", "utf8");
    expect(server).toContain("key_columns: uniqueColumns(1)");
    expect(server).toContain("Reference columns must be unique");
    expect(screen).not.toContain("support.du.co");
    expect(screen).toContain("Governed tenant data");
  });

  it("defines immutable tenant-bound version snapshots with read-only authenticated access", async () => {
    const sql = await readFile(versionsMigrationPath, "utf8");
    expect(sql).toContain("CREATE TABLE public.reference_data_versions");
    expect(sql).toContain("CREATE TABLE public.reference_data_version_rows");
    expect(sql).toContain("UNIQUE (table_id, version_number)");
    expect(sql).toContain("UNIQUE (version_id, key_hash)");
    expect(sql).toContain("version_tenant <> NEW.tenant_id");
    expect(sql).toContain("version_table <> NEW.table_id");
    expect(sql).toContain("Reference version rows are immutable");
    expect(sql).toContain(
      "REVOKE ALL ON public.reference_data_versions FROM PUBLIC, anon, authenticated",
    );
    expect(sql).toContain(
      "REVOKE ALL ON public.reference_data_version_rows FROM PUBLIC, anon, authenticated",
    );
    expect(sql).toContain("GRANT SELECT ON public.reference_data_versions TO authenticated");
    expect(sql).not.toContain("GRANT INSERT ON public.reference_data_versions TO authenticated");
  });

  it("governs stage, submit, distinct-checker decision, resolution and rollback", async () => {
    const sql = await readFile(lifecycleMigrationPath, "utf8");
    expect(sql).toContain("public.stage_reference_data_version");
    expect(sql).toContain("public.submit_reference_data_version");
    expect(sql).toContain("public.decide_reference_data_version");
    expect(sql).toContain("Maker cannot approve or reject their own version");
    expect(sql).toContain("public.resolve_reference_data_version");
    expect(sql).toContain("public.resolve_reference_data_version_for_execution");
    expect(sql).toContain("public.request_reference_data_rollback");
    expect(sql).toContain("public.stage_reference_data_version_for_api");
    expect(sql).toContain("public.decide_reference_data_version_for_api");
    expect(sql).toContain("_actor_user_id uuid");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("reference_data.version.publish");
    expect(sql).toContain("projection_updated");
    expect(sql).toContain("FROM PUBLIC, anon");
    expect(sql).toContain(
      "FROM PUBLIC, anon, authenticated",
    );
  });

  it("routes browser CSV changes through version governance rather than direct publication", async () => {
    const screen = await readFile("src/components/reference-data-tab.tsx", "utf8");
    expect(screen).toContain("stageReferenceVersion");
    expect(screen).toContain("submitReferenceVersion");
    expect(screen).toContain("decideReferenceVersion");
    expect(screen).toContain("requestReferenceRollback");
    expect(screen).toContain("Version governance");
    expect(screen).toContain("The maker cannot approve or reject their own submission");
    expect(screen).not.toContain("bulkLoadReferenceRows");
    const server = await readFile("src/lib/reference-data.functions.ts", "utf8");
    expect(server).toContain("Reference version staging readback failed");
    expect(server).toContain("Reference version submission readback failed");
    expect(server).toContain("Reference version decision readback failed");
    expect(server).toContain("Rollback draft readback failed");
  });

  it("stages regulatory dictionaries for approval and locks versioned schemas", async () => {
    const regulatory = await readFile("src/lib/regulatory.functions.ts", "utf8");
    const lifecycle = await readFile(lifecycleMigrationPath, "utf8");
    expect(regulatory).toContain('rpc("stage_reference_data_version"');
    expect(regulatory).not.toContain('from("reference_data_rows")');
    expect(lifecycle).toContain("reference_data_table_version_guard");
    expect(lifecycle).toContain("Versioned reference table tenant and columns are immutable");
  });

  it("ships an explicit-target guarded migration applicator", async () => {
    const script = await readFile("scripts/apply-fvi-reference-data-migrations.mjs", "utf8");
    expect(script).toContain('prod: { ref: "YOUR_PROJECT_REF" }');
    expect(script).toContain('dev: { ref: "YOUR_PROJECT_REF" }');
    expect(script).toContain("FVI_ALLOW_REFERENCE_DATA_MIGRATION");
    expect(script).toContain("FVI_ALLOW_DEV_REPLICATION");
    expect(script).toContain("effects exist without ledger evidence; refusing automatic repair");
    expect(script).toContain("sha256=");
    expect(script).not.toContain("Falcon-Veritas-Keys.md");
  });

  it("ships retained managed-lookup reconciliation provisioning and browser evidence", async () => {
    const [provisioner, browser] = await Promise.all([
      readFile("scripts/provision-fvi-reference-recon-assurance.mjs", "utf8"),
      readFile("tests/e2e-owner/reference-data-reconciliation-live.spec.ts", "utf8"),
    ]);
    expect(provisioner).toContain("Assurance | PROD | Currency Alias Master");
    expect(provisioner).toContain('kind: "reference_lookup"');
    expect(provisioner).toContain("reference_version_id");
    expect(provisioner).toContain("credentials_changed: false");
    expect(browser).toContain("4 matched, 0 exceptions");
  });

  it("ships an exact read-only managed reconciliation verifier", async () => {
    const script = await readFile("scripts/verify-fvi-reference-recon-live-state.mjs", "utf8");
    expect(script).toContain("stats->'reference_versions'");
    expect(script).toContain("references[0].version_id !== state.reference.id");
    expect(script).toContain("references[0].content_sha256 !== state.reference.content_sha256");
    expect(script).toContain("read_only: true");
    expect(script).not.toContain("read_only: false");
  });

  it("hydrates managed reference versions in every reconciliation execution path", async () => {
    const files = [
      "src/lib/recons.functions.ts",
      "src/lib/recon-orchestrator.server.ts",
      "src/lib/workflow-api-job-worker.server.ts",
    ];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      expect(source, file).toContain("hydrateManagedReferenceRules");
      expect(source, file).toContain("referenceResolution.rules");
      expect(source, file).toContain("reference_versions");
    }
    const engine = await readFile("src/lib/recon-engine.ts", "utf8");
    expect(engine).toContain("managedReferenceValue");
    expect(engine).toContain("__fvi_reference_missing__");
  });

  it("validates managed rule configuration and strips runtime lookup evidence before save", async () => {
    const source = await readFile("src/lib/recons.functions.ts", "utf8");
    expect(source).toContain("A governed reference table is required");
    expect(source).toContain("A reference value column is required");
    expect(source).toContain("managed_lookup: _managedLookup");
    expect(source).toContain("reference_version_id: _referenceVersionId");
    expect(source).toContain("rules: persistedRules");
  });
});
