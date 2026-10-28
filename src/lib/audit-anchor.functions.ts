// Daily audit-chain anchor.
//
// Flow:
//   1. Read latest audit_log row + row_hash.
//   2. INSERT into public.audit_anchors (source of truth for tamper evidence).
//   3. PUT the same payload to the R2 bucket bound as AUDIT_ANCHORS
//      (external witness; a bucket lock retains objects for 7 years).
//   4. Emit a security_events row describing the R2 outcome.
//
// The DB row is authoritative — if the R2 PUT fails we record the failure
// but do NOT throw, so the anchor chain itself never breaks.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getR2Binding } from "@/lib/r2-bindings.server";
import { writeSecondaryAnchor } from "@/lib/audit-anchor-secondary.server";
import { getRuntimeEnv } from "@/lib/runtime-env.server";


export interface R2AnchorOutcome {
  status: "published" | "failed" | "binding_missing";
  key: string;
  error?: string;
}

// Exported for unit tests (see tests/audit-anchor-r2.spec.ts).
export async function publishAnchorToR2(
  admin: { from: (t: string) => { insert: (row: unknown) => Promise<{ error: unknown }> } },
  payload: { last_audit_id: number; row_hash_hex: string },
  bucket = getR2Binding("AUDIT_ANCHORS"),
  now: Date = new Date(),
): Promise<R2AnchorOutcome> {
  const key = `anchor-${now.toISOString().slice(0, 10)}.json`;
  const body = JSON.stringify({
    anchored_at: now.toISOString(),
    last_audit_id: payload.last_audit_id,
    row_hash_hex: payload.row_hash_hex,
  });

  if (!bucket) {
    await admin.from("security_events").insert({
      event_type: "audit.anchor.r2_binding_missing",
      severity: "critical",
      context: { last_audit_id: payload.last_audit_id, row_hash_hex: payload.row_hash_hex, key },
    });
    return { status: "binding_missing", key };
  }

  try {
    await bucket.put(key, body, {
      customMetadata: { rowHash: payload.row_hash_hex },
      httpMetadata: { contentType: "application/json" },
    });
    await admin.from("security_events").insert({
      event_type: "audit.anchor.r2_published",
      severity: "info",
      context: { last_audit_id: payload.last_audit_id, r2_key: key },
    });
    return { status: "published", key };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin.from("security_events").insert({
      event_type: "audit.anchor.r2_failed",
      severity: "critical",
      context: { last_audit_id: payload.last_audit_id, row_hash_hex: payload.row_hash_hex, error: message },
    });
    return { status: "failed", key, error: message };
  }
}

function auditHashToHex(value: ArrayBuffer | string): string {
  if (typeof value !== "string") return Buffer.from(value).toString("hex");
  const normalized = value.startsWith("\\x") ? value.slice(2) : value;
  if (/^[0-9a-f]+$/i.test(normalized) && normalized.length % 2 === 0) {
    return normalized.toLowerCase();
  }
  return Buffer.from(value, "base64").toString("hex");
}

// Core writer — callable from server fn (user-triggered), authenticated HTTP
// cron, and the CF scheduled dispatcher. The database enforces one row per
// UTC date via audit_anchors_anchor_date_uniq.
type AnchorRow = { id: number | string; anchored_at: string; last_audit_id: number; row_hash_hex: string };
export async function runAuditAnchorWrite(
  bucket = getR2Binding("AUDIT_ANCHORS"),
): Promise<
  | { anchored: false; reason: string }
  | { anchored: true; anchor: AnchorRow; r2: R2AnchorOutcome }
> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const now = new Date();
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const nextDay = new Date(dayStart.getTime() + 86_400_000);
  const { data: existing } = await supabaseAdmin
    .from("audit_anchors")
    .select("id, anchored_at, last_audit_id, row_hash_hex")
    .gte("anchored_at", dayStart.toISOString())
    .lt("anchored_at", nextDay.toISOString())
    .maybeSingle();
  if (existing) {
    const verified = await verifyLatestAnchor(supabaseAdmin as never, bucket);
    if (verified.verified) return { anchored: false, reason: "already_anchored_and_verified" };
    if (verified.reason === "missing_object") {
      const repaired = await publishAnchorToR2(
        supabaseAdmin as unknown as Parameters<typeof publishAnchorToR2>[0],
        {
          last_audit_id: existing.last_audit_id,
          row_hash_hex: existing.row_hash_hex,
        },
        bucket,
        new Date(existing.anchored_at),
      );
      return { anchored: false, reason: `existing_anchor_r2_${repaired.status}` };
    }
    return { anchored: false, reason: `existing_anchor_${verified.reason ?? "unverified"}` };
  }

  const { data: last } = await supabaseAdmin
    .from("audit_log")
    .select("id, row_hash")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!last) return { anchored: false, reason: "audit_log empty" };

  const rowHashHex = auditHashToHex((last as { row_hash: ArrayBuffer | string }).row_hash);
  const lastAuditId = (last as { id: number }).id;
  const lockUntil = new Date();
  lockUntil.setFullYear(lockUntil.getFullYear() + 7);
  const key = `anchor-${new Date().toISOString().slice(0, 10)}.json`;
  const auditBucketName = getRuntimeEnv("AUDIT_ANCHORS_BUCKET_NAME") ?? "fvi-audit-anchors";

  const { data, error } = await supabaseAdmin
    .from("audit_anchors")
    .insert({
      last_audit_id: lastAuditId,
      row_hash_hex: rowHashHex,
      external_uri: `r2://${auditBucketName}/${key}`,
      external_object_lock_until: lockUntil.toISOString(),
      notes: "Cloudflare R2 bucket lock, 7-year retention.",
    } as never)
    .select("id, anchored_at, last_audit_id, row_hash_hex")
    .single();
  if (error) throw new Error(error.message);

  const r2 = await publishAnchorToR2(
    supabaseAdmin as unknown as Parameters<typeof publishAnchorToR2>[0],
    { last_audit_id: lastAuditId, row_hash_hex: rowHashHex },
    bucket,
  );
  // C-2 — Post to secondary witness (Twitter by default). Fire-and-forget:
  // the primary DB+R2 chain is authoritative; a secondary failure must not
  // break the daily anchor.
  try {
    await writeSecondaryAnchor(
      supabaseAdmin as unknown as Parameters<typeof writeSecondaryAnchor>[0],
      {
        id: (data as { id: number | string }).id,
        anchored_at: (data as { anchored_at: string }).anchored_at,
        last_audit_id: lastAuditId,
        row_hash_hex: rowHashHex,
      },
    );
  } catch (err) {
    console.warn("[audit-anchor] secondary witness call failed", err);
  }
  return { anchored: true, anchor: data, r2 };
}

export const writeAuditAnchor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_platform_admin", {
      _user_id: context.userId,
    });
    if (!isAdmin) throw new Response("Forbidden", { status: 403 });
    try {
      return await runAuditAnchorWrite();
    } catch (err) {
      throw new Response(err instanceof Error ? err.message : String(err), { status: 500 });
    }
  });


export const listAuditAnchors = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("is_platform_admin", {
      _user_id: context.userId,
    });
    if (!isAdmin) throw new Response("Forbidden", { status: 403 });
    const { data } = await context.supabase
      .from("audit_anchors")
      .select("*")
      .order("anchored_at", { ascending: false })
      .limit(90);
    return data ?? [];
  });

// ----------------------------------------------------------------------
// R-1 — verifyLatestAnchor
// ----------------------------------------------------------------------
// Compares the most-recent audit_anchors row (DB witness) against the
// matching R2 object's customMetadata.rowHash (external witness).
// Writes a security_events row: severity=info on match, severity=critical
// on any mismatch / missing-object / missing-binding condition.
// Returns { verified: boolean, lastVerifiedAt: ISO-8601 string }.

type AdminLike = {
  from: (t: string) => {
    select: (c: string) => {
      order: (col: string, opts: { ascending: boolean }) => {
        limit: (n: number) => { maybeSingle: () => Promise<{ data: unknown }> };
      };
    };
    insert: (row: unknown) => Promise<{ error: unknown }>;
  };
};

type R2BucketLike = {
  get: (key: string) => Promise<{ customMetadata?: Record<string, string> } | null>;
};

export interface VerifyAnchorResult {
  verified: boolean;
  lastVerifiedAt: string;
  reason?: string;
  key?: string;
}

export async function verifyLatestAnchor(
  admin: AdminLike,
  bucket: R2BucketLike | null | undefined,
): Promise<VerifyAnchorResult> {
  const lastVerifiedAt = new Date().toISOString();

  const { data } = await admin
    .from("audit_anchors")
      .select("id, anchored_at, last_audit_id, row_hash_hex, external_uri")
    .order("anchored_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const anchor = data as
    | { id: string; anchored_at?: string; last_audit_id: number; row_hash_hex: string; external_uri?: string | null }
    | null;

  if (!anchor) {
    await admin.from("security_events").insert({
      event_type: "audit.anchor.verify.error",
      severity: "warning",
      context: { reason: "no_anchors" },
    });
    return { verified: false, lastVerifiedAt, reason: "no_anchors" };
  }

  const key = anchor.external_uri
    ? anchor.external_uri.replace(/^r2:\/\/[^/]+\//, "")
    : `anchor-${String(anchor.anchored_at ?? lastVerifiedAt).slice(0, 10)}.json`;

  if (!bucket) {
    await admin.from("security_events").insert({
      event_type: "audit.anchor.verify.mismatch",
      severity: "critical",
      context: { reason: "binding_missing", anchor_id: anchor.id, key },
    });
    return { verified: false, lastVerifiedAt, reason: "binding_missing", key };
  }

  const obj = await bucket.get(key);
  if (!obj) {
    await admin.from("security_events").insert({
      event_type: "audit.anchor.verify.mismatch",
      severity: "critical",
      context: { reason: "missing_object", anchor_id: anchor.id, key },
    });
    return { verified: false, lastVerifiedAt, reason: "missing_object", key };
  }

  const r2Hash = obj.customMetadata?.rowHash ?? "";
  if (r2Hash === anchor.row_hash_hex) {
    await admin.from("security_events").insert({
      event_type: "audit.anchor.verify.ok",
      severity: "info",
      context: { anchor_id: anchor.id, key },
    });
    return { verified: true, lastVerifiedAt, key };
  }

  await admin.from("security_events").insert({
    event_type: "audit.anchor.verify.mismatch",
    severity: "critical",
    context: {
      reason: "hash_mismatch",
      anchor_id: anchor.id,
      key,
      db_hash: anchor.row_hash_hex,
      r2_hash: r2Hash,
    },
  });
  return { verified: false, lastVerifiedAt, reason: "hash_mismatch", key };
}
