import { describe, expect, it } from "vitest";

import { assessSeedParity } from "../scripts/verify-supabase-seed-parity.mjs";

describe("governed seed parity", () => {
  it("passes exact seeds plus an explicitly mutable operational table", () => {
    const result = assessSeedParity({
      localCounts: [{ table: "static_catalog", count: 2 }, { table: "history", count: 1 }],
      remoteCounts: [{ table: "static_catalog", count: 2 }, { table: "history", count: 5 }],
      fingerprintResults: [{ table: "static_catalog", ok: true }, { table: "history", ok: false }],
      allowlist: [{ table: "history", reason: "operational history grows" }],
    });
    expect(result.passed).toBe(true);
    expect(result.exactFingerprintTables).toBe(1);
    expect(result.allowedMismatches).toEqual(["history"]);
  });

  it("fails closed on count deficits or unknown content drift", () => {
    const result = assessSeedParity({
      localCounts: [{ table: "catalog", count: 2 }],
      remoteCounts: [{ table: "catalog", count: 1 }],
      fingerprintResults: [{ table: "catalog", ok: false }],
      allowlist: [],
    });
    expect(result.passed).toBe(false);
    expect(result.deficits).toHaveLength(1);
    expect(result.unexpectedMismatches).toEqual(["catalog"]);
  });
});
