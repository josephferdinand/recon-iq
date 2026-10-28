import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getRuntimeEnv } from "@/lib/runtime-env.server";
import { workflowApiCors, workflowApiJson } from "@/lib/public-workflow-api.server";
import { PromotionService } from "./service.server";
import { commandSchema, uuid } from "./protocol";
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("overview"), tenantId: uuid }).strict(),
  z.object({ action: z.literal("command"), command: commandSchema }).strict(),
  z
    .object({
      action: z.literal("outcome"),
      tenantId: uuid,
      key: z.string().regex(/^[a-zA-Z0-9_-]{8,128}$/),
    })
    .strict(),
  z.object({ action: z.literal("export"), tenantId: uuid, id: uuid }).strict(),
  z
    .object({
      action: z.literal("receive"),
      tenantId: uuid,
      key: z.string().regex(/^[a-zA-Z0-9_-]{8,128}$/),
      envelope: z
        .object({
          schema_version: z.literal(1),
          payload: z.string().max(2000000),
          signature: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
    })
    .strict(),
]);
/** Session JWT API. Opaque API tokens cannot substitute for native MFA. */
export async function promotionApi(request: Request): Promise<Response> {
  const cors = workflowApiCors(request, "POST");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return workflowApiJson(405, { error: "method_not_allowed" }, cors);
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return workflowApiJson(401, { error: "session_bearer_required" }, cors);
  const url = getRuntimeEnv("SUPABASE_URL"),
    publishable = getRuntimeEnv("SUPABASE_PUBLISHABLE_KEY") ?? getRuntimeEnv("SUPABASE_ANON_KEY"),
    ref =
      getRuntimeEnv("SUPABASE_PROJECT_ID") ??
      url?.match(/^https:\/\/([a-z]{20})\.supabase\.co\/?$/)?.[1];
  if (!url || !publishable || !ref)
    return workflowApiJson(503, { error: "environment_unavailable" }, cors);
  const caller = createClient(url, publishable, {
    global: { headers: { Authorization: "Bearer " + token } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [{ data: verified, error: claimError }, { data: account, error: userError }] =
    await Promise.all([caller.auth.getClaims(token), caller.auth.getUser(token)]);
  if (
    claimError ||
    userError ||
    !verified?.claims?.sub ||
    account?.user?.id !== verified.claims.sub ||
    typeof verified.claims.exp !== "number" ||
    verified.claims.exp * 1000 <= Date.now()
  )
    return workflowApiJson(401, { error: "invalid_session" }, cors);
  let parsed: z.infer<typeof body>;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 2100000)
      return workflowApiJson(413, { error: "package_too_large" }, cors);
    parsed = body.parse(JSON.parse(text));
  } catch {
    return workflowApiJson(400, { error: "invalid_promotion_request" }, cors);
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: rate, error: rateError } = await supabaseAdmin.rpc("rate_limit_hit", {
    _key: "pdc-api:" + verified.claims.sub,
    _window_seconds: 60,
    _limit: 60,
  });
  const limit = Array.isArray(rate) ? rate[0] : rate;
  if (rateError) return workflowApiJson(503, { error: "rate_limit_unavailable" }, cors);
  if (!limit?.allowed)
    return workflowApiJson(429, { error: "rate_limit_exceeded" }, { ...cors, "retry-after": "60" });
  const service = new PromotionService(
    caller,
    supabaseAdmin,
    verified.claims.sub,
    ref,
    verified.claims,
  );
  try {
    const result =
      parsed.action === "overview"
        ? await service.overview(parsed.tenantId)
        : parsed.action === "command"
          ? await service.command(parsed.command)
          : parsed.action === "outcome"
            ? await service.outcome(parsed.tenantId, parsed.key)
            : parsed.action === "export"
              ? await service.export(parsed.tenantId, parsed.id)
              : await service.receive(parsed.tenantId, parsed.key, parsed.envelope);
    return workflowApiJson(200, { result }, cors);
  } catch (e) {
    const message = (e as Error).message;
    return workflowApiJson(
      message.startsWith("Complete current MFA")
        ? 403
        : message.startsWith("Request refused:")
          ? 409
          : message.includes("unconfirmed")
            ? 503
            : 422,
      {
        error: message.includes("unconfirmed")
          ? "promotion_outcome_unconfirmed"
          : "promotion_refused",
        message,
      },
      cors,
    );
  }
}
