import { describe, expect, it } from "vitest";
import { normalizeResourceActorSummaries } from "@/lib/resource-actor-summaries.functions";

const ID = "11111111-1111-4111-8111-111111111111";
const FOREIGN = "22222222-2222-4222-8222-222222222222";

describe("resource actor summary boundary", () => {
  it("keeps only requested, typed, once-per-resource rows", () => {
    const rows = [
      { resource_type: "data_source", resource_id: ID, created_by_label: "Alex Smith", created_by_status: "known", updated_by_label: "Jordan Lee", updated_by_status: "known" },
      { resource_type: "data_source", resource_id: ID, created_by_label: "Duplicate", created_by_status: "known", updated_by_label: "Duplicate", updated_by_status: "known" },
      { resource_type: "data_source", resource_id: FOREIGN, created_by_label: "Other tenant", created_by_status: "known", updated_by_label: "Other tenant", updated_by_status: "known" },
      { resource_type: "reconciliation", resource_id: ID, created_by_label: "Wrong type", created_by_status: "known", updated_by_label: "Wrong type", updated_by_status: "known" },
    ];
    expect(normalizeResourceActorSummaries(rows, "data_source", [ID])).toEqual([{
      resource_type: "data_source", resource_id: ID, created_by_label: "Alex Smith", created_by_status: "known", updated_by_label: "Jordan Lee", updated_by_status: "known",
    }]);
  });

  it("never trusts a name for unavailable or unattributed actors", () => {
    const [row] = normalizeResourceActorSummaries([{
      resource_type: "file_watcher", resource_id: ID,
      created_by_label: "spoof@example.invalid", created_by_status: "unattributed",
      updated_by_label: "<script>bad</script>", updated_by_status: "unknown",
    }], "file_watcher", [ID]);
    expect(row.created_by_label).toBe("Unattributed");
    expect(row.updated_by_label).toBe("Unknown");
  });

  it("does not expose an email or UUID stored in a profile full_name", () => {
    const rows = normalizeResourceActorSummaries([{
      resource_type: "data_source", resource_id: ID,
      created_by_label: "person@example.invalid", created_by_status: "known",
      updated_by_label: "11111111-1111-4111-8111-111111111111", updated_by_status: "known",
    }], "data_source", [ID]);
    expect(rows[0].created_by_label).toBe("Unknown");
    expect(rows[0].updated_by_label).toBe("Unknown");
    expect(rows[0].created_by_status).toBe("unknown");
    expect(rows[0].updated_by_status).toBe("unknown");
  });
});
