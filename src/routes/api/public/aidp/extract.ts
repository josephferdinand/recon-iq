/**
 * AIDP Slice 4 — public API endpoint
 *   POST /api/public/aidp/extract
 *
 * Auth: bearer in `x-aidp-token` (preferred) or `Authorization: Bearer ...`.
 * Token must exist in api_tokens with scope 'aidp:extract'.
 *
 * Body: { document_type_code, file_url, callback_url? }
 * Returns: { api_version, document_id, prediction_id, auto_accepted_count, pending_review_count, fields[] }
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHash, randomUUID } from "node:crypto";
import { safeSupabaseError } from "@/lib/safe-error.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertSafeOutboundUrl } from "@/lib/ssrf-guard.server";

const PATH = "/api/public/aidp/extract";

const MAX_BYTES = 50 * 1024 * 1024; // 50MB
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_HOST_ALLOWLIST = new Set([
  "s3.amazonaws.com",
  "blob.core.windows.net",
  "storage.googleapis.com",
]);
const ALLOWED_CONTENT_TYPES = new Set(["application/pdf", "image/png", "image/jpeg"]);
const EXT_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
};

function json(status: number, body: unknown, extra?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json", ...(extra ?? {}) },
  });
}

// S-5 — file_url path normalization and traversal defense.
// Exported for unit tests. Returns a normalized URL when safe; otherwise an
// error string the route emits as `{ error: <reason> }`.
export function validateFileUrl(input: string): { ok: true; url: URL } | { ok: false; error: string } {
  let url: URL;
  try { url = new URL(input); } catch { return { ok: false, error: "invalid_file_url" }; }
  if (url.protocol !== "https:") return { ok: false, error: "file_url_must_be_https" };

  const rawPath = input.split("?")[0].split("#")[0];
  let decodedRaw = rawPath;
  try { decodedRaw = decodeURIComponent(rawPath); } catch { /* keep raw */ }
  const TRAVERSAL = /(^|\/)\.\.(\/|$)/;
  if (TRAVERSAL.test(rawPath) || TRAVERSAL.test(decodedRaw)) {
    return { ok: false, error: "path_traversal" };
  }

  // URL.pathname normalization collapses dot segments. Reparse using the
  // normalized pathname, then re-check the host so a normalized URL can never
  // drift into another authority while retaining the original allow-list check.
  url.pathname = new URL(url.toString()).pathname;
  const normalized = new URL(url.toString());
  let decodedNormalizedPath = normalized.pathname;
  try { decodedNormalizedPath = decodeURIComponent(normalized.pathname); } catch { /* keep normalized */ }
  if (normalized.pathname.includes("..") || decodedNormalizedPath.includes("..")) {
    return { ok: false, error: "path_traversal" };
  }
  if (normalized.hostname !== url.hostname) return { ok: false, error: "path_traversal" };
  return { ok: true, url: normalized };
}

// Local variant of the ssrf-guard safeFetch pattern (manual redirects,
// per-hop re-validation, 30s timeout). safeFetch itself caps bodies at 5MB
// via the Content-Length header only and returns before the body is read, so
// it cannot enforce this route's 50MB limit; here the timeout spans the body
// read and bytes are counted as chunks arrive, aborting over the cap.
// Exported for unit tests.
export async function fetchFileBytes(
  startUrl: URL,
  allowedHosts: Set<string>,
): Promise<
  | { ok: true; buf: Uint8Array; contentType: string }
  | { ok: false; status: number; body: Record<string, unknown> }
> {
  const fail = (status: number, body: Record<string, unknown>) =>
    ({ ok: false as const, status, body });
  let current = startUrl;
  for (let hop = 0; ; hop++) {
    if (current.protocol !== "https:") return fail(400, { error: "file_url_must_be_https" });
    try { assertSafeOutboundUrl(current.toString()); }
    catch { return fail(400, { error: "file_host_not_allowed", host: current.hostname }); }
    const hostOk = [...allowedHosts].some(
      (h) => current.hostname === h || current.hostname.endsWith("." + h),
    );
    if (!hostOk) return fail(400, { error: "file_host_not_allowed", host: current.hostname });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(current.toString(), {
        method: "GET", redirect: "manual", signal: controller.signal,
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        await res.body?.cancel().catch(() => {});
        if (!loc) return fail(400, { error: "file_fetch_failed", status: res.status });
        if (hop >= MAX_REDIRECTS) return fail(400, { error: "file_fetch_failed", detail: "too_many_redirects" });
        try { current = new URL(loc, current); }
        catch { return fail(400, { error: "file_fetch_failed", detail: "invalid_redirect" }); }
        continue;
      }
      if (!res.ok) return fail(400, { error: "file_fetch_failed", status: res.status });
      const contentType = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
        await res.body?.cancel().catch(() => {});
        return fail(400, { error: "unsupported_content_type", got: contentType });
      }
      const len = Number(res.headers.get("content-length") || "0");
      if (len && len > MAX_BYTES) {
        await res.body?.cancel().catch(() => {});
        return fail(413, { error: "file_too_large" });
      }
      if (!res.body) return { ok: true, buf: new Uint8Array(0), contentType };
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > MAX_BYTES) {
          await reader.cancel().catch(() => {});
          controller.abort();
          return fail(413, { error: "file_too_large" });
        }
        chunks.push(value);
      }
      const buf = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { buf.set(chunk, offset); offset += chunk.byteLength; }
      return { ok: true, buf, contentType };
    } catch (e: any) {
      return fail(400, { error: "file_fetch_failed", detail: String(e?.message || e) });
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const Route = createFileRoute("/api/public/aidp/extract")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let phase = "authentication";
        try {
        // ---- 1. Bearer token ----
        const headerToken =
          request.headers.get("x-aidp-token") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
        if (!headerToken) return json(401, { error: "missing_bearer" });
        const tokenHash = createHash("sha256").update(headerToken).digest("hex");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const queueClient = supabaseAdmin as unknown as SupabaseClient;

        const { data: tok } = await supabaseAdmin.from("api_tokens")
          .select("id, tenant_id, scopes, expires_at, revoked_at")
          .eq("token_hash", tokenHash).maybeSingle();
        if (!tok) return json(401, { error: "invalid_token" });
        if (tok.revoked_at) return json(401, { error: "token_revoked" });
        if (tok.expires_at && new Date(tok.expires_at).getTime() < Date.now())
          return json(401, { error: "token_expired" });
        const scopes: string[] = Array.isArray(tok.scopes) ? tok.scopes : [];
        if (!scopes.includes("aidp:extract") && !scopes.includes("*"))
          return json(403, { error: "missing_scope", required: "aidp:extract" });

        const tenant_id = tok.tenant_id as string;

        // ---- 1b. Idempotency-Key: return prior response if same key was used ----
        phase = "idempotency";
        const idemKey = (request.headers.get("idempotency-key") || "").trim() || null;
        if (idemKey && idemKey.length > 200) return json(400, { error: "idempotency_key_too_long" });
        if (idemKey) {
          const { data: priorJob, error: priorJobError } = await queueClient
            .from("aidp_api_jobs")
            .select("id,status,document_id,prediction_id,response,last_error")
            .eq("tenant_id", tenant_id)
            .eq("idempotency_key", idemKey)
            .maybeSingle();
          if (priorJobError) {
            const safe = safeSupabaseError(priorJobError, { tenantId: tenant_id, path: PATH });
            return json(safe.status, safe.body);
          }
          if (priorJob) {
            const complete = priorJob.status === "succeeded" && priorJob.response;
            return json(complete ? 200 : 202, complete ? {
              ...(priorJob.response as Record<string, unknown>),
              idempotent_replay: true,
            } : {
              api_version: "v1",
              job_id: priorJob.id,
              document_id: priorJob.document_id,
              status: priorJob.status,
              error: priorJob.status === "failed" || priorJob.status === "dead" ? priorJob.last_error : undefined,
              idempotent_replay: true,
            }, {
              "idempotent-replay": "true",
              location: `/api/public/aidp/jobs/${priorJob.id}`,
              ...(complete ? {} : { "retry-after": "2" }),
            });
          }

          const { data: priorDoc } = await supabaseAdmin.from("aidp_documents")
            .select("id").eq("tenant_id", tenant_id).eq("idempotency_key", idemKey).maybeSingle();
          if (priorDoc) {
            const { data: priorPred } = await supabaseAdmin.from("aidp_predictions")
              .select("id").eq("tenant_id", tenant_id).eq("document_id", (priorDoc as any).id)
              .order("created_at", { ascending: false }).limit(1).maybeSingle();
            if (priorPred) {
              const { data: fields } = await supabaseAdmin.from("aidp_prediction_fields")
                .select(`
                  id, entity_type_id, confidence, bbox, accepted_at, rejected_at,
                  value_text, value_number, value_date, value_json,
                  aidp_entity_types ( key, label, datatype, review_policy )
                `).eq("prediction_id", (priorPred as any).id);
              const rows = fields ?? [];
              const flat = rows.map((f: any) => ({
                field_id: f.id, key: f.aidp_entity_types?.key,
                label: f.aidp_entity_types?.label, datatype: f.aidp_entity_types?.datatype,
                confidence: f.confidence,
                value: f.value_text ?? f.value_number ?? f.value_date ?? f.value_json,
                bbox: f.bbox,
              }));
              return json(200, {
                api_version: "v1",
                document_id: (priorDoc as any).id,
                prediction_id: (priorPred as any).id,
                auto_accepted_count: rows.filter((r: any) => r.accepted_at).length,
                pending_review_count: rows.filter((r: any) => !r.accepted_at && !r.rejected_at).length,
                fields: flat,
                idempotent_replay: true,
              }, { "idempotent-replay": "true" });
            }
          }
        }

        // ---- 2. Quota check ----
        phase = "quota";
        const { data: quota, error: qErr } = await supabaseAdmin
          .rpc("aidp_api_quota_hit", { _tenant_id: tenant_id });
        if (qErr) { const s = safeSupabaseError(qErr, { tenantId: tenant_id, path: PATH }); return json(s.status, s.body); }
        const allowed = (quota as any)?.allowed ?? true;
        if (!allowed) {
          const retry = (quota as any)?.retry_after_seconds ?? 3600;
          return json(429, { error: "quota_exceeded", retry_after_seconds: retry },
            { "retry-after": String(retry) });
        }

        // ---- 3. Body validation ----
        phase = "request_validation";
        let body: any;
        try { body = await request.json(); }
        catch { return json(400, { error: "invalid_json" }); }
        const document_type_code = String(body?.document_type_code ?? "");
        const file_url = String(body?.file_url ?? "");
        const callback_url = body?.callback_url ? String(body.callback_url) : null;
        if (!document_type_code) return json(400, { error: "missing_document_type_code" });
        if (!file_url) return json(400, { error: "missing_file_url" });

        const validatedFileUrl = validateFileUrl(file_url);
        if (!validatedFileUrl.ok) return json(400, { error: validatedFileUrl.error });
        const url = validatedFileUrl.url;
        const normalized = validatedFileUrl.url;

        // Host allow-list: tenant overrides ∪ default safe set
        const { data: customHosts } = await supabaseAdmin
          .from("aidp_api_host_allowlist")
          .select("host").eq("tenant_id", tenant_id);
        const allowed_hosts = new Set<string>([
          ...DEFAULT_HOST_ALLOWLIST,
          ...((customHosts ?? []).map((r: any) => String(r.host).toLowerCase())),
        ]);
        const hostOk = [...allowed_hosts].some(h => normalized.hostname === h || normalized.hostname.endsWith("." + h));
        if (!hostOk) return json(400, { error: "file_host_not_allowed", host: normalized.hostname });
        try { assertSafeOutboundUrl(normalized.toString()); }
        catch { return json(400, { error: "file_host_not_allowed", host: normalized.hostname }); }

        if (callback_url) {
          try {
            const cb = new URL(callback_url);
            if (cb.protocol !== "https:") return json(400, { error: "callback_url_must_be_https" });
            await assertSafeOutboundUrl(cb.toString());
          } catch { return json(400, { error: "invalid_callback_url" }); }
        }

        // ---- 4. Document type resolution ----
        phase = "document_type";
        const { data: docType, error: docTypeError } = await supabaseAdmin
          .from("aidp_document_types")
          .select("id, code").eq("tenant_id", tenant_id).eq("code", document_type_code).maybeSingle();
        if (docTypeError) {
          console.error("[aidp.extract] document type lookup rejected", {
            phase,
            name: docTypeError.name,
            code: docTypeError.code,
          });
          const safe = safeSupabaseError(docTypeError, { tenantId: tenant_id, path: PATH });
          return json(safe.status, safe.body);
        }
        if (!docType) return json(400, { error: "unknown_document_type_code" });

        // ---- 5. Fetch + validate file ----
        phase = "source_fetch";
        const fetched = await fetchFileBytes(url, allowed_hosts);
        if (!fetched.ok) return json(fetched.status, fetched.body);
        const { buf, contentType } = fetched;

        // ---- 6. Upload to storage ----
        phase = "storage_upload";
        const docId = randomUUID();
        const ext = EXT_BY_MIME[contentType];
        const storagePath = `${tenant_id}/${docId}/source.${ext}`;
        const up = await supabaseAdmin.storage.from("aidp")
          .upload(storagePath, buf, { contentType, upsert: false });
        if (up.error) {
          console.error("[aidp.extract] storage upload rejected", {
            phase,
            name: up.error.name,
            status: "status" in up.error ? up.error.status : undefined,
          });
          const s = safeSupabaseError(up.error, { tenantId: tenant_id, path: PATH });
          return json(s.status, s.body);
        }

        // ---- 7. Insert aidp_documents ----
        phase = "document_insert";
        const docInsert: any = {
          id: docId,
          tenant_id,
          document_type_id: (docType as any).id,
          original_filename: url.pathname.split("/").pop() || `${docId}.${ext}`,
          mime: contentType,
          bytes: buf.byteLength,
          status: "extracting",
          extraction: { storage_path: storagePath, source: "public_api" },
        };
        if (idemKey) docInsert.idempotency_key = idemKey;
        const { data: docRow, error: insErr } = await supabaseAdmin
          .from("aidp_documents").insert(docInsert).select("id").single();
        if (insErr || !docRow) {
          console.error("[aidp.extract] document insert rejected", {
            phase,
            name: insErr?.name ?? "NoRow",
            code: insErr?.code,
          });
          // Cleanup orphan upload so storage stays idempotent on retry.
          await supabaseAdmin.storage.from("aidp").remove([storagePath]).catch(() => {});
          const s = safeSupabaseError(insErr ?? { message: "no_row" }, { tenantId: tenant_id, path: PATH });
          return json(s.status, s.body);
        }

        // ---- 8. Enqueue provider work and return immediately ----
        phase = "queue_insert";
        const { data: job, error: jobError } = await queueClient.from("aidp_api_jobs").insert({
          tenant_id,
          token_id: tok.id,
          document_id: docId,
          idempotency_key: idemKey,
          callback_url,
          status: "queued",
        }).select("id,status").single();
        if (jobError || !job) {
          console.error("[aidp.extract] queue insert rejected", {
            phase,
            name: jobError?.name ?? "NoRow",
            code: jobError?.code,
          });
          await supabaseAdmin.from("aidp_documents").delete().eq("id", docId);
          await supabaseAdmin.storage.from("aidp").remove([storagePath]).catch(() => undefined);
          const safe = safeSupabaseError(jobError ?? { message: "job_not_created" }, { tenantId: tenant_id, path: PATH });
          return json(safe.status, safe.body);
        }

        await supabaseAdmin.from("audit_log").insert({
          tenant_id,
          scope: "tenant",
          action: "aidp.api.enqueued",
          resource_type: "aidp_api_jobs",
          resource_id: job.id,
          context: { document_id: docId, token_id: tok.id, idempotent: Boolean(idemKey) },
        } as never);

        return json(202, {
          api_version: "v1",
          job_id: job.id,
          document_id: docId,
          status: job.status,
        }, {
          location: `/api/public/aidp/jobs/${job.id}`,
          "retry-after": "2",
        });
        } catch (error) {
          console.error("[aidp.extract] unhandled failure", {
            phase,
            name: error instanceof Error ? error.name : "Error",
          });
          return json(500, { error: "internal_processing_error", phase });
        }
      },
    },
  },
});
