import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Data Prep governed lifecycle migration", () => {
  it("enforces actor roles, four-eyes and atomic promotion transitions", async () => {
    const sql = await readFile(
      "supabase/migrations/20260908173000_govern_data_prep_lifecycle.sql",
      "utf8",
    );
    expect(sql).toContain("assert_data_prep_actor");
    expect(sql).toContain("Four-eyes: pipeline maker cannot approve");
    expect(sql).toContain("Four-eyes: promotion requester cannot decide");
    expect(sql).toContain("Approve the staging pipeline before promotion");
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("guard_data_prep_lifecycle");
    expect(sql).toContain("Use the governed Data Prep lifecycle functions");
    expect(sql).toContain("upsert_data_prep_pipeline_for_api");
    expect(sql).toContain("archive_data_prep_pipeline_for_api");
  });

  it("exposes actor-derived UI wrappers and service-only API wrappers", async () => {
    const sql = await readFile(
      "supabase/migrations/20260908173000_govern_data_prep_lifecycle.sql",
      "utf8",
    );
    expect(sql).toContain("auth.uid())");
    expect(sql).toContain("approve_data_prep_pipeline_for_api");
    expect(sql).toContain("request_data_prep_promotion_for_api");
    expect(sql).toContain("decide_data_prep_promotion_for_api");
    expect(sql).toContain("TO service_role");
    expect(sql).toContain("FROM PUBLIC,anon,authenticated");
  });

  it("ships a checksum and effect-aware PROD-first applicator", async () => {
    const source = await readFile("scripts/apply-fvi-data-prep-lifecycle-migration.mjs", "utf8");
    expect(source).toContain('version: "20260908173000"');
    expect(source).toContain('version: "20260908184500"');
    expect(source).toContain("read_only: readOnly");
    expect(source).toContain("effects exist without ledger evidence");
    expect(source).toContain("FVI_ALLOW_DEV_REPLICATION");
    expect(source).not.toContain("Falcon-Veritas-Keys.md");
  });

  it("keeps staging approval reachable in the browser", async () => {
    const source = await readFile("src/components/data-prep-tab.tsx", "utf8");
    expect(source).toContain('viewedPipeline.lifecycle_state !== "archived" && viewedPipeline.status !== "approved"');
    expect(source).toContain("Approve pipeline");
    expect(source).toContain("Approve promotion");
    expect(source).toContain("A second tenant admin must approve before the swap.");
  });

  it("routes browser create and update through the atomic audited wrapper", async () => {
    const [migration, source] = await Promise.all([
      readFile("supabase/migrations/20260908184500_add_data_prep_ui_upsert_wrapper.sql", "utf8"),
      readFile("src/lib/data-prep.functions.ts", "utf8"),
    ]);
    expect(migration).toContain("upsert_data_prep_pipeline_for_api");
    expect(migration).toContain("auth.uid()");
    expect(source).toContain('rpc("upsert_data_prep_pipeline"');
  });
});
