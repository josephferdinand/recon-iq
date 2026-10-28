import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { compileWizardRules, suggestWizardMapping, validateWizardMappingPlan } from "@/lib/rekon-wizard-rules";
import { readSafeEnv, isSafeEnvName } from "@/lib/safe-env.server";
import { assertSafeOutboundUrl, safeFetch } from "@/lib/ssrf-guard.server";
import { isDateLike } from "@/lib/csv-parse";
import { createReconDefinitionWithOwners } from "@/lib/recons.functions";
import type { Database, Json } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";

const tid = z.string().uuid();

async function assertWriter(ctx: any, tenantId: string) {
  const { data: a } = await ctx.supabase.rpc("has_tenant_role", {
    _user_id: ctx.userId, _tenant_id: tenantId, _role: "tenant_admin",
  });
  const { data: b } = await ctx.supabase.rpc("has_tenant_role", {
    _user_id: ctx.userId, _tenant_id: tenantId, _role: "tenant_analyst",
  });
  if (!a && !b) throw new Error("Forbidden: analyst or admin required");
}

// ──────────────────────────────────────────────────────────────────────
// Available sources (used by Step 1 dropdowns)
// ──────────────────────────────────────────────────────────────────────
export const listWizardSourceCatalog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: tid }).parse(d))
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    const [existing, pipelines, aidp, apis, dbs] = await Promise.all([
      context.supabase.from("workspace_data_sources")
        .select("id, name, source_type, updated_at").eq("tenant_id", data.tenant_id)
        .eq("status", "ready").order("updated_at", { ascending: false }).limit(200),
      context.supabase.from("data_prep_pipelines")
        .select("id, name, status, updated_at").eq("tenant_id", data.tenant_id)
        .eq("status", "approved").order("updated_at", { ascending: false }).limit(200),
      context.supabase.from("aidp_documents")
        .select("id, original_filename, status, updated_at").eq("tenant_id", data.tenant_id)
        .in("status", ["approved", "completed"]).order("updated_at", { ascending: false }).limit(200),
      context.supabase.from("rekon_inline_api_sources")
        .select("id, name, method, url, updated_at").eq("tenant_id", data.tenant_id)
        .order("updated_at", { ascending: false }).limit(200),
      context.supabase.from("rekon_db_connections")
        .select("id, name, dialect, updated_at").eq("tenant_id", data.tenant_id)
        .order("updated_at", { ascending: false }).limit(200),
    ]);
    return {
      existing: existing.data ?? [],
      refined: pipelines.data ?? [],
      pdf: aidp.data ?? [],
      api: apis.data ?? [],
      database: dbs.data ?? [],
    };
  });

// ──────────────────────────────────────────────────────────────────────
// Preview a side: returns inferred columns + first 100 rows
// FILE/PASTE rows are parsed client-side; this fn handles EXISTING/REFINED/PDF/API/DATABASE.
// ──────────────────────────────────────────────────────────────────────
const PreviewInput = z.object({
  tenant_id: tid,
  source_type: z.enum(["existing", "refined", "pdf", "api", "database"]),
  ref_id: z.string().uuid().optional(),
  inline: z.object({
    url: z.string().url().optional(),
    method: z.string().optional(),
    jsonpath: z.string().optional(),
  }).optional(),
});

function inferColumns(rows: any[]): { name: string; type: string }[] {
  if (!rows.length) return [];
  const keys = Object.keys(rows[0] ?? {});
  return keys.map((k) => {
    const sample = rows.slice(0, 50).map((r) => r?.[k]).filter((v) => v != null && v !== "");
    let type: string = "string";
    if (sample.length && sample.every((v) => typeof v === "boolean" || /^(true|false)$/iu.test(String(v)))) type = "boolean";
    else if (sample.length && sample.every((v) => !isNaN(Number(v)))) type = "number";
    else if (sample.length && sample.every((v) => isDateLike(String(v)))) type = "date";
    return { name: k, type };
  });
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function recordRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.map(jsonRecord).filter((row): row is Record<string, unknown> => Boolean(row))
    : [];
}

function rowsFromLegacyAidpExtraction(extraction: unknown): Array<Record<string, unknown>> {
  const value = jsonRecord(extraction);
  const directRows = recordRows(extraction);
  if (directRows.length > 0) return directRows;
  const nestedRows = recordRows(value?.rows);
  if (nestedRows.length > 0) return nestedRows;
  const firstTable = recordRows(value?.tables)[0];
  const tableRows = recordRows(firstTable?.rows);
  if (tableRows.length > 0) return tableRows;
  const fields = recordRows(value?.fields);
  if (fields.length > 0) {
    return [fields.reduce((row: Record<string, unknown>, field) => ({
      ...row,
      [String(field.name ?? field.label)]: field.value,
    }), {})];
  }
  return value && Object.keys(value).length > 0 ? [value] : [];
}

async function loadAidpRows(supabase: SupabaseClient<Database>, tenantId: string, documentId: string) {
  const { data: document, error } = await supabase.from("aidp_documents")
    .select("id,status,extraction,original_filename").eq("id", documentId)
    .eq("tenant_id", tenantId).in("status", ["approved", "completed"]).maybeSingle();
  if (error || !document) throw new Error("Approved AIDP extraction not found");
  const { data: outputs, error: outputError } = await supabase.from("aidp_outputs")
    .select("entity_type_id,value_text,value_number,value_date,value_json,aidp_entity_types!inner(key)")
    .eq("tenant_id", tenantId).eq("document_id", documentId).is("superseded_at", null);
  if (outputError) throw new Error("AIDP approved outputs could not be loaded");
  const row: Record<string, unknown> = {};
  for (const output of outputs ?? []) {
    const entity = Array.isArray(output.aidp_entity_types)
      ? output.aidp_entity_types[0]
      : output.aidp_entity_types;
    const key = entity?.key;
    if (!key) continue;
    row[key] = output.value_json ?? output.value_number ?? output.value_date ?? output.value_text;
  }
  if (Object.keys(row).length > 0) return { document, rows: [row] };
  return { document, rows: rowsFromLegacyAidpExtraction(document.extraction) };
}

export const previewWizardSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => PreviewInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    let rows: any[] = [];
    if (data.source_type === "existing" && data.ref_id) {
      const { data: ups } = await context.supabase
        .from("workspace_data_source_uploads")
        .select("rows").eq("data_source_id", data.ref_id).eq("tenant_id", data.tenant_id)
        .order("created_at", { ascending: false }).limit(1);
      rows = (ups?.[0]?.rows as any[]) ?? [];
    } else if (data.source_type === "refined" && data.ref_id) {
      const { data: pipe } = await context.supabase
        .from("data_prep_pipelines").select("output_data_source_id").eq("id", data.ref_id)
        .eq("tenant_id", data.tenant_id).eq("status", "approved").maybeSingle();
      const outId = (pipe as any)?.output_data_source_id;
      if (outId) {
        const { data: ups } = await context.supabase
          .from("workspace_data_source_uploads").select("rows")
          .eq("data_source_id", outId).eq("tenant_id", data.tenant_id)
          .order("created_at", { ascending: false }).limit(1);
        rows = (ups?.[0]?.rows as any[]) ?? [];
      }
    } else if (data.source_type === "pdf" && data.ref_id) {
      rows = (await loadAidpRows(context.supabase, data.tenant_id, data.ref_id)).rows;
    } else if (data.source_type === "api" && data.ref_id) {
      const { data: cfg } = await context.supabase
        .from("rekon_inline_api_sources").select("*").eq("id", data.ref_id)
        .eq("tenant_id", data.tenant_id).maybeSingle();
      if (!cfg) throw new Error("API source not found");
      try {
        await assertSafeOutboundUrl((cfg as any).url);
        const res = await safeFetch((cfg as any).url, {
          method: (cfg as any).method ?? "GET",
          headers: { Accept: "application/json", ...(((cfg as any).headers as any) ?? {}) },
          body: (cfg as any).body ?? undefined,
        });
        const json: any = await res.json();
        const jp = (cfg as any).jsonpath as string | null;
        let arr: any = json;
        if (jp) for (const seg of jp.split(".").filter(Boolean)) arr = arr?.[seg];
        rows = Array.isArray(arr) ? arr : [];
      } catch (e: any) {
        throw new Error(`API fetch failed: ${e.message}`);
      }
    } else if (data.source_type === "database") {
      // Stub: actual DSN exec lives in connectors.server; returning empty here keeps
      // the wizard flow honest — preview will show "configure & run schedule" hint.
      rows = [];
    }
    rows = rows.slice(0, 100);
    return { columns: inferColumns(rows), rows, row_count: rows.length };
  });

// ──────────────────────────────────────────────────────────────────────
// Auto-detect mapping suggestion
// ──────────────────────────────────────────────────────────────────────
export const suggestMapping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: tid,
    sides: z.array(z.object({ side_id: z.string(), columns: z.array(z.string()) })).min(1).max(3),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    return suggestWizardMapping(data.sides);
  });

// ──────────────────────────────────────────────────────────────────────
// Natural-language mapping (AI)
// ──────────────────────────────────────────────────────────────────────
export const nlMapping = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: tid,
    prompt: z.string().min(3).max(2000),
    sides: z.array(z.object({ side_id: z.string(), columns: z.array(z.string()) })).min(1).max(3),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    const { enforceServerFnRateLimit } = await import("@/lib/rate-limit.server");
    await enforceServerFnRateLimit(
      context.supabase, `rekon.nl_map:${data.tenant_id}:${context.userId}`,
      3600, 60, { tenant_id: data.tenant_id, user_id: context.userId, event_type: "rate_limit.nl_mapping" },
    );
    const { resolveModelVersion, buildModelHandle, parseStructuredPredictionText } =
      await import("@/lib/aidp-predict.server");
    const { recordUsage } = await import("@/lib/ai-metering.server");
    const resolved = await resolveModelVersion(context.supabase, data.tenant_id, null, undefined);
    const system = `You map columns across reconciliation sides. Return STRICT JSON only:
{"mappings":{"<key>":{"<side_id>":"<column_name_from_that_side_or_empty>"}},"keys":[],"amount":"","date":"","rules":[]}
Use ONLY column names provided. Never invent columns.`;
    const user = `User request: ${data.prompt}\n\nSides:\n${data.sides.map((s) =>
      `${s.side_id}: [${s.columns.join(", ")}]`).join("\n")}`;

    const { generateObject, NoObjectGeneratedError } = await import("ai");
    const model = buildModelHandle(resolved);
    const planSchema = z.object({
      mappings: z.record(z.string(), z.record(z.string(), z.string())),
      keys: z.array(z.string()).default([]),
      amount: z.string().default(""),
      date: z.string().default(""),
      rules: z.array(z.unknown()).default([]),
    });
    let parsed: unknown;
    let tokensIn = 0;
    let tokensOut = 0;
    try {
      const result = await generateObject({
        model,
        schema: planSchema,
        system,
        messages: [{ role: "user", content: user }],
        temperature: 0,
        abortSignal: AbortSignal.timeout(60_000),
      });
      parsed = result.object;
      tokensIn = result.usage?.inputTokens ?? 0;
      tokensOut = result.usage?.outputTokens ?? 0;
    } catch (error: unknown) {
      if (NoObjectGeneratedError.isInstance(error) && error.text) {
        const recovered = planSchema.safeParse(parseStructuredPredictionText(error.text));
        if (!recovered.success) throw new Error("AI returned an invalid structured mapping plan");
        parsed = recovered.data;
        const usage = error.usage as { inputTokens?: number; outputTokens?: number } | undefined;
        tokensIn = usage?.inputTokens ?? 0;
        tokensOut = usage?.outputTokens ?? 0;
      } else {
        const msg = error instanceof Error ? error.message : String(error);
        if (/429|rate/iu.test(msg)) throw new Error("AI rate limit — retry shortly");
        if (/402|credit/iu.test(msg)) throw new Error("AI credits exhausted");
        throw new Error(`AI error: ${msg}`);
      }
    }
    await recordUsage(context.supabase, {
      tenant_id: data.tenant_id,
      user_id: context.userId,
      scope: "schema_map",
      model: resolved.model,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      meta: { feature: "recon_natural_language_mapping", model_source: resolved.source },
    });
    return validateWizardMappingPlan(parsed, data.sides);
  });

// ──────────────────────────────────────────────────────────────────────
// Save wizard → recon_definitions
// ──────────────────────────────────────────────────────────────────────
const SaveInput = z.object({
  tenant_id: tid,
  owner_bu_ids: z.array(tid).min(1).max(100),
  mode: z.enum(["one_sided", "two_sided", "three_sided"]),
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional().nullable(),
  sides: z.array(z.object({
    side_id: z.string().min(1).max(32),
    label: z.string().min(1).max(80),
    source_type: z.enum(["file", "paste", "api", "existing", "refined", "database", "pdf"]),
    ref_id: z.string().optional().nullable(),
    columns: z.array(z.string().min(1).max(120)).min(1).max(500),
    rows: z.array(z.record(z.string(), z.unknown())).max(5000).default([]),
  })).min(1).max(3),
  mappings: z.record(z.string(), z.record(z.string(), z.string())),
  keys: z.array(z.string()).default([]),
  amount_field: z.string().optional().nullable(),
  date_field: z.string().optional().nullable(),
  rules: z.array(z.unknown()).max(100).default([]),
  wizard_meta: z.record(z.string(), z.unknown()).optional(),
});

export const saveDefinitionFromWizard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => SaveInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    const createdSourceIds: string[] = [];
    const sides = [];
    try {
      for (const side of data.sides) {
        let dataSourceId: string | null = null;
        if (side.source_type === "existing") {
          if (!side.ref_id) throw new Error(`${side.label}: select an existing data source`);
          const { data: source, error } = await context.supabase.from("workspace_data_sources")
            .select("id").eq("id", side.ref_id).eq("tenant_id", data.tenant_id).maybeSingle();
          if (error || !source) throw new Error(`${side.label}: existing data source not found`);
          dataSourceId = source.id;
        } else if (side.source_type === "refined") {
          if (!side.ref_id) throw new Error(`${side.label}: select an approved Data Prep pipeline`);
          const { data: pipeline, error } = await context.supabase.from("data_prep_pipelines")
            .select("output_data_source_id,status").eq("id", side.ref_id)
            .eq("tenant_id", data.tenant_id).eq("status", "approved").maybeSingle();
          if (error || !pipeline?.output_data_source_id) {
            throw new Error(`${side.label}: approved refined output not found`);
          }
          dataSourceId = pipeline.output_data_source_id;
        } else {
          if (side.source_type === "database") {
            throw new Error(`${side.label}: run the database connector into a governed data source, then select Existing`);
          }
          if (!["file", "paste", "api", "pdf"].includes(side.source_type)) {
            throw new Error(`${side.label}: unsupported source type`);
          }
          if (side.rows.length === 0) throw new Error(`${side.label}: source preview contains no rows`);
          const serialized = JSON.stringify(side.rows);
          const bytes = new TextEncoder().encode(serialized);
          if (bytes.byteLength > 5 * 1024 * 1024) {
            throw new Error(`${side.label}: source snapshot exceeds the 5 MiB wizard limit`);
          }
          const inferred = inferColumns(side.rows);
          const sourceType = side.source_type === "file" ? "csv"
            : side.source_type === "paste" ? "manual"
              : side.source_type === "api" ? "api" : "json";
          const sourceName = `${data.name} — ${side.label}`.slice(0, 80);
          const { data: source, error: sourceError } = await context.supabase
            .from("workspace_data_sources").insert({
              tenant_id: data.tenant_id,
              name: sourceName,
              description: `Immutable ${side.source_type} snapshot created by ReconIQ Studio`,
              source_type: sourceType,
              connection_config: { wizard_source_type: side.source_type, source_ref_id: side.ref_id ?? null } as Json,
              created_by: context.userId,
            }).select("id").single();
          if (sourceError || !source) throw new Error(`${side.label}: source snapshot could not be created`);
          createdSourceIds.push(source.id);
          const digest = await crypto.subtle.digest("SHA-256", bytes);
          const contentSha256 = Array.from(new Uint8Array(digest))
            .map((value) => value.toString(16).padStart(2, "0")).join("");
          const columns = inferred.map((column) => ({
            name: column.name,
            inferred_type: column.type,
            nullable: side.rows.some((row) => row[column.name] === null || row[column.name] === undefined || row[column.name] === ""),
            sample: String(side.rows.find((row) => row[column.name] !== null && row[column.name] !== undefined)?.[column.name] ?? "").slice(0, 80),
          }));
          const { error: uploadError } = await context.supabase.from("workspace_data_source_uploads")
            .insert({
              data_source_id: source.id,
              tenant_id: data.tenant_id,
              filename: `recon-wizard-${side.side_id.toLowerCase()}-${side.source_type}.json`,
              mime_type: "application/json",
              size_bytes: bytes.byteLength,
              row_count: side.rows.length,
              columns: columns as Json,
              sample_rows: side.rows.slice(0, 10) as Json,
              rows: side.rows as Json,
              content_sha256: contentSha256,
              uploaded_by: context.userId,
            });
          if (uploadError) throw new Error(`${side.label}: source snapshot could not be stored`);
          const { error: sourceUpdateError } = await context.supabase.from("workspace_data_sources")
            .update({ inferred_schema: columns as Json, sample_rows: side.rows.slice(0, 10) as Json, row_count: side.rows.length, status: "ready" })
            .eq("id", source.id).eq("tenant_id", data.tenant_id);
          if (sourceUpdateError) throw new Error(`${side.label}: source snapshot could not be finalized`);
          dataSourceId = source.id;
        }
        sides.push({
          side_id: side.side_id,
          label: side.label,
          key_fields: data.keys,
          amount_field: data.amount_field ?? null,
          data_source_id: dataSourceId,
          source_type: side.source_type,
          ref_id: side.ref_id,
        });
      }
    } catch (error) {
      if (createdSourceIds.length) {
        await context.supabase.from("workspace_data_sources")
          .delete().in("id", createdSourceIds).eq("tenant_id", data.tenant_id);
      }
      throw error;
    }
    const rules = data.rules.length
      ? data.rules
      : compileWizardRules({
          mode: data.mode,
          sides: data.sides.map((side) => ({ side_id: side.side_id, columns: side.columns })),
          mappings: data.mappings,
          keys: data.keys,
          amountField: data.amount_field,
          dateField: data.date_field,
        });
    let def: { id: string; recon_code: string };
    try {
      def = await createReconDefinitionWithOwners(context.supabase, {
        tenant_id: data.tenant_id,
        name: data.name,
        description: data.description,
        recon_type: data.mode,
        sides,
        rules,
        owner_bu_ids: data.owner_bu_ids,
      });
    } catch (error) {
      if (createdSourceIds.length) {
        await context.supabase.from("workspace_data_sources")
          .delete().in("id", createdSourceIds).eq("tenant_id", data.tenant_id);
      }
      throw error;
    }

    // v1 snapshot for version history
    const snapshot = {
      name: data.name,
      description: data.description ?? null,
      recon_type: data.mode,
      sides,
      rules,
      mappings: data.mappings,
      keys: data.keys,
      amount_field: data.amount_field ?? null,
      date_field: data.date_field ?? null,
      wizard_meta: data.wizard_meta ?? null,
    };
    const { error: versionError } = await context.supabase.from("recon_definition_versions").insert({
      tenant_id: data.tenant_id,
      recon_definition_id: def.id,
      version_number: 1,
      message: "Initial version from ReconIQ Studio wizard",
      snapshot: snapshot as any,
      diff: null,
      created_by: context.userId,
    } as any);
    if (versionError) {
      // The owner-bound RPC has already committed the definition, its BU links,
      // grants, and primary audit. Do not delete those governed records or their
      // source snapshots as a best-effort compensation for a later write.
      throw new Error(`Reconciliation ${def.recon_code} was created, but its version history is unavailable. Do not create it again; ask an administrator to repair it.`);
    }

    const { error: auditError } = await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "workspace",
      action: "recon.wizard.create", resource_type: "recon_definition",
      resource_id: def.id,
      context: {
        recon_code: def.recon_code,
        mode: data.mode,
        sides: data.sides.map((s) => ({ side_id: s.side_id, source_type: s.source_type, ref_id: s.ref_id ?? null, columns: s.columns.length })),
        keys: data.keys,
        amount_field: data.amount_field ?? null,
        date_field: data.date_field ?? null,
        map_mode: (data.wizard_meta as any)?.map_mode ?? null,
      },
    } as any);
    if (auditError) {
      // The atomic RPC's recon.create audit is already durable. The optional
      // wizard-detail audit can be retried administratively without undoing it.
      return { id: def.id, recon_code: def.recon_code, version: 1, audit_warning: true };
    }
    return { id: def.id, recon_code: def.recon_code, version: 1 };
  });

// ──────────────────────────────────────────────────────────────────────
// Save / load draft (autosave)
// ──────────────────────────────────────────────────────────────────────
export const saveWizardDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: tid,
    mode: z.string(),
    step: z.number().int().min(0).max(10),
    draft: z.record(z.string(), z.any()),
    id: z.string().uuid().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    const payload: any = {
      tenant_id: data.tenant_id, user_id: context.userId,
      mode: data.mode, step: data.step, draft: data.draft,
    };
    if (data.id) payload.id = data.id;
    const { data: row, error } = await context.supabase
      .from("rekon_wizard_drafts").upsert(payload).select("id").single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const listWizardDrafts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: tid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows } = await context.supabase
      .from("rekon_wizard_drafts").select("*").eq("tenant_id", data.tenant_id)
      .eq("user_id", context.userId).order("updated_at", { ascending: false }).limit(10);
    return rows ?? [];
  });

// ──────────────────────────────────────────────────────────────────────
// Saved API / DB connection CRUD (minimal)
// ──────────────────────────────────────────────────────────────────────
export const saveApiSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: tid,
    id: z.string().uuid().optional(),
    name: z.string().min(1).max(120),
    method: z.enum(["GET", "POST"]).default("GET"),
    url: z.string().url(),
    headers: z.record(z.string(), z.string()).default({}),
    body: z.string().optional().nullable(),
    jsonpath: z.string().optional().nullable(),
    auth_secret_ref: z.string().optional().nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    if (data.auth_secret_ref && !isSafeEnvName(data.auth_secret_ref)) {
      throw new Error("auth_secret_ref must match an allow-listed prefix (FVI_TENANT_/FVI_LLM_/FVI_CONNECTOR_/FVI_API_/FVI_DB_)");
    }
    try { assertSafeOutboundUrl(data.url); } catch (e: any) { throw new Error(`Invalid url: ${e.message}`); }
    const payload: any = { ...data, created_by: context.userId };
    if (!data.id) delete payload.id;
    const { data: row, error } = await context.supabase
      .from("rekon_inline_api_sources").upsert(payload).select("id").single();
    if (error) throw new Error(error.message);
    return row;
  });

export const saveDbConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: tid,
    id: z.string().uuid().optional(),
    name: z.string().min(1).max(120),
    dialect: z.enum(["postgres", "mysql", "mssql", "snowflake", "bigquery"]),
    host: z.string().optional().nullable(),
    port: z.number().int().optional().nullable(),
    database: z.string().optional().nullable(),
    username: z.string().optional().nullable(),
    secret_ref: z.string().optional().nullable(),
    ssl: z.boolean().default(true),
    default_sql: z.string().optional().nullable(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    if (data.secret_ref && !isSafeEnvName(data.secret_ref)) {
      throw new Error("secret_ref must match an allow-listed prefix (FVI_TENANT_/FVI_DB_/FVI_CONNECTOR_)");
    }
    const payload: any = { ...data, created_by: context.userId };
    if (!data.id) delete payload.id;
    const { data: row, error } = await context.supabase
      .from("rekon_db_connections").upsert(payload).select("id").single();
    if (error) throw new Error(error.message);
    return row;
  });

// ──────────────────────────────────────────────────────────────────────
// Test a wizard connection (verifies reachability + sample schema/rows)
// ──────────────────────────────────────────────────────────────────────
export const testWizardConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: tid,
    source_type: z.enum(["existing", "refined", "pdf", "api", "database"]),
    ref_id: z.string().uuid().optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const started = Date.now();
    try {
      if (data.source_type === "api") {
        if (!data.ref_id) throw new Error("Pick a saved API source first");
        const { data: api, error } = await context.supabase
          .from("rekon_inline_api_sources").select("*").eq("id", data.ref_id)
          .eq("tenant_id", data.tenant_id).maybeSingle();
        if (error || !api) throw new Error("API source not found");
        const headers: Record<string, string> = { Accept: "application/json" };
        const a: any = api;
        const secretVal = readSafeEnv(a.auth_secret_ref);
        if (secretVal) headers.Authorization = `Bearer ${secretVal}`;
        try { assertSafeOutboundUrl(a.url); } catch (e: any) {
          return { ok: false, status: 400, latency_ms: Date.now() - started, detail: `Blocked URL: ${e.message}`, columns: [], sample_rows: 0 };
        }
        const res = await safeFetch(a.url, { method: a.method ?? "GET", headers, signal: AbortSignal.timeout(10_000) });
        const text = await res.text();
        let sampleRows = 0, sampleCols: string[] = [];
        try {
          const json = JSON.parse(text);
          const arr = Array.isArray(json) ? json : (json?.data ?? json?.rows ?? []);
          if (Array.isArray(arr) && arr.length) {
            sampleRows = arr.length;
            sampleCols = Object.keys(arr[0] ?? {}).slice(0, 25);
          }
        } catch {/* not JSON, that's fine */}
        return {
          ok: res.ok, status: res.status, latency_ms: Date.now() - started,
          detail: res.ok ? `HTTP ${res.status} · ${sampleRows} sample rows · ${sampleCols.length} columns detected` : `HTTP ${res.status}`,
          columns: sampleCols, sample_rows: sampleRows,
        };
      }
      if (data.source_type === "database") {
        if (!data.ref_id) throw new Error("Pick a saved DB connection first");
        const { data: db, error } = await context.supabase
          .from("rekon_db_connections").select("name, dialect, host, port, database, secret_ref")
          .eq("id", data.ref_id).eq("tenant_id", data.tenant_id).maybeSingle();
        if (error || !db) throw new Error("DB connection not found");
        const d: any = db;
        const reachable = !!d.host && !!d.database;
        const secretPresent = !!readSafeEnv(d.secret_ref);
        return {
          ok: reachable && secretPresent, status: reachable ? 200 : 400, latency_ms: Date.now() - started,
          detail: reachable
            ? (secretPresent ? `Config valid · ${d.dialect}@${d.host}:${d.port ?? "?"}/${d.database} · secret present` : `Config valid but secret '${d.secret_ref ?? "(unset)"}' is not loaded in this environment`)
            : "Host/database missing — edit the connection",
          columns: [], sample_rows: 0,
        };
      }
      if (data.source_type === "existing") {
        if (!data.ref_id) throw new Error("Pick a data source first");
        const { data: src, error } = await context.supabase
          .from("workspace_data_sources").select("id, name, updated_at")
          .eq("id", data.ref_id).eq("tenant_id", data.tenant_id).maybeSingle();
        if (error || !src) throw new Error("Source not found");
        const { count } = await context.supabase
          .from("workspace_data_source_uploads").select("id", { count: "exact", head: true })
          .eq("data_source_id", data.ref_id).eq("tenant_id", data.tenant_id);
        return {
          ok: true, status: 200, latency_ms: Date.now() - started,
          detail: `Linked · ${count ?? 0} historical upload(s)`,
          columns: [], sample_rows: count ?? 0,
        };
      }
      if (data.source_type === "refined") {
        if (!data.ref_id) throw new Error("Pick a pipeline first");
        const { data: pipe, error } = await context.supabase
          .from("data_prep_pipelines").select("id, name, status, output_data_source_id")
          .eq("id", data.ref_id).eq("tenant_id", data.tenant_id).maybeSingle();
        if (error || !pipe) throw new Error("Pipeline not found");
        const p: any = pipe;
        return {
          ok: p.status === "approved" && !!p.output_data_source_id,
          status: 200, latency_ms: Date.now() - started,
          detail: p.output_data_source_id ? `Pipeline approved · refined dataset attached` : `Pipeline has not produced a refined dataset yet`,
          columns: [], sample_rows: 0,
        };
      }
      if (data.source_type === "pdf") {
        if (!data.ref_id) throw new Error("Pick an AIDP extraction first");
        const { rows } = await loadAidpRows(context.supabase, data.tenant_id, data.ref_id);
        const rowsCount = rows.length;
        return {
          ok: rowsCount > 0,
          status: 200, latency_ms: Date.now() - started,
          detail: rowsCount > 0 ? `Extraction ready · ${rowsCount} record(s)` : `Approved document has no current outputs`,
          columns: rowsCount > 0 ? Object.keys(rows[0] ?? {}).slice(0, 25) : [],
          sample_rows: rowsCount,
        };
      }
      throw new Error("Unsupported source type");
    } catch (e: any) {
      return { ok: false, status: 0, latency_ms: Date.now() - started, detail: e.message ?? "Test failed", columns: [], sample_rows: 0 };
    }
  });

// ──────────────────────────────────────────────────────────────────────
// Compare two wizard-created reconciliation versions
// ──────────────────────────────────────────────────────────────────────
export const compareReconVersions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    recon_definition_id: z.string().uuid(),
    version_a: z.number().int().positive(),
    version_b: z.number().int().positive(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("recon_definition_versions")
      .select("version_number, message, snapshot, created_at, created_by")
      .eq("recon_definition_id", data.recon_definition_id)
      .in("version_number", [data.version_a, data.version_b]);
    if (error) throw new Error(error.message);
    const a = rows?.find((r: any) => r.version_number === data.version_a);
    const b = rows?.find((r: any) => r.version_number === data.version_b);
    if (!a || !b) throw new Error("One or both versions not found");
    const sa: any = a.snapshot ?? {};
    const sb: any = b.snapshot ?? {};

    // Compute scalar diffs
    const scalarKeys = ["name", "description", "recon_type", "amount_field", "date_field"];
    const scalars = scalarKeys.map((k) => ({ field: k, before: sa[k] ?? null, after: sb[k] ?? null, changed: JSON.stringify(sa[k] ?? null) !== JSON.stringify(sb[k] ?? null) }));

    // Keys diff
    const ka = new Set<string>(sa.keys ?? []);
    const kb = new Set<string>(sb.keys ?? []);
    const keys_added = [...kb].filter((k) => !ka.has(k));
    const keys_removed = [...ka].filter((k) => !kb.has(k));

    // Sides (connectors) diff
    const sideA: any[] = sa.sides ?? [];
    const sideB: any[] = sb.sides ?? [];
    const sideIds = Array.from(new Set([...sideA.map((s: any) => s.side_id), ...sideB.map((s: any) => s.side_id)]));
    const sides = sideIds.map((id) => {
      const x = sideA.find((s: any) => s.side_id === id);
      const y = sideB.find((s: any) => s.side_id === id);
      const before = x ? { source_type: x.source_type, ref_id: x.ref_id ?? null, label: x.label } : null;
      const after = y ? { source_type: y.source_type, ref_id: y.ref_id ?? null, label: y.label } : null;
      const changed = JSON.stringify(before) !== JSON.stringify(after);
      return { side_id: id, before, after, changed };
    });

    // Mappings diff
    const ma: Record<string, Record<string, string>> = sa.mappings ?? {};
    const mb: Record<string, Record<string, string>> = sb.mappings ?? {};
    const fields = Array.from(new Set([...Object.keys(ma), ...Object.keys(mb)])).sort();
    const mappings = fields.map((f) => {
      const before = ma[f] ?? null;
      const after = mb[f] ?? null;
      const changed = JSON.stringify(before) !== JSON.stringify(after);
      return { field: f, before, after, changed };
    });

    return {
      a: { version_number: a.version_number, message: a.message, created_at: a.created_at, created_by: a.created_by },
      b: { version_number: b.version_number, message: b.message, created_at: b.created_at, created_by: b.created_by },
      scalars, keys_added, keys_removed, sides, mappings,
      summary: {
        scalars_changed: scalars.filter((s) => s.changed).length,
        sides_changed: sides.filter((s) => s.changed).length,
        mappings_changed: mappings.filter((m) => m.changed).length,
        keys_changed: keys_added.length + keys_removed.length,
      },
    };
  });
