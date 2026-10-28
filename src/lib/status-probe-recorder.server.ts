import { z } from "zod";
import type { ProbeResult } from "@/lib/status-probe-runner.server";

const sampleSchema = z.object({
  id: z.string().uuid(), cell_key: z.string().regex(/^[a-z0-9_-]{1,64}$/),
  function_key: z.string().regex(/^[a-z0-9_.-]{1,100}$/), checked_at: z.string().datetime({ offset: true }),
  outcome: z.enum(["healthy", "degraded", "outage", "unknown"]), latency_ms: z.number().int().nonnegative().nullable(),
});
type PrivateRecorderClient = {
  rpc: (name: string, args: Record<string, unknown>) => { abortSignal: (signal: AbortSignal) => PromiseLike<{ data: unknown; error: unknown }> };
  from: (table: string) => any;
};
export class StatusProbePersistenceUnconfirmed extends Error {
  readonly sample: ProbeResult;
  constructor(sample: ProbeResult) {
    super("Probe storage was not confirmed. Preserve this exact sample ID and payload; do not infer measured health from a failed write.");
    this.name = "StatusProbePersistenceUnconfirmed"; this.sample = Object.freeze({ ...sample });
  }
}

/** Parent supplies its existing private recorder authority; this module never
 * obtains a key. One write, then exact readback. No automatic replay or new probe. */
export function createStatusProbeRecorder(client: PrivateRecorderClient): (value: ProbeResult) => Promise<void> {
  return async (value) => {
    const sample = sampleSchema.parse(value);
    try {
      await client.rpc("status_record_probe", {
        _id: sample.id, _cell_key: sample.cell_key, _function_key: sample.function_key,
        _checked_at: sample.checked_at, _outcome: sample.outcome, _latency_ms: sample.latency_ms,
        _window_start_at: null, _window_end_at: null, _healthy_seconds: null,
      }).abortSignal(AbortSignal.timeout(8_000));
    } catch { /* Readback can resolve an interrupted provider acknowledgement. */ }
    try {
      const { data, error } = await client.from("status_probe_samples")
        .select("id,cell_key,function_key,checked_at,outcome,latency_ms,window_start_at,window_end_at,healthy_seconds")
        .eq("id", sample.id).maybeSingle().abortSignal(AbortSignal.timeout(8_000));
      if (!error && data && data.id === sample.id && data.cell_key === sample.cell_key && data.function_key === sample.function_key
        && Date.parse(data.checked_at) === Date.parse(sample.checked_at) && data.outcome === sample.outcome
        && data.latency_ms === sample.latency_ms && data.window_start_at === null && data.window_end_at === null && data.healthy_seconds === null) return;
    } catch { /* No raw provider diagnostics leave this boundary. */ }
    throw new StatusProbePersistenceUnconfirmed(sample);
  };
}
