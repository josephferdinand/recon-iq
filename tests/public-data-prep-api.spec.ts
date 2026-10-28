import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { stableDataPrepFailure } from "@/lib/public-data-prep-api.server";

describe("public Data Prep API", () => {
  it("ships CRUD, archive, approval, staging and promotion routes", async () => {
    const routes = await Promise.all([
      "src/routes/api/v1/$tenantSlug/data-prep/pipelines/index.ts",
      "src/routes/api/v1/$tenantSlug/data-prep/pipelines/$pipelineId/index.ts",
      "src/routes/api/v1/$tenantSlug/data-prep/pipelines/$pipelineId/approval.ts",
      "src/routes/api/v1/$tenantSlug/data-prep/pipelines/$pipelineId/staging.ts",
      "src/routes/api/v1/$tenantSlug/data-prep/pipelines/$pipelineId/promotion.ts",
      "src/routes/api/v1/$tenantSlug/data-prep/pipelines/$pipelineId/promotion/decision.ts",
    ].map((file) => readFile(file, "utf8")));
    expect(routes.join("\n")).toContain("listPublicDataPrepPipelines");
    expect(routes.join("\n")).toContain("createPublicDataPrepPipeline");
    expect(routes.join("\n")).toContain("updatePublicDataPrepPipeline");
    expect(routes.join("\n")).toContain("archivePublicDataPrepPipeline");
    expect(routes.join("\n")).toContain("approvePublicDataPrepPipeline");
    expect(routes.join("\n")).toContain("clonePublicDataPrepStaging");
    expect(routes.join("\n")).toContain("requestPublicDataPrepPromotion");
    expect(routes.join("\n")).toContain("decidePublicDataPrepPromotion");
  });

  it("requires scopes, tenant binding, idempotency, audit and governed RPCs", async () => {
    const source = await readFile("src/lib/public-data-prep-api.server.ts", "utf8");
    for (const scope of ["data-prep.read", "data-prep.write", "data-prep.approve", "data-prep.promote"]) {
      expect(source).toContain(`requiredScope: "${scope}"`);
    }
    expect(source).toContain("requirePublicIdempotencyKey");
    expect(source).toContain("claimPublicMutation");
    expect(source).toContain("completePublicMutation");
    expect(source).toContain("writePublicApiAudit");
    expect(source).toContain('.eq("tenant_id", auth.principal.tenantId)');
    expect(source).toContain('rpc("upsert_data_prep_pipeline_for_api"');
    expect(source).toContain('rpc("decide_data_prep_promotion_for_api"');
    expect(source).not.toContain('.delete()');
  });

  it("maps lifecycle failures to stable public errors", () => {
    expect(stableDataPrepFailure("Data Prep pipeline not found")).toEqual({ status: 404, body: { error: "data_prep_not_found" } });
    expect(stableDataPrepFailure("Four-eyes: pipeline maker cannot approve")).toEqual({ status: 403, body: { error: "data_prep_forbidden" } });
    expect(stableDataPrepFailure("Data Prep promotion is already pending")).toEqual({ status: 409, body: { error: "data_prep_conflict" } });
    expect(stableDataPrepFailure("Archival reason must contain between 3 and 500 characters")).toEqual({ status: 422, body: { error: "data_prep_validation_error" } });
  });

  it("documents the governed surface and generates SDK parity", async () => {
    const [openapi, sdk] = await Promise.all([
      readFile("docs/openapi/fvi-openapi.yaml", "utf8"),
      readFile("sdks/typescript/v4.0/src/index.ts", "utf8"),
    ]);
    for (const operation of [
      "listDataPrepPipelines", "createDataPrepPipeline", "getDataPrepPipeline",
      "updateDataPrepPipeline", "archiveDataPrepPipeline", "approveDataPrepPipeline",
      "cloneDataPrepPipelineStaging", "requestDataPrepPromotion", "decideDataPrepPromotion",
    ]) {
      expect(openapi).toContain(`operationId: ${operation}`);
      expect(sdk).toContain(`async ${operation}(`);
    }
  });
});
