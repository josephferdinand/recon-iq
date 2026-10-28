/**
 * FIX 4.4 ingest — server function. Persists a parser_run, writes one
 * parser_messages row per Execution Report (with ordinal), and reports
 * quarantined messages in errors_count + metadata.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { parseFixStream } from "@/lib/fix44";

export const ingestFix44 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      stream: z.string().min(20).max(20_000_000),
      source_filename: z.string().max(255).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const parsed = parseFixStream(data.stream);
    const sha256 = await sha256Hex(data.stream);
    const bytesIn = new TextEncoder().encode(data.stream).length;

    const finalStatus: "succeeded" | "failed" | "partial" =
      parsed.total === 0
        ? "failed"
        : parsed.quarantined.length === 0
          ? "succeeded"
          : parsed.quarantined.length === parsed.total
            ? "failed"
            : "partial";

    const { data: run, error: runErr } = await context.supabase
      .from("parser_runs" as any)
      .insert({
        tenant_id: data.tenant_id,
        source_filename: data.source_filename ?? "fix44-stream",
        source_sha256: sha256,
        bytes_in: bytesIn,
        messages_out: parsed.execReports,
        errors_count: parsed.quarantined.length,
        status: finalStatus,
        finished_at: new Date().toISOString(),
        initiated_by: context.userId,
        metadata: {
          parser: "fix44",
          total: parsed.total,
          quarantined: parsed.quarantined.map((q) => ({ reason: q.reason })),
        } as any,
      } as any)
      .select("id")
      .single();
    if (runErr) throw new Error(runErr.message);
    const runId = (run as any).id as string;

    if (parsed.reports.length) {
      const rows = parsed.reports.map((er, i) => ({
        run_id: runId,
        tenant_id: data.tenant_id,
        ordinal: i,
        msg_type: "ExecutionReport",
        account: er.account,
        currency: null,
        amount_cents: er.lastQty != null && er.lastPx != null
          ? Math.round(er.lastQty * er.lastPx * 100)
          : null,
        reference: er.clOrdId,
        end_to_end_id: er.execId,
        description: `${er.side} ${er.symbol ?? ""} qty ${er.lastQty ?? "?"} @ ${er.lastPx ?? "?"}`,
        raw: { exec_id: er.execId, ord_status: er.ordStatus } as any,
        canonical: er as any,
      }));
      const { error: msgErr } = await context.supabase
        .from("parser_messages" as any)
        .insert(rows as any);
      if (msgErr) throw new Error(msgErr.message);
    }
    return {
      ok: finalStatus !== "failed",
      run_id: runId,
      total: parsed.total,
      exec_reports: parsed.execReports,
      quarantined: parsed.quarantined.length,
      status: finalStatus,
      sha256,
    };
  });

async function sha256Hex(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
