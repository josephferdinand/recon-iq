import { createHash } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";

function json(status: number, body: unknown, headers?: Record<string, string>) {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...(headers ?? {}) } });
}

export const Route = createFileRoute("/api/public/aidp/jobs/$jobId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const raw = request.headers.get("x-aidp-token")
          ?? request.headers.get("authorization")?.replace(/^Bearer\s+/iu, "")
          ?? "";
        if (!raw) return json(401, { error: "missing_bearer" });
        const tokenHash = createHash("sha256").update(raw).digest("hex");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const sb = supabaseAdmin as unknown as SupabaseClient;
        const { data: token } = await supabaseAdmin.from("api_tokens")
          .select("id,tenant_id,scopes,expires_at,revoked_at")
          .eq("token_hash", tokenHash).maybeSingle();
        if (!token || token.revoked_at) return json(401, { error: "invalid_token" });
        if (token.expires_at && Date.parse(token.expires_at) < Date.now()) return json(401, { error: "token_expired" });
        const scopes = Array.isArray(token.scopes) ? token.scopes : [];
        if (!scopes.includes("aidp:extract") && !scopes.includes("*")) {
          return json(403, { error: "missing_scope", required: "aidp:extract" });
        }

        const { data: job, error } = await sb.from("aidp_api_jobs")
          .select("id,tenant_id,token_id,document_id,prediction_id,status,attempts,max_attempts,response,created_at,updated_at,completed_at")
          .eq("id", params.jobId)
          .eq("tenant_id", token.tenant_id)
          .maybeSingle();
        if (error) return json(500, { error: "job_lookup_failed" });
        if (!job) return json(404, { error: "job_not_found" });
        if (job.status === "succeeded" && job.response) return json(200, job.response);
        const processing = job.status === "queued" || job.status === "running";
        return json(200, {
          api_version: "v1",
          job_id: job.id,
          document_id: job.document_id,
          prediction_id: job.prediction_id,
          status: job.status,
          attempts: job.attempts,
          max_attempts: job.max_attempts,
          created_at: job.created_at,
          updated_at: job.updated_at,
          completed_at: job.completed_at,
          ...(job.status === "failed" || job.status === "dead" ? { error: "processing_failed" } : {}),
        }, processing ? { "retry-after": "2" } : undefined);
      },
    },
  },
});
