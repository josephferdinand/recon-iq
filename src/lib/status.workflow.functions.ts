import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { incidentDraftSchema } from "@/lib/status.model";
import { statusCommandReceiptSchema, statusCommandResultSchema } from "@/lib/status-command-result";
import { readRegisteredStatusRows } from "@/lib/status-registry-read.server";

const uuid = z.string().uuid();
export const statusCommandSchema = z.object({
  request_id: uuid, incident_id: uuid.nullable(), expected_revision: z.number().int().nonnegative(),
  action: z.enum(["save_draft", "submit", "review", "return", "publish", "append_update", "append_correction"]),
  payload: z.unknown(),
}).transform((command) => ({ ...command, payload:
  ["save_draft", "append_update", "append_correction"].includes(command.action)
    ? incidentDraftSchema.parse(command.payload)
    : z.object({ reason: z.string().trim().min(8).max(800) }).parse(command.payload),
}));

async function requireCurrentStatusAdmin(context: any) {
  const { data, error } = await context.supabase.rpc("is_platform_admin", { _user_id: context.userId });
  if (error || data !== true) throw new Error("Current platform status administrator permission is required. Refresh your access or ask a platform administrator.");
}

export const getStatusAdminSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((value) => z.object({ offset: z.number().int().nonnegative().max(100000).default(0) }).parse(value ?? {}))
  .handler(async ({ data, context }) => {
    await requireCurrentStatusAdmin(context);
    const [workflow, registry, catalog, reports, functions] = await Promise.all([
      (context.supabase as any).from("status_incident_workflows")
        .select("id,current_revision,published_revision,maker_id,reviewer_id,workflow_state,entered_at,status_incident_versions(revision,public_payload,evidence_ref,public_safe,actor_id,entered_at)")
        .order("entered_at", { ascending: false }).range(data.offset, data.offset + 100).abortSignal(AbortSignal.timeout(8_000)),
      readRegisteredStatusRows(context.supabase as any, "cells"),
      context.supabase.from("status_components").select("key,name").order("display_order").abortSignal(AbortSignal.timeout(8_000)),
      (context.supabase as any).from("status_report_intake").select("id,tenant_id,requester_id,summary,cell_keys,component_keys,entered_at,status_report_triage_events(id,action,incident_id,reason,actor_id,entered_at)")
        .order("entered_at", { ascending: false }).range(data.offset, data.offset + 100).abortSignal(AbortSignal.timeout(8_000)),
      readRegisteredStatusRows(context.supabase as any, "functions"),
    ]);
    if (workflow.error || catalog.error || reports.error) throw new Error("Incident management could not be loaded completely. Retry after the status schema, registry coverage and your permission are verified.");
    return { actor_id: context.userId, incidents: (workflow.data ?? []).slice(0,100), cells: registry, components: catalog.data ?? [], reports: (reports.data ?? []).slice(0,100),
      functions, offset: data.offset, has_more: (workflow.data?.length ?? 0) > 100 || (reports.data?.length ?? 0) > 100 };
  });

export const executeStatusIncidentCommand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((value) => statusCommandSchema.parse(value))
  .handler(async ({ data, context }) => {
    await requireCurrentStatusAdmin(context);
    const { data: receipt, error } = await (context.supabase as any).rpc("status_incident_command", {
      _request_id: data.request_id, _incident_id: data.incident_id, _expected_revision: data.expected_revision,
      _action: data.action, _payload: data.payload,
    }).abortSignal(AbortSignal.timeout(8_000));
    if (error) {
      if (error.code === "42501") throw new Error("This action requires a current platform administrator, verified MFA, and an independent reviewer. Check access and review state before retrying.");
      if (error.code === "PT409" || error.code === "40001") throw new Error("This incident changed. Refresh the queue and review its latest revision before submitting again.");
      throw new Error("We could not confirm this incident action. Refresh the queue first; retry the same action with its existing request key only after checking the outcome.");
    }
    const result = statusCommandResultSchema.parse(receipt);
    if (result.request_id !== data.request_id) throw new Error("The incident receipt did not match this request. Keep its saved key and check the outcome.");
    return result;
  });

/** Read-only reconciliation of the same caller's exact frozen command. The SQL
 * helper rechecks current admin/MFA before looking up the stored fingerprint. */
export const getStatusIncidentCommandReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((value) => statusCommandSchema.parse(value))
  .handler(async ({ data, context }) => {
    await requireCurrentStatusAdmin(context);
    const { data: receipt, error } = await (context.supabase as any).rpc("status_incident_command_receipt", {
      _request_id: data.request_id, _incident_id: data.incident_id, _expected_revision: data.expected_revision,
      _action: data.action, _payload: data.payload,
    }).abortSignal(AbortSignal.timeout(8_000));
    if (error) throw new Error("The saved command outcome could not be verified. Keep its request key; do not create a replacement command.");
    if (receipt === null) return { state: "unconfirmed" as const, request_id: data.request_id };
    const result = statusCommandReceiptSchema.parse(receipt);
    if (result.request_id !== data.request_id) throw new Error("The saved command receipt did not match this request.");
    return { state: "recorded" as const, receipt: result };
  });

export const getStatusIncidentAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((value) => z.object({ incident_id: uuid, offset: z.number().int().nonnegative().default(0) }).parse(value))
  .handler(async ({ data, context }) => {
    await requireCurrentStatusAdmin(context);
    const [{ data: rows, error }, { data: denials, error: denialError }] = await Promise.all([(context.supabase as any).from("status_incident_audit")
      .select("id,incident_id,revision,actor_id,action,reason,entered_at")
      .eq("incident_id", data.incident_id).order("id").range(data.offset, data.offset + 100).abortSignal(AbortSignal.timeout(8_000)),
      (context.supabase as any).from("status_command_denials").select("id,incident_id,expected_revision,actor_id,action,refusal_code,request_id,entered_at")
        .eq("incident_id", data.incident_id).order("id").range(data.offset, data.offset + 100).abortSignal(AbortSignal.timeout(8_000))]);
    if (error || denialError) throw new Error("The complete incident audit could not be loaded. Retry shortly.");
    return { rows: (rows ?? []).slice(0,100), denials: (denials ?? []).slice(0,100), has_more: (rows?.length ?? 0) > 100 || (denials?.length ?? 0) > 100 };
  });
