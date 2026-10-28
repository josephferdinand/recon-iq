/**
 * Native parser server functions — routes raw statement content into the
 * SWIFT MT or ISO 20022 parser, persists results to `parser_runs` and
 * `parser_messages`, and dedupes by SHA-256 of the source bytes.
 *
 * Step 2 of Data & Connectivity v2.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

import { parseISO20022, iso20022ToRows } from "@/lib/iso20022";
import { parseSwiftMT, swiftMTToRows } from "@/lib/swift-mt";
import type { Database, Json } from "@/integrations/supabase/types";

type DetectedKind = "iso20022_camt" | "swift_mt" | "unknown";
type ParserMessageInsert = Database["public"]["Tables"]["parser_messages"]["Insert"];

function detectKind(content: string): DetectedKind {
  const head = content.slice(0, 2048).trim();
  if (
    head.startsWith("<?xml") ||
    /<Document\b/i.test(head) ||
    /BkToCstmr(?:Stmt|DbtCdtNtfctn|AcctRpt)/i.test(head)
  ) {
    return "iso20022_camt";
  }
  if (/(^|\n):20:/.test(head) && /(^|\n):2[58]/.test(head)) return "swift_mt";
  return "unknown";
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const ParseInput = z.object({
  tenant_id: z.string().uuid(),
  filename: z.string().max(512).optional(),
  content: z.string().min(1).max(10_000_000),
});

export const parseStatementFile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => ParseInput.parse(d))
  .handler(async ({ data, context }) => {
    // Caller must be a member of the tenant.
    const { data: member } = await context.supabase
      .from("tenant_members")
      .select("user_id")
      .eq("tenant_id", data.tenant_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!member) throw new Error("Forbidden: not a tenant member");

    const kind = detectKind(data.content);
    if (kind === "unknown") {
      throw new Error(
        "Unrecognized format. Expected ISO 20022 CAMT XML or a SWIFT MT940/MT942 message.",
      );
    }

    const sha = await sha256Hex(data.content);
    const bytesIn = new TextEncoder().encode(data.content).byteLength;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Dedup: if this exact file already parsed for this tenant, return it.
    const { data: existing } = await supabaseAdmin
      .from("parser_runs")
      .select("id, status, messages_out, errors_count, started_at, finished_at")
      .eq("tenant_id", data.tenant_id)
      .eq("source_sha256", sha)
      .eq("status", "succeeded")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      return {
        deduped: true,
        run_id: existing.id,
        kind,
        sha256: sha,
        messages_out: existing.messages_out,
        errors_count: existing.errors_count,
        status: existing.status,
      };
    }

    // Resolve (or lazily seed) the canonical platform parser definition.
    const defKind = kind === "iso20022_camt" ? "iso20022_camt053" : "swift_mt940";
    const { data: def } = await supabaseAdmin
      .from("parser_definitions")
      .select("id")
      .eq("tenant_id", data.tenant_id)
      .eq("kind", defKind)
      .eq("enabled", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    let definitionId: string | null = def?.id ?? null;
    if (!definitionId) {
      const { data: created, error: defErr } = await supabaseAdmin
        .from("parser_definitions")
        .insert({
          tenant_id: data.tenant_id,
          kind: defKind,
          name: kind === "iso20022_camt" ? "ISO 20022 camt.053 (default)" : "SWIFT MT940 (default)",
          version: 1,
          enabled: true,
          canonical_schema: {
            fields: [
              "account",
              "booking_date",
              "value_date",
              "amount",
              "currency",
              "side",
              "reference",
              "end_to_end_id",
              "counterparty",
              "description",
            ],
          },
        } as any)
        .select("id")
        .single();
      if (defErr) throw new Error(defErr.message);
      definitionId = created.id;
    }

    // Create the run row up front so failures still leave a trail.
    const { data: run, error: runErr } = await supabaseAdmin
      .from("parser_runs")
      .insert({
        tenant_id: data.tenant_id,
        definition_id: definitionId,
        source_filename: data.filename ?? null,
        source_sha256: sha,
        bytes_in: bytesIn,
        status: "running",
        initiated_by: context.userId,
        metadata: { kind },
      } as any)
      .select("id")
      .single();
    if (runErr) throw new Error(runErr.message);
    const runId = run.id;

    let rows: Record<string, unknown>[] = [];
    let parsedMeta: Record<string, string | number | null> = {};
    let msgType: string | null = null;
    try {
      if (kind === "iso20022_camt") {
        const stmt = parseISO20022(data.content);
        rows = iso20022ToRows(stmt);
        msgType = "camt.053";
        parsedMeta = {
          msg_id: stmt.msgId,
          account: stmt.account,
          currency: stmt.currency,
          opening_balance: stmt.openingBalance,
          closing_balance: stmt.closingBalance,
        };
      } else {
        const stmt = parseSwiftMT(data.content);
        rows = swiftMTToRows(stmt);
        msgType = stmt.type;
        parsedMeta = {
          transaction_reference: stmt.transactionReference,
          account: stmt.account,
          statement_number: stmt.statementNumber,
          currency: stmt.currency,
          opening_balance: stmt.openingBalance,
          closing_balance: stmt.closingBalance,
        };
      }
      // Persist canonical messages in batches.
      const BATCH = 500;
      for (let i = 0; i < rows.length; i += BATCH) {
        const slice: ParserMessageInsert[] = rows.slice(i, i + BATCH).map((r, j) => ({
          tenant_id: data.tenant_id,
          run_id: runId,
          ordinal: i + j,
          msg_type: msgType,
          account: (r.account as string) ?? null,
          booking_date: (r.booking_date as string) ?? null,
          value_date: (r.value_date as string) ?? null,
          amount_cents: typeof r.amount === "number" ? Math.round(r.amount * 100) : null,
          currency: (r.currency as string) ?? null,
          debit_credit: (r.side as string) ?? null,
          counterparty: (r.counterparty as string) ?? null,
          reference: (r.reference as string) ?? null,
          end_to_end_id: (r.end_to_end_id as string) ?? null,
          description: (r.description as string) ?? null,
          raw: r as Json,
          canonical: r as Json,
        }));
        const { error: msgErr } = await supabaseAdmin.from("parser_messages").insert(slice);
        if (msgErr) throw new Error(msgErr.message);
      }

      const { error: finishErr } = await supabaseAdmin
        .from("parser_runs")
        .update({
          status: "succeeded",
          finished_at: new Date().toISOString(),
          messages_out: rows.length,
          errors_count: 0,
          metadata: { kind, ...parsedMeta },
        })
        .eq("id", runId);
      if (finishErr) throw new Error(finishErr.message);
    } catch (e: any) {
      // A partially persisted run is not usable recon input. Remove its
      // messages and retain the failed run itself as the audit trail.
      await supabaseAdmin.from("parser_messages").delete().eq("run_id", runId);
      await supabaseAdmin
        .from("parser_runs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          messages_out: 0,
          errors_count: 1,
          error_summary: String(e?.message ?? e).slice(0, 1000),
        })
        .eq("id", runId);
      throw new Error(`Parser failed: ${e?.message ?? e}`);
    }

    return {
      deduped: false,
      run_id: runId,
      kind,
      sha256: sha,
      messages_out: rows.length,
      errors_count: 0,
      status: "succeeded",
      summary: parsedMeta,
    };
  });

const ListInput = z.object({
  tenant_id: z.string().uuid(),
  limit: z.number().int().min(1).max(100).default(25),
});

export const listParserRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => ListInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("parser_runs")
      .select(
        "id, source_filename, source_sha256, bytes_in, messages_out, errors_count, status, started_at, finished_at, metadata",
      )
      .eq("tenant_id", data.tenant_id)
      .order("started_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
