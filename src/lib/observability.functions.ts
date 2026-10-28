/**
 * Observability status probe — checks whether APM + SIEM endpoints are configured
 * and returns the current pipeline state for the setup docs page.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { emitApmSpan, emitSiemEvent, newTraceId } from "@/lib/observability.server";

export const getObservabilityStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data: isPlat } = await context.supabase.rpc("has_platform_role", {
      _user_id: context.userId, _role: "platform_admin",
    });
    if (!isPlat) throw new Error("Forbidden: platform_admin required.");

    return {
      apm: {
        configured: !!process.env.APM_ENDPOINT,
        endpoint_host: process.env.APM_ENDPOINT ? new URL(process.env.APM_ENDPOINT).host : null,
        service_name: process.env.APM_SERVICE_NAME ?? "fvi",
      },
      siem: {
        configured: !!process.env.SIEM_ENDPOINT,
        endpoint_host: process.env.SIEM_ENDPOINT ? new URL(process.env.SIEM_ENDPOINT).host : null,
      },
    };
  });

export const emitTestObservabilityEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data: isPlat } = await context.supabase.rpc("has_platform_role", {
      _user_id: context.userId, _role: "platform_admin",
    });
    if (!isPlat) throw new Error("Forbidden.");

    const trace = newTraceId();
    await emitApmSpan({
      name: "fvi.observability.test",
      duration_ms: 1,
      status: "ok",
      trace_id: trace,
      user_id: context.userId,
      attributes: { synthetic: true },
    });
    await emitSiemEvent({
      event_type: "observability.test",
      severity: "info",
      user_id: context.userId,
      action: "test.emit",
      outcome: "success",
      attributes: { trace_id: trace },
    });
    return {
      trace_id: trace,
      apm_configured: !!process.env.APM_ENDPOINT,
      siem_configured: !!process.env.SIEM_ENDPOINT,
    };
  });
