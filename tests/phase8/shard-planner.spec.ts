/**
 * Phase 8 — shard planner unit tests.
 */
import { describe, it, expect } from "vitest";
import { planShards } from "@/lib/phase8-shard-executor.functions";

describe("planShards", () => {
  it("distributes rows evenly when divisible", () => {
    const plan = planShards("hash_account_v1", 4, 1000);
    expect(plan).toHaveLength(4);
    expect(plan.map((p) => p.rows_estimate)).toEqual([250, 250, 250, 250]);
  });
  it("spreads the remainder to leading shards", () => {
    const plan = planShards("hash_account_v1", 4, 1003);
    expect(plan.map((p) => p.rows_estimate)).toEqual([251, 251, 251, 250]);
    expect(plan.reduce((a, p) => a + p.rows_estimate, 0)).toBe(1003);
  });
  it("clamps shard count between 1 and 256", () => {
    expect(planShards("x", 0, 100)).toHaveLength(1);
    expect(planShards("x", 1000, 100)).toHaveLength(256);
  });
  it("handles zero-row workload", () => {
    const plan = planShards("x", 8, 0);
    expect(plan.every((p) => p.rows_estimate === 0)).toBe(true);
  });
});
