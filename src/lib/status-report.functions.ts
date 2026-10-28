import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
export const submitStatusIncidentReport = createServerFn({ method: "POST" })
 .middleware([requireSupabaseAuth()])
 .validator((value) => z.object({ request_id: z.string().uuid(), tenant_id: z.string().uuid(), summary: z.string().trim().min(8).max(2000),
   cell_keys: z.array(z.string()).min(1).max(50), component_keys: z.array(z.string()).min(1).max(40) }).parse(value))
 .handler(async ({ data, context }) => {
   const { data: id, error } = await (context.supabase as any).rpc("status_report_incident", { _request_id: data.request_id, _tenant_id: data.tenant_id,
     _summary: data.summary, _cell_keys: data.cell_keys, _component_keys: data.component_keys }).abortSignal(AbortSignal.timeout(8_000));
   if (error) throw new Error(error.code === "42501" ? "Current access to this tenant is required to report an incident." : "We could not confirm this report. Refresh or retry the exact request with its saved key; do not create a duplicate.");
   return { id: z.string().uuid().parse(id), state: "private_platform_intake" as const };
 });
export const triageStatusIncidentReport = createServerFn({ method: "POST" })
 .middleware([requireSupabaseAuth()])
 .validator((value) => z.object({ report_id: z.string().uuid(), expected_event_id: z.number().int().nullable(), action: z.enum(["linked", "declined"]), incident_id: z.string().uuid().nullable(), reason: z.string().trim().min(8).max(800) }).parse(value))
 .handler(async ({ data, context }) => {
   const { data: isAdmin, error: roleError } = await context.supabase.rpc("is_platform_admin", { _user_id: context.userId });
   if (roleError || isAdmin !== true) throw new Error("Current platform status administrator access is required.");
   const { data: eventId, error } = await (context.supabase as any).rpc("status_report_triage", { _report_id: data.report_id, _expected_event_id: data.expected_event_id,
     _action: data.action, _incident_id: data.incident_id, _reason: data.reason }).abortSignal(AbortSignal.timeout(8_000));
   if (error) throw new Error(error.code === "PT409" ? "This report decision changed. Refresh the report before making a new decision." : "Triage was not confirmed. Refresh the current report and verify your MFA and decision state before retrying.");
   return { event_id: Number(eventId) };
 });
