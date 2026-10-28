// E4 — Rate-limit bucket PK contention watcher.
// Computes p99 latency of rate_limit_buckets updates over the past hour
// and writes a `rate_limit.p99_high` security_event when it exceeds threshold.
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

const P99_THRESHOLD_MS = 50;

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export async function computeP99Latency(rows: Array<{ created_at: string | Date; updated_at: string | Date }>): Promise<number> {
  const deltas = rows
    .map((r) => new Date(r.updated_at).getTime() - new Date(r.created_at).getTime())
    .filter((d) => Number.isFinite(d) && d >= 0)
    .sort((a, b) => a - b);
  return Math.round(quantile(deltas, 0.99));
}

async function runWatcher() {
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data, error } = await (sb as any)
    .from("rate_limit_buckets")
    .select("created_at, updated_at")
    .gte("updated_at", since)
    .limit(50000);
  if (error) throw error;
  const rows = (data ?? []) as Array<{ created_at: string; updated_at: string }>;
  const p99 = await computeP99Latency(rows);
  const sample = rows.length;
  if (p99 > P99_THRESHOLD_MS) {
    await (sb as any).from("security_events").insert({
      event_type: "rate_limit.p99_high",
      severity: "warning",
      details: { p99_ms: p99, sample_count: sample, threshold_ms: P99_THRESHOLD_MS, window: "1h" } as any,
    } as any);
  }
  return { p99_ms: p99, sample_count: sample, threshold_ms: P99_THRESHOLD_MS, breached: p99 > P99_THRESHOLD_MS };
}

export const Route = createFileRoute("/api/public/cron/rate-limit-watch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyCronSecret } = await import("@/lib/cron-auth.server");
        const unauth = verifyCronSecret(request);
        if (unauth) return unauth;
        try {
          const result = await runWatcher();
          return Response.json({ ok: true, ...result });
        } catch (e) {
          console.error("[rate-limit-watch] failed", e);
          return Response.json({ ok: false, error: "internal_error" }, { status: 500 });
        }
      },
    },
  },
});
