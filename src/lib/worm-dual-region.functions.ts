/**
 * Phase 1 — Dual-region WORM anchor verify.
 *
 * Reads the last N audit_anchors and cross-checks that a matching
 * `event_type=audit.anchor.secondary.published` security_event exists
 * (the secondary anchor publisher writes one on every successful post).
 * Any anchor without a matching secondary event is a candidate for
 * re-publish or investigation.
 *
 * Returns a compact report the auditor UI renders.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

type AnchorRow = {
  id: string;
  anchored_at: string;
  last_audit_id: number;
  row_hash_hex: string;
  external_uri: string | null;
};

type SecondaryEvent = {
  context: { anchor_id?: string | number; row_hash_hex?: string } | null;
  created_at: string;
};

export type DualRegionAnchorStatus = "matched" | "missing_secondary" | "hash_mismatch";

export interface DualRegionAnchorRow {
  anchor_id: string;
  anchored_at: string;
  last_audit_id: number;
  primary_hash: string;
  secondary_hash: string | null;
  secondary_at: string | null;
  status: DualRegionAnchorStatus;
}

export const verifyDualRegionAnchors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ limit: z.number().int().min(1).max(365).default(30) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_platform_admin", {
      _user_id: context.userId,
    });
    if (!isAdmin) throw new Response("Forbidden", { status: 403 });

    const anchorRes = await context.supabase
      .from("audit_anchors")
      .select("id,anchored_at,last_audit_id,row_hash_hex,external_uri")
      .order("anchored_at", { ascending: false })
      .limit(data.limit);
    if (anchorRes.error) throw new Error(anchorRes.error.message);
    const anchors = (anchorRes.data ?? []) as unknown as AnchorRow[];

    const eventsRes = await context.supabase
      .from("security_events")
      .select("context,created_at")
      .in("event_type", [
        "audit.anchor.secondary.published",
        "audit.anchor.secondary.replayed",
      ])
      .order("created_at", { ascending: false })
      .limit(Math.max(200, data.limit * 4));
    if (eventsRes.error) throw new Error(eventsRes.error.message);
    const events = (eventsRes.data ?? []) as unknown as SecondaryEvent[];

    const byAnchorId = new Map<string, SecondaryEvent>();
    for (const e of events) {
      const id = e.context?.anchor_id;
      if (id != null) {
        const key = String(id);
        if (!byAnchorId.has(key)) byAnchorId.set(key, e);
      }
    }

    const rows: DualRegionAnchorRow[] = anchors.map((a) => {
      const ev = byAnchorId.get(String(a.id));
      let status: DualRegionAnchorStatus = "missing_secondary";
      let secondary_hash: string | null = null;
      let secondary_at: string | null = null;
      if (ev) {
        secondary_hash = ev.context?.row_hash_hex ?? null;
        secondary_at = ev.created_at;
        status =
          secondary_hash && secondary_hash === a.row_hash_hex
            ? "matched"
            : "hash_mismatch";
      }
      return {
        anchor_id: a.id,
        anchored_at: a.anchored_at,
        last_audit_id: a.last_audit_id,
        primary_hash: a.row_hash_hex,
        secondary_hash,
        secondary_at,
        status,
      };
    });

    const summary = {
      total: rows.length,
      matched: rows.filter((r) => r.status === "matched").length,
      missing_secondary: rows.filter((r) => r.status === "missing_secondary").length,
      hash_mismatch: rows.filter((r) => r.status === "hash_mismatch").length,
    };

    if (summary.hash_mismatch > 0) {
      await context.supabase.from("security_events").insert({
        event_type: "worm.dual_region.mismatch",
        severity: "critical",
        context: { summary },
      });
    }

    return { rows, summary, checked_at: new Date().toISOString() };
  });
