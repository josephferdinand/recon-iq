// Cloudflare cron-trigger dispatcher.
//
// Cloudflare invokes the Worker's `scheduled(event, env, ctx)` export for
// each entry in wrangler.toml [triggers].crons; `event.cron` is the cron
// pattern string (e.g. "0 3 * * *"). We dispatch on that pattern, NOT on a
// `fetch` Request — `fetch` cron-trigger headers are a legacy thing and not
// guaranteed across Worker runtimes. The map below is the single source of
// truth wired by `src/server.ts` `scheduled()`.

import { publishAnchorToR2, runAuditAnchorWrite, verifyLatestAnchor } from "@/lib/audit-anchor.functions";
import { getR2Binding } from "@/lib/r2-bindings.server";

export type CronJob = {
  pattern: string;
  name: string;
  run: () => Promise<unknown>;
};

export const CRON_JOBS: CronJob[] = [
  {
    pattern: "0 3 * * *",
    name: "audit-anchor.write",
    run: async () => runAuditAnchorWrite(),
  },
  {
    pattern: "30 3 * * *",
    name: "audit-anchor.verify",
    run: async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      return verifyLatestAnchor(supabaseAdmin as never, getR2Binding("AUDIT_ANCHORS"));
    },
  },
];

// ----------------------------------------------------------------------
// R-2 — Cloudflare cron-trigger fragility diagnostic.
// ----------------------------------------------------------------------
// Cloudflare may drop a cron tick if the Worker is restarting at the
// scheduled minute. This helper inspects CRON_JOBS at module load
// (cold-start) and logs a warning if any job's pattern *should* have
// fired in the last 5 minutes but the Worker was just spinning up — a
// strong signal that the tick was dropped.
//
// Diagnostic only. We do NOT auto-re-fire — that's the responsibility
// of an external cron hitting /api/public/cron/... authenticated by
// SLA_CRON_HMAC (see docs/26_cron_fragility.md).

type CronField = { star: boolean; step: number; values: Set<number> };

function parseField(raw: string, min: number, max: number): CronField | null {
  // Supports: "*", "*/N", "N", "N,M,O", "A-B" (no comma-step combos beyond what we need).
  if (raw === "*") return { star: true, step: 1, values: new Set() };
  const stepMatch = /^\*\/(\d+)$/.exec(raw);
  if (stepMatch) {
    const step = Number(stepMatch[1]);
    if (!Number.isFinite(step) || step <= 0) return null;
    return { star: true, step, values: new Set() };
  }
  const values = new Set<number>();
  for (const part of raw.split(",")) {
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) {
      const lo = Number(range[1]); const hi = Number(range[2]);
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo > hi) return null;
      for (let v = lo; v <= hi; v++) values.add(v);
    } else {
      const v = Number(part);
      if (!Number.isFinite(v) || v < min || v > max) return null;
      values.add(v);
    }
  }
  return { star: false, step: 1, values };
}

function fieldMatches(f: CronField, v: number, min: number): boolean {
  if (f.star) return (v - min) % f.step === 0;
  return f.values.has(v);
}

export function patternFiresAt(pattern: string, when: Date): boolean {
  const parts = pattern.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const minute = parseField(parts[0], 0, 59);
  const hour = parseField(parts[1], 0, 23);
  const dom = parseField(parts[2], 1, 31);
  const mon = parseField(parts[3], 1, 12);
  const dow = parseField(parts[4], 0, 6);
  if (!minute || !hour || !dom || !mon || !dow) return false;
  return (
    fieldMatches(minute, when.getUTCMinutes(), 0) &&
    fieldMatches(hour, when.getUTCHours(), 0) &&
    fieldMatches(dom, when.getUTCDate(), 1) &&
    fieldMatches(mon, when.getUTCMonth() + 1, 1) &&
    fieldMatches(dow, when.getUTCDay(), 0)
  );
}

/** Returns the list of cron jobs that should have fired within `windowMinutes` before `now`. */
export function jobsLikelyMissedSince(
  jobs: ReadonlyArray<{ pattern: string; name: string }>,
  now: Date,
  windowMinutes = 5,
): Array<{ pattern: string; name: string; firedAt: string }> {
  const missed: Array<{ pattern: string; name: string; firedAt: string }> = [];
  for (let offset = 1; offset <= windowMinutes; offset++) {
    const t = new Date(now.getTime() - offset * 60_000);
    // Round to the minute boundary so we only check on-the-minute fires.
    t.setUTCSeconds(0, 0);
    for (const job of jobs) {
      if (patternFiresAt(job.pattern, t)) {
        missed.push({ pattern: job.pattern, name: job.name, firedAt: t.toISOString() });
      }
    }
  }
  return missed;
}

// Cold-start diagnostic: runs once when the module is first loaded.
// We only log; never re-fire automatically.
try {
  const missed = jobsLikelyMissedSince(CRON_JOBS, new Date(), 5);
  if (missed.length > 0) {
    console.warn(
      `[cron] cold-start detected ${missed.length} pattern(s) that should have fired in the last 5 min:`,
      missed,
      "— if this Worker just restarted, the Cloudflare tick may have been dropped. See docs/26_cron_fragility.md.",
    );
  }
} catch (e) {
  console.warn("[cron] cold-start diagnostic failed:", e instanceof Error ? e.message : String(e));
}

export async function dispatchCron(cronPattern: string): Promise<{
  ok: boolean;
  pattern: string;
  job?: string;
  result?: unknown;
  error?: string;
}> {
  const job = CRON_JOBS.find((j) => j.pattern === cronPattern);
  if (!job) {
    console.warn(`[cron] no job registered for pattern "${cronPattern}"`);
    return { ok: false, pattern: cronPattern, error: "no_job_registered" };
  }
  try {
    console.log(`[cron] ${job.name} (${cronPattern}) starting`);
    const result = await job.run();
    console.log(`[cron] ${job.name} ok`);
    return { ok: true, pattern: cronPattern, job: job.name, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[cron] ${job.name} failed:`, message);
    return { ok: false, pattern: cronPattern, job: job.name, error: message };
  }
}

// Re-export so callers can preflight binding presence in dev.
export { publishAnchorToR2 };
