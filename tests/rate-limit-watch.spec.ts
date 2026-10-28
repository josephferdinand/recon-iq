// E4 — Rate-limit bucket PK contention watcher.
import { describe, it, expect } from "vitest";
import { computeP99Latency } from "@/routes/api/public/cron/rate-limit-watch";

describe("rate-limit-watch p99", () => {
  it("p99 above 50ms triggers warning intent", async () => {
    const now = Date.now();
    const rows = Array.from({ length: 200 }, (_, i) => {
      const lag = i < 195 ? 5 : 250; // 99th percentile is in the slow tail
      return { created_at: new Date(now - lag).toISOString(), updated_at: new Date(now).toISOString() };
    });
    const p99 = await computeP99Latency(rows);
    expect(p99).toBeGreaterThan(50);
  });
});
