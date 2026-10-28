// C2 — Daily schema backup + integrity verification.
//
// Runs at 04:00 UTC (after audit-anchor at 03:00/03:30 and retention at
// 02:00). Captures the public-schema DDL via the `dump_public_schema_ddl`
// SECURITY DEFINER function and stores a SHA-256 anchor in R2. On
// subsequent runs in the same UTC day, the dump is recomputed and
// compared — any mismatch raises a critical security_events row.
//
// R2 layout: `schema-YYYY-MM-DD.sql` (raw DDL) + `schema-YYYY-MM-DD.sha256`
// (hex digest). Object Lock on the bucket guarantees tamper resistance.

import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "node:crypto";
import { verifyCronSecret } from "@/lib/cron-auth.server";
import { writeMetric, withCronMetric } from "@/lib/observability.server";
import { getR2Binding } from "@/lib/r2-bindings.server";
import { safeErrorResponse, safeSupabaseError } from "@/lib/safe-error.server";

const PATH = "/api/public/cron/backup-verify";

type BackupResult = {
  date: string;
  bytes: number;
  sha256: string;
  outcome: "uploaded" | "verified" | "mismatch" | "skipped_no_r2";
};

async function runBackupVerify(): Promise<BackupResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const date = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabaseAdmin.rpc("dump_public_schema_ddl" as never);
  if (error) throw new Error(`schema dump failed: ${error.message}`);
  const ddl = String(data ?? "");
  const bytes = new TextEncoder().encode(ddl).byteLength;
  const sha256 = createHash("sha256").update(ddl).digest("hex");

  let r2: ReturnType<typeof getR2Binding> | null = null;
  try {
    r2 = getR2Binding("BACKUPS");
  } catch {
    r2 = null;
  }

  if (!r2) {
    await supabaseAdmin.from("security_events" as never).insert({
      event_type: "backup.skipped_no_r2",
      severity: "warning",
      context: { date, sha256, bytes },
    } as never);
    return { date, bytes, sha256, outcome: "skipped_no_r2" };
  }

  const shaKey = `schema-${date}.sha256`;
  const existing = await r2.get(shaKey);

  if (existing) {
    const existingSha = (await existing.text()).trim();
    if (existingSha === sha256) {
      await supabaseAdmin.from("security_events" as never).insert({
        event_type: "backup.schema_verified",
        severity: "info",
        context: { date, sha256, bytes },
      } as never);
      return { date, bytes, sha256, outcome: "verified" };
    }
    await supabaseAdmin.from("security_events" as never).insert({
      event_type: "backup.schema_mismatch",
      severity: "critical",
      context: { date, sha256_actual: sha256, sha256_expected: existingSha, bytes },
    } as never);
    return { date, bytes, sha256, outcome: "mismatch" };
  }

  await r2.put(`schema-${date}.sql`, ddl, {
    httpMetadata: { contentType: "application/sql" },
  });
  await r2.put(shaKey, sha256, {
    httpMetadata: { contentType: "text/plain" },
  });
  await supabaseAdmin.from("security_events" as never).insert({
    event_type: "backup.schema_verified",
    severity: "info",
    context: { date, sha256, bytes, first_run: true },
  } as never);
  return { date, bytes, sha256, outcome: "uploaded" };
}

export const Route = createFileRoute("/api/public/cron/backup-verify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const unauth = verifyCronSecret(request);
        if (unauth) return unauth;
        try {
          const result = await withCronMetric(
            "backup-verify",
            runBackupVerify,
            () => 1,
          );
          writeMetric(
            "backup.outcome",
            { outcome: result.outcome },
            { bytes: result.bytes },
          );
          return Response.json({ ok: true, ...result });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return safeErrorResponse(safeSupabaseError({ message, code: "P0001" }, { path: PATH }));
        }
      },
    },
  },
});

export { runBackupVerify };
