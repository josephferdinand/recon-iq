/**
 * AIDP Slice 3 — review queue logic.
 * Lists pending prediction fields and applies accept/reject/correct decisions,
 * superseding prior outputs and writing security_events for SOC2/audit.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ListInput = z.object({
  tenant_id: z.string().uuid(),
  document_id: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export const listPendingReviews = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => ListInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    let q = supabase.from("aidp_prediction_fields")
      .select(`
        id, prediction_id, entity_type_id, page_id, confidence, bbox,
        value_text, value_number, value_date, value_json, created_at,
        aidp_entity_types!inner ( id, key, label, datatype, review_policy, confidence_threshold ),
        aidp_predictions!inner ( id, document_id, decision )
      `)
      .eq("tenant_id", data.tenant_id)
      .is("accepted_at", null)
      .is("rejected_at", null)
      .order("confidence", { ascending: true, nullsFirst: true })
      .limit(data.limit);
    if (data.document_id) q = q.eq("aidp_predictions.document_id", data.document_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    // PostgREST may serialize to-one embeds as either an object or a one-item
    // array depending on relationship inference. Normalize before filtering so
    // valid pending fields cannot disappear from the reviewer queue.
    const relation = (value: unknown) => Array.isArray(value) ? value[0] : value;
    return (rows ?? []).map((row) => ({
      ...row,
      aidp_predictions: relation(row.aidp_predictions),
      aidp_entity_types: relation(row.aidp_entity_types),
    })).filter((row) => {
      const prediction = row.aidp_predictions as { decision?: string } | null;
      const entity = row.aidp_entity_types as { review_policy?: string } | null;
      return prediction?.decision === "pending" && entity?.review_policy !== "auto_accept";
    });
  });

const ReviewInput = z.object({
  prediction_field_id: z.string().uuid(),
  decision: z.enum(["accept", "reject", "correct"]),
  corrected_value: z.unknown().optional(),
  notes: z.string().max(2000).optional(),
});

export const reviewPredictionField = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => ReviewInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 1. Load field + entity type + prediction (RLS enforces tenant membership)
    const { data: field, error: fErr } = await supabase
      .from("aidp_prediction_fields")
      .select(`
        id, tenant_id, prediction_id, entity_type_id, value_text, value_number, value_date, value_json,
        aidp_entity_types!inner ( id, datatype ),
        aidp_predictions!inner ( document_id )
      `)
      .eq("id", data.prediction_field_id).maybeSingle();
    if (fErr || !field) throw new Error("Forbidden or not found");

    const tenant_id = (field as any).tenant_id as string;
    const document_id = (field as any).aidp_predictions.document_id as string;
    const entity_type_id = (field as any).entity_type_id as string;
    const datatype = (field as any).aidp_entity_types.datatype as string;
    const predictionId = (field as { prediction_id: string }).prediction_id;
    const [{ data: isAdmin }, { data: isAnalyst }] = await Promise.all([
      supabase.rpc("has_tenant_role", { _user_id: userId, _tenant_id: tenant_id, _role: "tenant_admin" }),
      supabase.rpc("has_tenant_role", { _user_id: userId, _tenant_id: tenant_id, _role: "tenant_analyst" }),
    ]);
    if (!isAdmin && !isAnalyst) throw new Error("Forbidden: AIDP reviewer role required");

    // 2. Find any non-superseded output for the same (document, entity_type) to supersede
    const { data: prior } = await supabase.from("aidp_outputs")
      .select("id").eq("tenant_id", tenant_id).eq("document_id", document_id)
      .eq("entity_type_id", entity_type_id).is("superseded_at", null).maybeSingle();

    const nowIso = new Date().toISOString();

    if (data.decision === "reject") {
      // No value row, just mark the field rejected and supersede prior if any
      const { error: rejectError } = await supabase.from("aidp_prediction_fields").update({
        rejected_by: userId, rejected_at: nowIso, review_notes: data.notes ?? null,
      }).eq("id", data.prediction_field_id).eq("tenant_id", tenant_id);
      if (rejectError) throw new Error(rejectError.message);

      const { error: rejectOutputError } = await supabase.from("aidp_outputs").insert({
        tenant_id, document_id, entity_type_id, prediction_field_id: data.prediction_field_id,
        decision: "human_rejected", origin: "human", generated_by: userId,
        supersedes_id: prior?.id ?? null,
      });
      if (rejectOutputError) throw new Error(rejectOutputError.message);
      if (prior?.id) {
        await supabase.from("aidp_outputs").update({ superseded_at: nowIso }).eq("id", prior.id);
      }
    } else {
      // accept | correct — write a value
      const useCorrected = data.decision === "correct";
      let coerced: any = {
        value_text: (field as any).value_text,
        value_number: (field as any).value_number,
        value_date: (field as any).value_date,
        value_json: (field as any).value_json,
      };
      if (useCorrected) coerced = coerceValueColumnsForReview(datatype, data.corrected_value);

      const { error: acceptError } = await supabase.from("aidp_prediction_fields").update({
        accepted_by: userId, accepted_at: nowIso, review_notes: data.notes ?? null,
        ...(useCorrected ? coerced : {}),
      }).eq("id", data.prediction_field_id).eq("tenant_id", tenant_id);
      if (acceptError) throw new Error(acceptError.message);

      const { error: insErr } = await supabase.from("aidp_outputs").insert({
        tenant_id, document_id, entity_type_id, prediction_field_id: data.prediction_field_id,
        decision: "human_accepted",
        origin: useCorrected ? "correction" : "human",
        generated_by: userId,
        supersedes_id: prior?.id ?? null,
        ...coerced,
      });
      if (insErr) throw new Error(insErr.message);
      if (prior?.id) {
        await supabase.from("aidp_outputs").update({ superseded_at: nowIso }).eq("id", prior.id);
        // Invalidation row for the cron processor
        await supabase.from("aidp_output_recon_invalidations").insert({
          tenant_id, output_id: prior.id, reason: "output_superseded", status: "pending",
        });
      }
    }

    // 3. Finalize the parent prediction only after every field has a decision.
    const { data: siblings, error: siblingError } = await supabase.from("aidp_prediction_fields")
      .select("id,accepted_at,rejected_at,aidp_entity_types!inner(required)")
      .eq("tenant_id", tenant_id).eq("prediction_id", predictionId);
    if (siblingError) throw new Error(siblingError.message);
    const pending = (siblings ?? []).filter((row) => !row.accepted_at && !row.rejected_at).length;
    const requiredRejected = (siblings ?? []).filter((row) => {
      const entity = Array.isArray(row.aidp_entity_types) ? row.aidp_entity_types[0] : row.aidp_entity_types;
      return Boolean(row.rejected_at && entity?.required);
    }).length;
    if (pending === 0) {
      const newDecision = requiredRejected > 0 ? "human_rejected" : "human_accepted";
      const { error: decisionError } = await supabase.from("aidp_predictions")
        .update({ decision: newDecision, decided_by: userId, decided_at: nowIso })
        .eq("id", predictionId).eq("tenant_id", tenant_id);
      if (decisionError) throw new Error(decisionError.message);
    }

    // 4. Security/audit event
    const { error: securityError } = await supabase.from("security_events").insert({
      tenant_id, user_id: userId, severity: "info",
      event_type: `aidp.review.${data.decision}`,
      context: { prediction_field_id: data.prediction_field_id, document_id, entity_type_id, corrected: data.decision === "correct" } as any,
    });
    if (securityError) throw new Error(securityError.message);
    const { error: auditError } = await supabase.from("audit_log").insert({
      actor_user_id: userId, tenant_id, scope: "tenant",
      action: `aidp.review.${data.decision}`, resource_type: "aidp_prediction_fields",
      resource_id: data.prediction_field_id,
      context: { document_id, entity_type_id, notes: data.notes ?? null },
    } as any);
    if (auditError) throw new Error(auditError.message);

    return { ok: true, decision: data.decision, pending_fields: pending, required_rejected: requiredRejected };
  });

function coerceValueColumnsForReview(datatype: string, raw: unknown) {
  if (raw === undefined || raw === null) return { value_text: null, value_number: null, value_date: null, value_json: null };
  const s = typeof raw === "string" ? raw : JSON.stringify(raw);
  switch (datatype) {
    case "number":
    case "currency": {
      const n = Number(String(s).replace(/[^0-9.\-]/g, ""));
      return { value_text: s, value_number: Number.isFinite(n) ? n : null, value_date: null, value_json: null };
    }
    case "date": {
      const d = new Date(s);
      return { value_text: s, value_number: null, value_date: Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null, value_json: null };
    }
    case "json":
      try { return { value_text: null, value_number: null, value_date: null, value_json: typeof raw === "string" ? JSON.parse(raw) : raw }; }
      catch { return { value_text: s, value_number: null, value_date: null, value_json: null }; }
    default:
      return { value_text: s, value_number: null, value_date: null, value_json: null };
  }
}
