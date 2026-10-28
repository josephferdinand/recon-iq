import { describe, expect, it } from "vitest";
import { currentResourceMappingDisplay, resourceMappingDisplayKey } from "@/lib/resource-mapping-display";
import type { ResourceAccessSummary, ResourceAccessType } from "@/lib/resource-access-summaries.functions";

const mapped: ResourceAccessSummary = { resource_type: "data_source", resource_id: "owned", public_id: "SRC-QA",
  access_state: "mapped", business_unit_names: ["Treasury"], business_unit_count: 1, user_group_names: ["User_View"], user_group_count: 1 };
const state = { actorId: "ordinary-viewer", isSuccess: true, isFetching: false, data: { available: true, rows: [mapped] } };
describe("current scoped mapping display", () => {
  it.each(["data_source", "data_source_schedule", "db_connection", "inline_api_source", "erp_connection", "file_watcher", "aidp_template", "aidp_document", "data_prep_pipeline", "reconciliation"] as ResourceAccessType[])("preserves actual BU/User_View names for %s", type => {
    const row = { ...mapped, resource_type: type };
    expect(currentResourceMappingDisplay(type, [row.resource_id], { ...state, data: { available: true, rows: [row] } })).toEqual({ available: true, rows: [row] });
  });
  it("isolates actor, tenant, type and visible resource set while retaining invalidation prefix", () => {
    const key = resourceMappingDisplayKey("tenant", "viewer", "data_source", ["b", "a", "b"]);
    expect(key).toEqual(["resource-access-summary", "tenant", "data_source", "viewer", ["a", "b"]]);
    expect(key).not.toEqual(resourceMappingDisplayKey("tenant", "admin", "data_source", ["a", "b"]));
    expect(key).not.toEqual(resourceMappingDisplayKey("other", "viewer", "data_source", ["a", "b"]));
    expect(key).not.toEqual(resourceMappingDisplayKey("tenant", "viewer", "file_watcher", ["a", "b"]));
  });
  it.each([{ actorId: null }, { isSuccess: false }, { isFetching: true }, { data: { available: false, rows: [mapped] } }])("suppresses stale names on pending/logout/error/denial %j", delta => {
    expect(currentResourceMappingDisplay("data_source", ["owned"], { ...state, ...delta })).toEqual({ available: false, rows: [] });
  });
  it("filters unsolicited IDs/types and keeps omitted permission rows absent", () => {
    const data = { available: true, rows: [mapped, { ...mapped, resource_id: "other" }, { ...mapped, resource_type: "file_watcher" as const }] };
    expect(currentResourceMappingDisplay("data_source", ["owned", "denied"], { ...state, data }).rows).toEqual([mapped]);
    expect(currentResourceMappingDisplay("data_source", ["owned"], { ...state, data: { available: true, rows: [] } })).toEqual({ available: true, rows: [] });
  });
  it.each([{ business_unit_count: -1 }, { user_group_count: 2 }, { business_unit_names: [""] }, { access_state: "unmapped" as const }])("does not convert malformed metadata to None %j", delta => {
    expect(currentResourceMappingDisplay("data_source", ["owned"], { ...state, data: { available: true, rows: [{ ...mapped, ...delta }] } }).available).toBe(false);
  });
  it("requires unambiguous per-resource rows", () => {
    expect(currentResourceMappingDisplay("data_source", ["owned"], { ...state, data: { available: true, rows: [mapped, mapped] } }).available).toBe(false);
  });
  it("bounds batches without silently dropping a visible mapping", () => {
    expect(currentResourceMappingDisplay("data_source", [], state).available).toBe(false);
    expect(currentResourceMappingDisplay("data_source", Array.from({ length: 101 }, (_, i) => String(i)), state).available).toBe(false);
  });
});
