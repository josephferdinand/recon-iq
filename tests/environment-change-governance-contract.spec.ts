import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationPath = "supabase/migrations/20260908203000_govern_environment_changes.sql";

describe("governed DEV and PROD environment changes", () => {
  it("uses a dedicated cross-project request instead of same-database tenant promotion", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("environment_change_requests");
    expect(sql).toContain("dev_to_prod");
    expect(sql).toContain("prod_to_dev");
    expect(sql).toContain("source_project_ref");
    expect(sql).toContain("target_project_ref");
    expect(sql).toContain("control_tenant_id");
  });

  it("requires secret-free package, configuration and settings manifests", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("assert_environment_manifest_safe");
    expect(sql).toContain("package_hash");
    expect(sql).toContain("configuration_hash");
    expect(sql).toContain("settings_hash");
    expect(sql).toContain("forbidden credential-shaped material");
  });

  it("enforces database-side four-eyes and service-only execution", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("Four-eyes: requester cannot approve");
    expect(sql).toContain("Execution actor must differ from checker");
    expect(sql).toContain("All preflight validations must pass before approval");
    expect(sql).toContain("start_environment_change_execution_for_api");
    expect(sql).toContain("FROM PUBLIC,anon,authenticated");
    expect(sql).toContain("TO service_role");
  });

  it("retains component outcomes, final readback and hash-linked audit history", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("environment_change_events");
    expect(sql).toContain("prev_hash");
    expect(sql).toContain("row_hash");
    expect(sql).toContain("component_results");
    expect(sql).toContain("failed_components");
    expect(sql).toContain("rollback_reason");
    expect(sql).toContain("final_readback_hash");
    expect(sql).toContain("Use governed environment change functions");
  });

  it("replaces the Platform placeholder with an auditable non-executing control surface", async () => {
    const [route, tenantRoute, component, functions] = await Promise.all([
      readFile("src/routes/_authenticated/platform.tsx", "utf8"),
      readFile("src/routes/_authenticated/$slug/tenant.tsx", "utf8"),
      readFile("src/components/environment-delivery-tab.tsx", "utf8"),
      readFile("src/lib/environment-change.functions.ts", "utf8"),
    ]);
    expect(route).toContain("<EnvironmentDeliveryTab />");
    expect(tenantRoute).toContain("<EnvironmentDeliveryTab controlTenantId={tenant.id} />");
    expect(route).toContain('label: "Environment & Delivery"');
    expect(component).toContain("Immutable audit history");
    expect(component).toContain("Execution is deliberately unavailable in the browser");
    expect(functions).toContain('"request_source_environment_change"');
    expect(functions).toContain('"decide_environment_change"');
    expect(functions).toContain('requestQuery.eq("control_tenant_id", data.control_tenant_id)');
    expect(component).toContain("control_tenant_id: controlTenantId");
    expect(functions).not.toContain('.from("environment_change_requests").insert');
    expect(functions).not.toContain('.from("environment_change_requests").update');
  });

  it("ships a checksum and effect-aware PROD-first migration applicator", async () => {
    const source = await readFile("scripts/apply-fvi-environment-change-migration.mjs", "utf8");
    expect(source).toContain('const version = "20260908203000"');
    expect(source).toContain('FVI_ENV_CHANGE_TARGET ?? ""');
    expect(source).toContain("FVI_ALLOW_DEV_REPLICATION");
    expect(source).toContain("effects exist without ledger evidence");
    expect(source).toContain("service_insert_denied");
    expect(source).not.toContain("Falcon-Veritas-Keys.md");
  });

  it("preflights registered source counts and target state before approval", async () => {
    const source = await readFile("scripts/preflight-fvi-environment-change.mjs", "utf8");
    expect(source).toContain('FVI_ALLOW_ENV_CHANGE_PREFLIGHT !== "YES"');
    expect(source).toContain("source_manifest_counts");
    expect(source).toContain("planned_target_creation");
    expect(source).toContain("missing_promotion_target");
    expect(source).toContain("target_slug_policy");
    expect(source).toContain("dev|sandbox|uat|staging");
    expect(source).toContain("record_environment_change_preflight_for_api");
    expect(source).toContain("read_only: readOnly");
    expect(source).not.toContain("Falcon-Veritas-Keys.md");
  });

  it("exports a complete secret-free package instead of a count-only placeholder", async () => {
    const source = await readFile("scripts/prepare-fvi-environment-change.mjs", "utf8");
    for (const collection of [
      "recon_definitions",
      "data_prep_pipelines",
      "data_sources",
      "connector_schedules",
      "watchers",
      "feature_flags",
      "workspace_pages",
    ]) {
      expect(source).toContain(`'${collection}'`);
    }
    expect(source).toContain("credential_binding_required");
    expect(source).toContain("source_config_hash");
    expect(source).toContain("manifest.package.schema_migrations");
    expect(source).toContain("assertSafe(manifest)");
    expect(source).toContain("request_environment_change_for_api");
    expect(source).not.toContain("Falcon-Veritas-Keys.md");
  });

  it("provisions only a missing synthetic DEV identity without resetting existing users", async () => {
    const source = await readFile("scripts/provision-fvi-dev-assurance-identity.mjs", "utf8");
    expect(source).toContain("synthetic_test_identity");
    expect(source).toContain("createUser");
    expect(source).toContain("signInWithPassword");
    expect(source).toContain('flag: "wx"');
    expect(source).toContain("refusing to reset its password");
    expect(source).toContain("existing_accounts_changed: false");
    expect(source).not.toContain("updateUserById");
    expect(source).not.toContain("Falcon-Veritas-Keys.md");
  });

  it("plans and atomically applies the approved PROD to DEV package", async () => {
    const source = await readFile("scripts/execute-fvi-environment-change.mjs", "utf8");
    expect(source).toContain('FVI_ENV_CHANGE_EXECUTION_MODE ?? "plan"');
    expect(source).toContain("FVI_ALLOW_ENV_CHANGE_EXECUTION");
    expect(source).toContain("start_environment_change_execution_for_api");
    expect(source).toContain("complete_environment_change_execution_for_api");
    expect(source).toContain("const targetSql = `begin;");
    expect(source).toContain("commit;`;");
    expect(source).toContain("Credential binding required after governed environment migration");
    expect(source).toContain("credentials_copied: false");
    expect(source).toContain("component_results: componentResults");
    expect(source).not.toContain("Falcon-Veritas-Keys.md");
  });

  it("requires source and target approvals with automatic access mapping", async () => {
    const [migration, functions, component, worker, executor, prodConfig, devConfig] =
      await Promise.all([
        readFile(
          "supabase/migrations/20260908234500_add_two_stage_environment_delivery.sql",
          "utf8",
        ),
        readFile("src/lib/environment-change.functions.ts", "utf8"),
        readFile("src/components/environment-delivery-tab.tsx", "utf8"),
        readFile("workers/environment-control-plane/src/index.ts", "utf8"),
        readFile("scripts/execute-fvi-incoming-environment-package.mjs", "utf8"),
        readFile("wrangler.jsonc", "utf8"),
        readFile("wrangler.staging.jsonc", "utf8"),
      ]);
    expect(migration).toContain("source_review");
    expect(migration).toContain("target_review");
    expect(migration).toContain("request_source_environment_change");
    expect(migration).toContain("receive_environment_change_for_api");
    expect(migration).toContain("approve_incoming_environment_change");
    expect(migration).toContain("source_maker_checker_separated");
    expect(migration).toContain("tenant_groups");
    expect(migration).toContain("access_mapping_preview");
    expect(migration).toContain("'uat',null,false,20");
    expect(functions).toContain("buildEnvironmentPackage");
    expect(functions).toContain("transmitEnvironmentChange");
    expect(functions).toContain("process.env.SUPABASE_URL?.match");
    expect(component).toContain("Proposed user and group mappings");
    expect(component).toContain("UAT not provisioned");
    expect(worker).toContain("export_approved_environment_change_for_transport");
    expect(worker).toContain("record_environment_change_transport");
    expect(executor).toContain("target_transaction_rolled_back");
    expect(executor).toContain("exact_access_mappings");
    expect(executor).toContain("members_copied: 0");
    expect(executor).toContain("'restricted','draft'");
    expect(prodConfig).toContain('"service": "fvi-environment-ingress-dev"');
    expect(devConfig).toContain('"service": "fvi-environment-ingress-prod"');
    expect(prodConfig).toContain('"SUPABASE_PROJECT_ID": "YOUR_PROJECT_REF"');
    expect(devConfig).toContain('"SUPABASE_PROJECT_ID": "YOUR_PROJECT_REF"');
  });

  it("rewrites and verifies generated DEV deployment bindings", async () => {
    const source = await readFile("scripts/build-fvi-development-from-protected-files.mjs", "utf8");
    expect(source).toContain('path.join(root, "dist", "_worker.js", "wrangler.json")');
    expect(source).toContain('readFile(path.join(root, "wrangler.staging.jsonc"), "utf8")');
    expect(source).toContain('generated_deployment_bindings: "dev"');
    expect(source).toContain('"fvi-aidp-document-service-dev"');
    expect(source).toContain('"fvi-connector-gateway-dev"');
    expect(source).toContain('"fvi-environment-ingress-prod"');
  });

  it("binds automated and manual packages to one registered organization", async () => {
    const [migration, functions, packageFile, component] = await Promise.all([
      readFile(
        "supabase/migrations/20260909022500_bind_environment_packages_to_tenant_family.sql",
        "utf8",
      ),
      readFile("src/lib/environment-change.functions.ts", "utf8"),
      readFile("src/lib/environment-package-file.server.ts", "utf8"),
      readFile("src/components/environment-delivery-tab.tsx", "utf8"),
    ]);
    expect(migration).toContain("release_identity_uid");
    expect(migration).toContain("verified_organization_domain");
    expect(migration).toContain(
      "Source and target tenants are not the same registered organization",
    );
    expect(migration).toContain("record_environment_package_rejection_for_api");
    expect(migration).toContain("receive_environment_change_unbound_for_api");
    expect(migration).toContain("environment_change.cross_tenant_import_rejected");
    expect(migration).toContain("security_alert_incidents");
    expect(migration).toContain("environment_package_tenant_mismatch");
    expect(functions).toContain("identityMismatch");
    expect(functions).toContain('getRuntimeEnv("SUPABASE_PROJECT_ID")');
    expect(functions).toContain("Package belongs to a different environment or tenant");
    expect(packageFile).toContain('name: "HMAC", hash: "SHA-256"');
    expect(packageFile).toContain("Environment package exceeds 2 MB");
    expect(component).toContain("Import signed package");
    expect(component).toContain("Export signed package");
  });
});
