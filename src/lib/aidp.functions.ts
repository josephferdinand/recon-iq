import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { checkBudget, effectiveAiPolicy, recordUsage } from "@/lib/ai-metering.server";
import {
  resolveModelVersion, callPredictionModel, coerceValueColumns, decideForField,
  type EntityType,
} from "@/lib/aidp-predict.server";

// NOTE (B3 · PII redaction audit): when the AIDP D-series replaces the
// `predictDocument` stub with a real LLM/embedding call, wrap every piece
// of free-text input (page OCR, prompt overrides, sample_prompt) with
// `redactAndAudit(input, { ..., destination: 'embed' })` from
// `@/lib/pii-redact` BEFORE it leaves the boundary. The audit row goes to
// `ai_usage_events` and is the SOC2/DLP evidence that no raw PII reached
// the model. Do not bypass — there is no other instrumentation point.



const utcCalendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Enter a valid UTC calendar date");
const utcCalendarDateFilter = z.union([utcCalendarDate, z.literal("")]).default("");

function isMissingPublicIdColumn(error: unknown) {
  const detail = error && typeof error === "object" ? error as { code?: unknown; message?: unknown } : {};
  const message = `${String(detail.code ?? "")} ${String(detail.message ?? "")}`.toLowerCase();
  return message.includes("pgrst204") || message.includes("42703") ||
    (message.includes("public_id") && message.includes("column") &&
      (message.includes("does not exist") || message.includes("not found") || message.includes("schema cache")));
}

function missingPublicIdSearchError() {
  return new Error("Public ID search is not available on this environment yet. Clear that filter or contact your administrator.");
}

/* ---------------- Templates ---------------- */
export const listAidpTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      page: z.number().int().min(0).default(0),
      page_size: z.number().int().min(1).max(100).default(20),
      search: z.string().max(120).default(""),
      public_id_search: z.string().max(100).default(""),
      created_from: utcCalendarDateFilter,
      created_to: utcCalendarDateFilter,
      kind: z.enum(["all", "bank_statement", "trade_confirm", "invoice", "custodian_report", "generic"]).default("all"),
    }).superRefine((value, issue) => {
      if (value.created_from && value.created_to && value.created_from > value.created_to) {
        issue.addIssue({ code: "custom", path: ["created_to"], message: "Created-to date must be on or after created-from date" });
      }
    }).parse(d))
  .handler(async ({ data, context }) => {
    let query = context.supabase.from("aidp_templates")
      .select("id, tenant_id, name, doc_kind, schema, sample_prompt, created_at", { count: "exact" })
      .eq("tenant_id", data.tenant_id).order("name").order("id");
    if (data.search.trim()) query = query.ilike("name", `%${data.search.trim().replace(/[%_]/g, "\\$&")}%`);
    if (data.public_id_search.trim()) query = query.ilike("public_id", `%${data.public_id_search.trim().replace(/[%_]/g, "\\$&")}%`);
    if (data.kind !== "all") query = query.eq("doc_kind", data.kind);
    if (data.created_from) query = query.gte("created_at", `${data.created_from}T00:00:00.000Z`);
    if (data.created_to) {
      const exclusiveEnd = new Date(`${data.created_to}T00:00:00.000Z`);
      exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
      query = query.lt("created_at", exclusiveEnd.toISOString());
    }
    const from = data.page * data.page_size;
    const { data: rows, error, count } = await query.range(from, from + data.page_size - 1);
    if (error && data.public_id_search.trim() && isMissingPublicIdColumn(error)) throw missingPublicIdSearchError();
    if (error || !Array.isArray(rows) || typeof count !== "number") throw new Error("AIDP templates are temporarily unavailable. Please try again.");
    return { rows, total: count };
  });

export const upsertAidpTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      tenant_id: z.string().uuid(),
      name: z.string().min(1).max(80),
      doc_kind: z.enum(["bank_statement", "trade_confirm", "invoice", "custodian_report", "generic"]),
      schema: z.record(z.string(), z.any()).default({}),
      sample_prompt: z.string().max(4000).optional().nullable(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const payload = { ...data, created_by: context.userId } as any;
    const { error } = await context.supabase.from("aidp_templates")
      .upsert(payload, { onConflict: "tenant_id,name" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteAidpTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("aidp_templates")
      .delete().eq("id", data.id).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------------- Documents ---------------- */
export const listAidpDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      page: z.number().int().min(0).default(0),
      page_size: z.number().int().min(1).max(100).default(20),
      search: z.string().max(120).default(""),
      public_id_search: z.string().max(100).default(""),
      created_from: utcCalendarDateFilter,
      created_to: utcCalendarDateFilter,
      status: z.enum(["all", "queued", "extracting", "review", "approved", "failed"]).default("all"),
    }).superRefine((value, issue) => {
      if (value.created_from && value.created_to && value.created_from > value.created_to) {
        issue.addIssue({ code: "custom", path: ["created_to"], message: "Created-to date must be on or after created-from date" });
      }
    }).parse(d))
  .handler(async ({ data, context }) => {
    let query = context.supabase.from("aidp_documents")
      .select("id, original_filename, mime, bytes, status, confidence, model, cost_usd, created_at, template_id", { count: "exact" })
      .eq("tenant_id", data.tenant_id)
      .order("created_at", { ascending: false }).order("id", { ascending: false });
    if (data.search.trim()) query = query.ilike("original_filename", `%${data.search.trim().replace(/[%_]/g, "\\$&")}%`);
    if (data.public_id_search.trim()) query = query.ilike("public_id", `%${data.public_id_search.trim().replace(/[%_]/g, "\\$&")}%`);
    if (data.status !== "all") query = query.eq("status", data.status);
    if (data.created_from) query = query.gte("created_at", `${data.created_from}T00:00:00.000Z`);
    if (data.created_to) {
      const exclusiveEnd = new Date(`${data.created_to}T00:00:00.000Z`);
      exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
      query = query.lt("created_at", exclusiveEnd.toISOString());
    }
    const from = data.page * data.page_size;
    const { data: rows, error, count } = await query.range(from, from + data.page_size - 1);
    if (error && data.public_id_search.trim() && isMissingPublicIdColumn(error)) throw missingPublicIdSearchError();
    if (error || !Array.isArray(rows) || typeof count !== "number") throw new Error("AIDP documents are temporarily unavailable. Please try again.");
    return { rows, total: count };
  });

export const createAidpDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      original_filename: z.string().min(1).max(255),
      mime: z.string().min(1).max(120),
      bytes: z.number().int().min(0),
      template_id: z.string().uuid().optional().nullable(),
      content_text: z.string().max(200_000).optional(), // text or OCR'd content
    }).parse(d))
  .handler(async ({ data, context }) => {
    const policy = await effectiveAiPolicy(context.supabase, data.tenant_id);
    const budget = await checkBudget(context.supabase, data.tenant_id);
    if (!budget.allowed) throw new Error(budget.reason || "AI budget exceeded");

    const { data: row, error } = await context.supabase.from("aidp_documents")
      .insert({
        tenant_id: data.tenant_id,
        template_id: data.template_id ?? null,
        original_filename: data.original_filename,
        mime: data.mime, bytes: data.bytes,
        status: "extracting",
        model: policy.default_model,
        created_by: context.userId,
      } as any).select("id").single();
    if (error) throw new Error(error.message);

    // Heuristic extraction stub: real impl would call an LLM/OCR provider.
    // We approximate token usage from text length so cost metering is exercised end-to-end.
    const text = (data.content_text ?? "").slice(0, 200_000);
    const tokensIn = Math.max(50, Math.ceil(text.length / 4));
    const tokensOut = Math.min(2000, Math.max(50, Math.ceil(tokensIn / 8)));
    const extraction = { preview: text.slice(0, 1000), length: text.length };

    const { cost_usd } = await recordUsage(context.supabase, {
      tenant_id: data.tenant_id, user_id: context.userId, scope: "aidp",
      model: policy.default_model, tokens_in: tokensIn, tokens_out: tokensOut,
      meta: { doc_id: row.id, filename: data.original_filename },
    });

    await context.supabase.from("aidp_documents").update({
      status: "review",
      extraction,
      confidence: 0.85,
      tokens_in: tokensIn, tokens_out: tokensOut, cost_usd,
    } as any).eq("id", row.id);

    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: "aidp.extract", resource_type: "aidp_documents", resource_id: row.id,
      context: { filename: data.original_filename, cost_usd },
    } as any);
    return { id: row.id, cost_usd };
  });

export const approveAidpDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const [{ data: isAdmin }, { data: isAnalyst }] = await Promise.all([
      context.supabase.rpc("has_tenant_role", { _user_id: context.userId, _tenant_id: data.tenant_id, _role: "tenant_admin" }),
      context.supabase.rpc("has_tenant_role", { _user_id: context.userId, _tenant_id: data.tenant_id, _role: "tenant_analyst" }),
    ]);
    if (!isAdmin && !isAnalyst) throw new Error("Forbidden: AIDP reviewer role required");
    const { data: predictions, error: predictionError } = await context.supabase.from("aidp_predictions")
      .select("id,decision").eq("tenant_id", data.tenant_id).eq("document_id", data.id);
    if (predictionError) throw new Error(predictionError.message);
    if (!predictions?.length || predictions.some((prediction) => prediction.decision === "pending")) {
      throw new Error("Complete every pending AIDP field review before document approval");
    }
    if (predictions.some((prediction) => prediction.decision === "human_rejected")) {
      throw new Error("Required AIDP fields were rejected; correct them before document approval");
    }
    const { count: outputs, error: outputError } = await context.supabase.from("aidp_outputs")
      .select("id", { count: "exact", head: true }).eq("tenant_id", data.tenant_id)
      .eq("document_id", data.id).is("superseded_at", null).neq("decision", "human_rejected");
    if (outputError) throw new Error(outputError.message);
    if (!outputs) throw new Error("Document approval requires reviewed current outputs");
    const { data: approved, error } = await context.supabase.from("aidp_documents")
      .update({ status: "approved" }).eq("id", data.id).eq("tenant_id", data.tenant_id)
      .eq("status", "review").select("id").maybeSingle();
    if (error || !approved) throw new Error(error?.message ?? "Document is not awaiting approval");
    const { error: auditError } = await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId,
      tenant_id: data.tenant_id,
      scope: "tenant",
      action: "aidp.document.approve",
      resource_type: "aidp_documents",
      resource_id: data.id,
      context: { current_outputs: outputs },
    } as never);
    if (auditError) throw new Error(auditError.message);
    return { ok: true };
  });

/* ---------------- Extraction Audit Timeline ---------------- */
export const getAidpExtractionTimeline = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ tenant_id: z.string().uuid(), document_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const tenant_id = data.tenant_id;
    const document_id = data.document_id;

    const [doc, preds, audit, contextualAudit, outputs] = await Promise.all([
      supabase.from("aidp_documents")
        .select("id, original_filename, mime, bytes, status, confidence, model, cost_usd, created_at, created_by, error")
        .eq("tenant_id", tenant_id).eq("id", document_id).maybeSingle(),
      supabase.from("aidp_predictions")
        .select("id, status, decision, decided_by, decided_at, expires_at, overall_confidence, raw_response, created_at")
        .eq("tenant_id", tenant_id).eq("document_id", document_id)
        .order("created_at", { ascending: true }),
      supabase.from("audit_log")
        .select("id, action, actor_user_id, occurred_at, context, row_hash")
        .eq("tenant_id", tenant_id).eq("resource_type", "aidp_documents")
        .eq("resource_id", document_id)
        .order("occurred_at", { ascending: true }).limit(200),
      supabase.from("audit_log")
        .select("id, action, actor_user_id, occurred_at, context, row_hash")
        .eq("tenant_id", tenant_id)
        .contains("context", { document_id })
        .order("occurred_at", { ascending: true }).limit(200),
      supabase.from("aidp_outputs")
        .select("id, entity_type_id, value_text, value_number, value_date, confidence, origin, generated_by, generated_at, supersedes_id, superseded_at")
        .eq("tenant_id", tenant_id).eq("document_id", document_id)
        .order("generated_at", { ascending: true }),
    ]);

    const failures = [doc.error, preds.error, audit.error, contextualAudit.error, outputs.error]
      .filter(Boolean);
    if (failures.length) throw new Error("Unable to load the complete AIDP audit timeline");

    const predictions = (preds.data ?? []).map((p: any) => ({
      ...p,
      confidence: p.overall_confidence,
      model: p.raw_response?.model_meta?.model ?? null,
    }));
    const auditRows = [...(audit.data ?? []), ...(contextualAudit.data ?? [])]
      .filter((row, index, rows) => rows.findIndex((candidate) => candidate.id === row.id) === index)
      .sort((a, b) => +new Date(a.occurred_at) - +new Date(b.occurred_at));

    const actorIds = new Set<string>();
    predictions.forEach((p: any) => p.decided_by && actorIds.add(p.decided_by));
    auditRows.forEach((a: any) => a.actor_user_id && actorIds.add(a.actor_user_id));
    (outputs.data ?? []).forEach((o: any) => o.generated_by && actorIds.add(o.generated_by));
    if (doc.data?.created_by) actorIds.add(doc.data.created_by);

    let actors: Record<string, { email: string | null; full_name: string | null }> = {};
    if (actorIds.size) {
      const { data: profs } = await supabase.from("profiles")
        .select("id, email, full_name").in("id", Array.from(actorIds));
      actors = Object.fromEntries((profs ?? []).map((p: any) => [p.id, { email: p.email, full_name: p.full_name }]));
    }

    return {
      document: doc.data ?? null,
      predictions,
      audit: auditRows,
      outputs: outputs.data ?? [],
      actors,
    };
  });

/* ============================================================
   Slice 2 — Projects, document types, entity types, pages, annotations
   ============================================================ */

/* ---- Projects ---- */
export const listAidpProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string }) =>
    z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase.from("aidp_projects")
      .select("id, slug, name, description, created_at")
      .eq("tenant_id", data.tenant_id).order("created_at", { ascending: false });
    return rows ?? [];
  });

export const createAidpProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      slug: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/),
      name: z.string().min(1).max(120),
      description: z.string().max(1000).optional().nullable(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.from("aidp_projects")
      .insert({ ...data, created_by: context.userId } as any)
      .select("id").single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

/* ---- Document types ---- */
export const listAidpDocumentTypes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ tenant_id: z.string().uuid(), project_id: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("aidp_document_types")
      .select("id, project_id, code, label, description, created_at")
      .eq("tenant_id", data.tenant_id).order("label");
    if (data.project_id) q = q.eq("project_id", data.project_id);
    const { data: rows } = await q;
    return rows ?? [];
  });

export const upsertAidpDocumentType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      tenant_id: z.string().uuid(),
      project_id: z.string().uuid(),
      code: z.string().min(2).max(40),
      label: z.string().min(1).max(120),
      description: z.string().max(1000).optional().nullable(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("aidp_document_types")
      .upsert(data as any, { onConflict: "tenant_id,project_id,code" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---- Entity types (per document type) ---- */
export const listAidpEntityTypes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ tenant_id: z.string().uuid(), document_type_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase.from("aidp_entity_types")
      .select("id, key, label, datatype, extractor, required, confidence_threshold, review_policy, position, options")
      .eq("tenant_id", data.tenant_id).eq("document_type_id", data.document_type_id)
      .order("position");
    return rows ?? [];
  });

export const upsertAidpEntityType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      tenant_id: z.string().uuid(),
      document_type_id: z.string().uuid(),
      key: z.string().min(1).max(60).regex(/^[a-z][a-z0-9_]*$/),
      label: z.string().min(1).max(120),
      datatype: z.enum(["string", "number", "date", "currency", "boolean", "enum"]).default("string"),
      extractor: z.enum(["bbox", "table_cell", "key_value", "free_text"]).default("bbox"),
      required: z.boolean().default(false),
      confidence_threshold: z.number().min(0).max(1).default(0.85),
      review_policy: z.enum(["auto_accept", "review_low_confidence", "always_review"]).default("review_low_confidence"),
      position: z.number().int().default(0),
      options: z.record(z.string(), z.any()).default({}),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("aidp_entity_types")
      .upsert(data as any, { onConflict: "tenant_id,document_type_id,key" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteAidpEntityType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("aidp_entity_types")
      .delete().eq("id", data.id).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---- Document hydration for annotator ---- */
export const getAidpDocument = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ tenant_id: z.string().uuid(), document_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: doc, error } = await context.supabase.from("aidp_documents")
      .select("id, original_filename, mime, bytes, status, page_count, project_id, document_type_id, rendered_at, created_at")
      .eq("tenant_id", data.tenant_id).eq("id", data.document_id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!doc) throw new Error("Document not found");
    return doc;
  });

export const setAidpDocumentMeta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      document_id: z.string().uuid(),
      project_id: z.string().uuid().nullable().optional(),
      document_type_id: z.string().uuid().nullable().optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const patch: Record<string, unknown> = {};
    if (data.project_id !== undefined) patch.project_id = data.project_id;
    if (data.document_type_id !== undefined) patch.document_type_id = data.document_type_id;
    const { error } = await context.supabase.from("aidp_documents")
      .update(patch as any).eq("id", data.document_id).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---- Storage signed URLs ---- */
export const signAidpStoragePath = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      path: z.string().min(1),
      mode: z.enum(["read", "upload"]).default("read"),
      expires_in: z.number().int().min(60).max(60 * 60).default(900),
    }).parse(d))
  .handler(async ({ data, context }) => {
    // Tenant prefix enforcement (defense-in-depth alongside storage RLS)
    if (!data.path.startsWith(`${data.tenant_id}/`)) {
      throw new Error("Path must be scoped to the tenant id");
    }
    if (data.mode === "upload") {
      const { data: signed, error } = await context.supabase.storage
        .from("aidp").createSignedUploadUrl(data.path);
      if (error) throw new Error(error.message);
      return { signed_url: signed.signedUrl, token: signed.token, path: data.path };
    }
    const { data: signed, error } = await context.supabase.storage
      .from("aidp").createSignedUrl(data.path, data.expires_in);
    if (error) throw new Error(error.message);
    return { signed_url: signed.signedUrl, path: data.path };
  });

/* ---- Pages ---- */
export const listAidpPages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      document_id: z.string().uuid(),
      purpose: z.enum(["review", "inference"]).default("review"),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.from("aidp_pages")
      .select("id, page_index, width, height, image_uri, dpi, purpose, rendered_at")
      .eq("tenant_id", data.tenant_id).eq("document_id", data.document_id)
      .eq("purpose", data.purpose).order("page_index");
    if (error) throw new Error(error.message);
    if (!rows || rows.length === 0) return [];
    const paths = rows.map((r: any) => r.image_uri as string);
    const { data: signed } = await context.supabase.storage.from("aidp")
      .createSignedUrls(paths, 900);
    const urlByPath = new Map((signed ?? []).map((s: any) => [s.path, s.signedUrl]));
    return rows.map((r: any) => ({ ...r, signed_url: urlByPath.get(r.image_uri) ?? null }));
  });

export const registerAidpPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      document_id: z.string().uuid(),
      page_index: z.number().int().min(0),
      width: z.number().int().min(1),
      height: z.number().int().min(1),
      image_uri: z.string().min(1),
      dpi: z.number().int().min(72).max(400),
      purpose: z.enum(["review", "inference"]),
    }).parse(d))
  .handler(async ({ data, context }) => {
    if (!data.image_uri.startsWith(`${data.tenant_id}/`)) {
      throw new Error("image_uri must be scoped to the tenant id");
    }
    const { error } = await context.supabase.from("aidp_pages")
      .upsert({ ...data, rendered_at: new Date().toISOString() } as any,
        { onConflict: "document_id,page_index,purpose" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const finalizeAidpRender = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      document_id: z.string().uuid(),
      page_count: z.number().int().min(1),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("aidp_documents").update({
      page_count: data.page_count,
      rendered_at: new Date().toISOString(),
      status: "annotating",
    } as any).eq("id", data.document_id).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: "aidp.render", resource_type: "aidp_documents", resource_id: data.document_id,
      context: { page_count: data.page_count },
    } as any);
    return { ok: true };
  });

/* ---- Annotations ---- */
export const listAidpAnnotations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ tenant_id: z.string().uuid(), document_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.from("aidp_annotations")
      .select("id, page_id, entity_type_id, bbox, value, source, annotated_by, created_at")
      .eq("tenant_id", data.tenant_id).eq("document_id", data.document_id)
      .order("created_at");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const createAidpAnnotation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      document_id: z.string().uuid(),
      page_id: z.string().uuid(),
      entity_type_id: z.string().uuid(),
      bbox: z.object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        w: z.number().min(0).max(1),
        h: z.number().min(0).max(1),
      }),
      value: z.string().max(2000).optional().nullable(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.from("aidp_annotations")
      .insert({
        tenant_id: data.tenant_id,
        document_id: data.document_id,
        page_id: data.page_id,
        entity_type_id: data.entity_type_id,
        bbox: data.bbox,
        value: data.value ?? null,
        source: "human",
        annotated_by: context.userId,
      } as any).select("id").single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const updateAidpAnnotationValue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), tenant_id: z.string().uuid(), value: z.string().max(2000) }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("aidp_annotations")
      .update({ value: data.value, updated_at: new Date().toISOString() } as any)
      .eq("id", data.id).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteAidpAnnotation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("aidp_annotations")
      .delete().eq("id", data.id).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ============================================================
   Slice 3 — Real prediction loop (predictDocument)
   ============================================================ */
export const predictDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      document_id: z.string().uuid(),
      model_version_id: z.string().uuid().optional(),
      idempotency_key: z.string().min(8).max(200).optional(),
    }).parse(d))
  .handler(async ({ data, context }): Promise<{
    prediction_id: string;
    auto_accepted_count: number;
    pending_review_count: number;
    model_version_id: string;
    idempotent_replay?: boolean;
  }> => {
    const { supabase, userId } = context;

    // Idempotency short-circuit — return prior prediction unchanged.
    if (data.idempotency_key) {
      const { data: existing } = await supabase.from("aidp_predictions")
        .select("id, status, overall_confidence, decision, model_version_id, raw_response")
        .eq("tenant_id", data.tenant_id)
        .eq("idempotency_key", data.idempotency_key)
        .maybeSingle();
      if (existing) {
        const { data: pfs } = await supabase.from("aidp_prediction_fields")
          .select("id, accepted_at, rejected_at").eq("prediction_id", (existing as any).id);
        const rows = pfs ?? [];
        return {
          prediction_id: (existing as any).id,
          auto_accepted_count: rows.filter((r: any) => r.accepted_at).length,
          pending_review_count: rows.filter((r: any) => !r.accepted_at && !r.rejected_at).length,
          model_version_id: (existing as any).model_version_id ?? "",
          idempotent_replay: true,
        };
      }
    }

    // Budget gate
    const budget = await checkBudget(supabase, data.tenant_id);
    if (!budget.allowed) throw new Error(budget.reason || "AI budget exceeded");

    const { data: doc, error: docErr } = await supabase.from("aidp_documents")
      .select("id, tenant_id, document_type_id, original_filename")
      .eq("id", data.document_id).eq("tenant_id", data.tenant_id).maybeSingle();
    if (docErr || !doc) throw new Error("Document not found");

    const { data: entityTypes } = await supabase.from("aidp_entity_types")
      .select("id,key,label,datatype,extractor,required,confidence_threshold,review_policy,options,document_type_id")
      .eq("tenant_id", data.tenant_id)
      .eq("document_type_id", (doc as any).document_type_id);
    if (!entityTypes || entityTypes.length === 0) {
      throw new Error("No entity types defined for this document type");
    }
    const ets = entityTypes as unknown as EntityType[];

    const resolved = await resolveModelVersion(
      supabase, data.tenant_id, (doc as any).document_type_id, data.model_version_id);

    const { data: pages } = await supabase.from("aidp_pages")
      .select("id,page_index,image_uri,purpose,dpi")
      .eq("tenant_id", data.tenant_id).eq("document_id", data.document_id)
      .eq("purpose", "inference").order("page_index", { ascending: true });

    if (!pages || pages.length === 0) {
      throw new Error("No inference pages registered. Call registerAidpPage first.");
    }

    const signFn = async (storagePath: string): Promise<string> => {
      const { data: signed } = await supabase.storage
        .from("aidp").createSignedUrl(storagePath, 600);
      if (!signed?.signedUrl) throw new Error(`Failed to sign ${storagePath}`);
      return signed.signedUrl;
    };

    const pageInputs = (pages as any[]).map(p => ({ image_uri: p.image_uri, page_index: p.page_index }));

    const modelVersionFk = isUuid(resolved.model_version_id) ? resolved.model_version_id : null;
    const insertPayload: any = {
      tenant_id: data.tenant_id,
      document_id: data.document_id,
      model_version_id: modelVersionFk,
      status: "running",
      decision: "pending",
      created_by: userId,
      expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      raw_response: { model_meta: { provider: resolved.provider, model: resolved.model, source: resolved.source } } as any,
    };
    if (data.idempotency_key) insertPayload.idempotency_key = data.idempotency_key;

    const { data: predRow, error: predErr } = await supabase.from("aidp_predictions")
      .insert(insertPayload).select("id").single();
    if (predErr || !predRow) {
      // Race: another concurrent call inserted with the same idempotency key.
      if (data.idempotency_key && /duplicate key|unique/i.test(predErr?.message ?? "")) {
        const { data: dup } = await supabase.from("aidp_predictions")
          .select("id, model_version_id").eq("tenant_id", data.tenant_id)
          .eq("idempotency_key", data.idempotency_key).maybeSingle();
        if (dup) return {
          prediction_id: (dup as any).id,
          auto_accepted_count: 0, pending_review_count: 0,
          model_version_id: (dup as any).model_version_id ?? "",
          idempotent_replay: true,
        };
      }
      throw new Error(predErr?.message || "Failed to create prediction");
    }
    const prediction_id = (predRow as any).id as string;

    let modelOut: Awaited<ReturnType<typeof callPredictionModel>>;
    try {
      modelOut = await callPredictionModel(resolved, ets, pageInputs, signFn);
    } catch (e: any) {
      await supabase.from("security_events").insert({
        tenant_id: data.tenant_id, user_id: userId, severity: "error",
        event_type: "aidp.predict.failed",
        context: { document_id: data.document_id, prediction_id, error: String(e?.message || e), provider: resolved.provider, model: resolved.model } as any,
      });
      await supabase.from("aidp_predictions").update({
        status: "failed", error: String(e?.message || e), completed_at: new Date().toISOString(),
      } as any).eq("id", prediction_id);
      throw e;
    }

    // Record AI usage / cost metering
    const usage = await recordUsage(supabase, {
      tenant_id: data.tenant_id, user_id: userId, scope: "aidp",
      model: resolved.model, tokens_in: modelOut.tokens_in, tokens_out: modelOut.tokens_out,
      meta: { document_id: data.document_id, prediction_id },
    });

    // Aggregate confidences and per-field rows
    const confidences: number[] = [];
    let auto_accepted_count = 0;
    let pending_review_count = 0;

    for (const et of ets) {
      const r = (modelOut.results as any)[et.key] as { value: unknown; confidence: number; bbox?: any } | undefined;
      const confidence = typeof r?.confidence === "number" ? Math.min(1, Math.max(0, r.confidence)) : 0;
      confidences.push(confidence);
      const coerced = coerceValueColumns(et.datatype, r?.value);
      const pageId = (pages as any[])[0]?.id ?? null;

      const { data: pfRow, error: pfErr } = await supabase.from("aidp_prediction_fields").insert({
        tenant_id: data.tenant_id,
        prediction_id,
        entity_type_id: et.id,
        page_id: pageId,
        value: coerced.value_text ?? (coerced.value_number != null ? String(coerced.value_number) : null),
        ...coerced,
        confidence,
        bbox: (r?.bbox ?? null) as any,
      } as any).select("id").single();
      if (pfErr || !pfRow) {
        // Skip this field but keep the loop going
        pending_review_count += 1;
        continue;
      }
      const prediction_field_id = (pfRow as any).id as string;

      const verdict = decideForField(et.review_policy, confidence, Number(et.confidence_threshold ?? 0.85));
      if (verdict === "auto_accept" && r?.value != null) {
        // Supersede any prior live output for this (document, entity_type)
        const { data: prior } = await supabase.from("aidp_outputs")
          .select("id").eq("tenant_id", data.tenant_id).eq("document_id", data.document_id)
          .eq("entity_type_id", et.id).is("superseded_at", null).maybeSingle();
        await supabase.from("aidp_outputs").insert({
          tenant_id: data.tenant_id,
          document_id: data.document_id,
          entity_type_id: et.id,
          prediction_field_id,
          decision: "auto_accepted",
          origin: "model",
          confidence,
          supersedes_id: prior?.id ?? null,
          ...coerced,
        } as any);
        if (prior?.id) {
          await supabase.from("aidp_outputs").update({ superseded_at: new Date().toISOString() } as any).eq("id", prior.id);
          await supabase.from("aidp_output_recon_invalidations").insert({
            tenant_id: data.tenant_id, output_id: prior.id, reason: "output_superseded", status: "pending",
          } as any);
        }
        auto_accepted_count += 1;
      } else {
        pending_review_count += 1;
      }
    }

    const overall = confidences.length
      ? Number((confidences.reduce((a, b) => a + b, 0) / confidences.length).toFixed(3))
      : null;

    // Finalize prediction row
    const finalDecision = pending_review_count === 0 && auto_accepted_count > 0 ? "auto_accepted" : "pending";
    await supabase.from("aidp_predictions").update({
      status: "succeeded",
      overall_confidence: overall,
      latency_ms: modelOut.latency_ms,
      raw_response: { ...(modelOut.results as any), model_meta: { provider: resolved.provider, model: resolved.model, source: resolved.source }, cost_usd: usage.cost_usd } as any,
      completed_at: new Date().toISOString(),
      decision: finalDecision as any,
      decided_at: finalDecision === "auto_accepted" ? new Date().toISOString() : null,
    } as any).eq("id", prediction_id);

    await supabase.from("audit_log").insert({
      actor_user_id: userId, tenant_id: data.tenant_id, scope: "tenant",
      action: "aidp.predict",
      resource_type: "aidp_predictions", resource_id: prediction_id,
      context: { document_id: data.document_id, auto_accepted_count, pending_review_count, cost_usd: usage.cost_usd, model: resolved.model } as any,
    } as any);

    return {
      prediction_id,
      auto_accepted_count,
      pending_review_count,
      model_version_id: resolved.model_version_id,
    };
  });

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
