import { describe, it, expect, vi } from "vitest";
import { createStatusProbeRecorder, StatusProbePersistenceUnconfirmed } from "@/lib/status-probe-recorder.server";
const sample = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", cell_key: "fixture-prod", function_key: "reconciliation.read", checked_at: "2026-10-04T00:00:00.000Z", outcome: "healthy" as const, latency_ms: 12 };
const stored = { ...sample, checked_at: "2026-10-04T00:00:00+00:00", window_start_at: null, window_end_at: null, healthy_seconds: null };
function client(row: unknown, failWrite = false, readError: unknown = null) {
  const query: any = { select: vi.fn(() => query), eq: vi.fn(() => query), maybeSingle: vi.fn(() => query), abortSignal: async () => ({ data: row, error: readError }) };
  return { rpc: vi.fn(() => ({ abortSignal: async () => { if (failWrite) throw Error("private credentials and diagnostics"); return { data: true, error: null }; } })), from: vi.fn(() => query), query };
}
describe("private fixed-purpose probe persistence", () => {
  it("requires exact durable readback and never invents measured windows or saves extra input", async () => {
    const db = client(stored); await createStatusProbeRecorder(db)({ ...sample, raw_diagnostics: "private" } as any);
    expect(db.rpc).toHaveBeenCalledWith("status_record_probe", { _id: sample.id, _cell_key: sample.cell_key, _function_key: sample.function_key, _checked_at: sample.checked_at, _outcome: "healthy", _latency_ms: 12, _window_start_at: null, _window_end_at: null, _healthy_seconds: null });
    expect(db.from).toHaveBeenCalledWith("status_probe_samples"); expect(db.query.eq).toHaveBeenCalledWith("id", sample.id);
  });
  it("resolves a lost write acknowledgement through existing sample readback without replay", async () => {
    const db = client(stored, true); await createStatusProbeRecorder(db)(sample); expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it("does not claim persistence after accepted RPC with absent, mismatched or timed-out readback", async () => {
    for (const db of [client(null), client({ ...stored, outcome: "outage" }), client(stored, false, { message: "private" }), client({ ...stored, healthy_seconds: 20 })]) {
      await expect(createStatusProbeRecorder(db)(sample)).rejects.toBeInstanceOf(StatusProbePersistenceUnconfirmed); expect(db.rpc).toHaveBeenCalledTimes(1);
    }
  });
  it("preserves only the exact safe frozen retry sample after uncertainty", async () => {
    const db = client(null, true); try { await createStatusProbeRecorder(db)(sample); throw Error("expected failure"); } catch (error) {
      expect(error).toBeInstanceOf(StatusProbePersistenceUnconfirmed); expect((error as StatusProbePersistenceUnconfirmed).sample).toEqual(sample);
      expect(Object.isFrozen((error as StatusProbePersistenceUnconfirmed).sample)).toBe(true); expect((error as Error).message).not.toContain("credentials");
    }
  });
});
