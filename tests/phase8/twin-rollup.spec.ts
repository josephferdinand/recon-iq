/**
 * Phase 8 — digital twin status rollup.
 */
import { describe, it, expect } from "vitest";
import { rollupTwinStatus } from "@/lib/phase8-digital-twin.functions";

describe("rollupTwinStatus", () => {
  it("breached dominates", () => {
    expect(rollupTwinStatus(["ok","warning","breached"])).toBe("breached");
  });
  it("warning when no breach", () => {
    expect(rollupTwinStatus(["ok","warning","ok"])).toBe("warning");
  });
  it("ok when all ok", () => {
    expect(rollupTwinStatus(["ok","ok"])).toBe("ok");
  });
  it("unknown for empty input", () => {
    expect(rollupTwinStatus([])).toBe("unknown");
  });
  it("unknown when every node unknown", () => {
    expect(rollupTwinStatus(["unknown","unknown"])).toBe("unknown");
  });
});
