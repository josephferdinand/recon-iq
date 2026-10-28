/**
 * Four-eyes approval workflow for destructive marketing-admin operations.
 *
 * Flow:
 *   1. Requester calls `requestThemeAction({ theme_id, action, payload, note })`
 *      → row inserted into `mkt_theme_approvals` with `status='pending'` and
 *      an audit event of type `request`.
 *   2. A DIFFERENT admin calls `decideThemeApproval({ id, decision, note })`
 *      → status flips to `approved` or `rejected`; audit event `approve` or
 *      `reject`. The decider cannot be the requester (checked server-side).
 *   3. Executor (any admin) calls `executeApprovedThemeAction({ id })`
 *      → dispatches to the underlying theme mutation, marks the approval
 *      row `status='executed'`, and writes the underlying audit event.
 *
 * All three steps require MFA step-up (aal2) so the audit trail records
 * a step-up_success (or stepup_failed) event for every touch of a
 * privileged action.
 */

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertMktRole } from "./mkt-admin.functions";
import { MKT_TAB_ROLES } from "./mkt-admin-roles";
import { logMktChange, resolveMktActorContext } from "./mkt-audit.server";
import { requireMktStepUp } from "./mkt-stepup.server";

const themeActionEnum = z.enum(["activate", "rollback", "archive"]);
export type ThemeApprovalAction = z.infer<typeof themeActionEnum>;

export type ThemeApproval = {
  id: string;
  theme_id: string;
  action: ThemeApprovalAction;
  payload: Record<string, string | number | boolean | null>;
  status: "pending" | "approved" | "rejected" | "cancelled" | "executed";
  requested_by: string;
  requested_by_email: string | null;
  requested_at: string;
  decided_by: string | null;
  decided_by_email: string | null;
  decided_at: string | null;
  decision_note: string | null;
  executed_at: string | null;
};

async function actorEmail(context: { userId: string; claims?: Record<string, unknown> | null | undefined }): Promise<string | null> {
  return (context.claims as { email?: string } | undefined)?.email ?? null;
}

export const listThemeApprovals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    status: z.enum(["pending","approved","rejected","cancelled","executed","__all"]).default("pending"),
    theme_id: z.string().uuid().optional(),
  }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    await assertMktRole(context, MKT_TAB_ROLES.themes);
    let q = context.supabase.from("mkt_theme_approvals" as never).select("*")
      .order("requested_at", { ascending: false }).limit(200);
    if (data.status !== "__all") q = q.eq("status", data.status);
    if (data.theme_id) q = q.eq("theme_id", data.theme_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return ((rows ?? []) as unknown) as ThemeApproval[];
  });

export const requestThemeAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    theme_id: z.string().uuid(),
    action: themeActionEnum,
    payload: z.record(z.unknown()).default({}),
    note: z.string().max(500).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMktRole(context, MKT_TAB_ROLES.themes);
    await requireMktStepUp(context, {
      entity_type: "theme_approval", action: "request",
      entity_key: data.theme_id, summary: `Step-up for approval request (${data.action})`,
    });
    const email = await actorEmail(context);
    const { data: row, error } = await context.supabase
      .from("mkt_theme_approvals" as never)
      .insert({
        theme_id: data.theme_id, action: data.action,
        payload: data.payload as never, status: "pending",
        requested_by: context.userId, requested_by_email: email,
        decision_note: data.note ?? null,
      } as never)
      .select("id").single();
    if (error) throw new Error(error.message);
    const actor = await resolveMktActorContext(context, { source: "theme_approval:request" });
    await logMktChange({
      entity_type: "theme_approval",
      entity_key: (row as { id: string }).id,
      action: "request",
      actor_id: context.userId, actor_email: email,
      actor_context: actor,
      after: { theme_id: data.theme_id, action: data.action, note: data.note ?? null } as never,
      summary: `Requested ${data.action} for theme ${data.theme_id}${data.note ? ` — ${data.note}` : ""}`,
    });
    return { id: (row as { id: string }).id };
  });

export const decideThemeApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    id: z.string().uuid(),
    decision: z.enum(["approve","reject"]),
    note: z.string().max(500).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMktRole(context, MKT_TAB_ROLES.themes);
    await requireMktStepUp(context, {
      entity_type: "theme_approval", action: data.decision === "approve" ? "approve" : "reject",
      entity_key: data.id, summary: `Step-up for approval decision (${data.decision})`,
    });
    const { data: appr, error: readErr } = await context.supabase
      .from("mkt_theme_approvals" as never)
      .select("id,theme_id,action,status,requested_by")
      .eq("id", data.id).maybeSingle();
    if (readErr || !appr) throw new Error(readErr?.message ?? "Approval not found");
    const row = appr as { id: string; theme_id: string; action: string; status: string; requested_by: string };
    if (row.status !== "pending") throw new Error(`Approval is ${row.status}, cannot decide`);
    if (row.requested_by === context.userId) {
      throw new Response("Four-eyes: requester cannot approve their own request", { status: 403 });
    }
    const email = await actorEmail(context);
    const nextStatus = data.decision === "approve" ? "approved" : "rejected";
    const { error: upErr } = await context.supabase.from("mkt_theme_approvals" as never)
      .update({ status: nextStatus, decided_by: context.userId, decided_by_email: email,
                decided_at: new Date().toISOString(), decision_note: data.note ?? null } as never)
      .eq("id", data.id);
    if (upErr) throw new Error(upErr.message);
    const actor = await resolveMktActorContext(context, { source: "theme_approval:decide" });
    await logMktChange({
      entity_type: "theme_approval",
      entity_key: data.id,
      action: data.decision === "approve" ? "approve" : "reject",
      actor_id: context.userId, actor_email: email,
      actor_context: actor,
      after: { decision: data.decision, note: data.note ?? null,
               theme_id: row.theme_id, guarded_action: row.action } as never,
      summary: `${data.decision === "approve" ? "Approved" : "Rejected"} ${row.action} on theme ${row.theme_id}${data.note ? ` — ${data.note}` : ""}`,
    });
    return { ok: true, status: nextStatus };
  });

export const cancelThemeApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertMktRole(context, MKT_TAB_ROLES.themes);
    const email = await actorEmail(context);
    const { error } = await context.supabase.from("mkt_theme_approvals" as never)
      .update({ status: "cancelled", decided_by: context.userId, decided_by_email: email,
                decided_at: new Date().toISOString() } as never)
      .eq("id", data.id).eq("status", "pending");
    if (error) throw new Error(error.message);
    const actor = await resolveMktActorContext(context, { source: "theme_approval:cancel" });
    await logMktChange({
      entity_type: "theme_approval", entity_key: data.id, action: "cancel",
      actor_id: context.userId, actor_email: email,
      actor_context: actor,
      summary: "Cancelled approval request",
    });
    return { ok: true };
  });
