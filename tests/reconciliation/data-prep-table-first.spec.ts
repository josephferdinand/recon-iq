import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../../src/components/data-prep-tab.tsx", import.meta.url), "utf8");

describe("Data Prep table-first controls", () => {
  it("uses one gold View action for the rich split detail dialog", () => {
    expect(source).toContain('aria-label={`View ${p.name}`}');
    expect(source).toContain("setViewPipelineId(p.id)");
    expect(source).toContain(">View</Button>");
    expect(source).toContain('variant="default" className="fvi-row-view-action"');
    expect(source).toContain("<FviDetailDialogLayout");
    expect(source).not.toContain("Show details");
    expect(source).not.toContain("pinnedPipelineId");
    expect(source).toContain("viewTriggerRef.current?.focus()");
    expect(source).toContain('onOpenAutoFocus={(event) => { event.preventDefault();');
    expect(source).toContain('aria-labelledby="viewed-pipeline-sources"');
    expect(source).toContain('mode="detail" summary={actorsById.get(viewedPipeline.id)}');
    expect(source).toContain('publicIdFallback={viewedPipeline.public_uid} mode="detail"');
    expect(source).toContain("Pipeline approval");
    expect(source).toContain("Run configuration");
    expect(source).toContain("on_failure");
    expect(source).toContain("Archive pipeline");
    expect(source).toContain('!(viewedPipeline.lifecycle_state === "production" && viewedPipeline.status === "approved")');
    expect(source).toContain('aria-label="Updated from (UTC)"');
  });

  it("preserves permission and readiness gates for pipeline actions", () => {
    expect(source).toContain("disabled={!canWrite || exec.isPending || viewedPipeline.lifecycle_state === \"archived\" || !(viewedPipeline.steps ?? []).length}");
    expect(source).toContain("disabled={!canWrite || mApprove.isPending || !(viewedPipeline.steps ?? []).length}");
    expect(source).toContain("disabled={!canWrite || mClone.isPending}");
    expect(source).toContain("disabled={!canWrite || mRejectPromo.isPending}");
    expect(source).toContain('!(viewedPipeline.lifecycle_state === "production" && viewedPipeline.status === "approved")');
    expect(source).toContain("mClone.mutate(viewedPipeline.id)");
  });

  it("uses server-backed actor summaries for the visible page and rich View dialog", () => {
    expect(source).toContain('resource_type: "data_prep_pipeline", resource_ids: pipelineActorIds');
    expect(source).toContain(".slice(0, 100)");
    expect(source).toContain('mode="updated-line" summary={actorsById.get(p.id)}');
    expect(source).toContain('mode="detail" summary={actorsById.get(viewedPipeline.id)}');
    expect(source).not.toContain("provenanceLabel(");
  });
});
