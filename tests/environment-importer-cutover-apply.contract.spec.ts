import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const pauseApply = await readFile("scripts/apply-fvi-importer-pause-migration.mjs", "utf8");
const bindingApply = await readFile("scripts/apply-fvi-importer-binding-migration.mjs", "utf8");
const pauseMigration = await readFile(
  "supabase/migrations/20260923132900_environment_change_cutover_pause.sql",
  "utf8",
);
const bindingMigration = await readFile(
  "supabase/migrations/20260923133000_bind_target_environment_importer.sql",
  "utf8",
);
const worker = await readFile("workers/environment-control-plane/src/index.ts", "utf8");

describe("guarded environment importer cutover contract", () => {
  it("installs and pauses the gate, then ledgers it before one bounded commit", () => {
    const normalized = pauseApply.toLowerCase();
    const begin = normalized.indexOf("const applysql =");
    const openSeedPermit = normalized.indexOf("fvi.importer_cutover_atomic", begin);
    const migration = normalized.indexOf("${source}", openSeedPermit);
    const pause = normalized.indexOf("set_environment_change_cutover_pause(", migration);
    const ledger = normalized.indexOf("insert into supabase_migrations.schema_migrations", pause);
    const commit = normalized.indexOf("commit;", ledger);

    expect(begin).toBeGreaterThan(-1);
    expect(openSeedPermit).toBeGreaterThan(begin);
    expect(migration).toBeGreaterThan(openSeedPermit);
    expect(pause).toBeGreaterThan(migration);
    expect(ledger).toBeGreaterThan(pause);
    expect(commit).toBeGreaterThan(ledger);
    expect(pauseApply).toContain("SET LOCAL lock_timeout = '5s'");
    expect(pauseApply).toContain("SET LOCAL statement_timeout = '120s'");
    for (const flag of [
      "FVI_IMPORTS_FROZEN",
      "FVI_IMPORTS_DRAINED",
      "FVI_PAIRED_APP_PAUSED",
      "FVI_PAIRED_WORKER_PAUSED",
      "FVI_IMPORTER_RECOVERY_REVIEWED",
    ]) {
      expect(pauseApply).toContain(flag);
    }
  });

  it("defaults ordinary migration application closed and gates source exports", () => {
    expect(pauseMigration).toContain("paused boolean NOT NULL DEFAULT true");
    expect(pauseMigration).toContain(
      "current_setting('fvi.importer_cutover_atomic',true) IS DISTINCT FROM 'on'",
    );
    expect(pauseMigration).toContain("NEW.event_type='package_exported'");
    expect(pauseMigration).toContain("environment_change_export_cutover_pause");
  });

  it("requires the exact paused 132900 predecessor before importer binding", () => {
    expect(bindingMigration).toContain("environment_change_cutover_gate");
    expect(bindingMigration).toContain("v_paused IS DISTINCT FROM true");
    expect(bindingApply).toContain("before.latest === pauseVersion");
    expect(bindingApply).toContain("before.cutover_gate_paused === true");
    expect(bindingApply).toContain("before.pending_target_review === 0");
    expect(bindingApply).toContain("FVI_PAIRED_APP_READY");
    expect(bindingApply).toContain("FVI_PAIRED_WORKER_READY");
  });

  it("does not mutate source transport before attempting target receive", () => {
    const guard =
      'if (!targetBound || !separated || exported.source_request_status !== "approved")';
    const start = worker.indexOf(guard);
    const end = worker.indexOf("const validations = [", start);
    const preflightFailure = worker.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(preflightFailure).toContain("transport_policy_failed");
    expect(preflightFailure).not.toContain("recordTransport(");
  });
});
