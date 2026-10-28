import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  compileReconStarterTemplate,
  starterTemplateFields,
  type StarterBinding,
  type StarterTemplate,
} from "@/lib/recon-template-compiler";
import { z } from "zod";

export const listReconTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ asset_class: z.string().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("recon_definition_templates")
      .select("*").eq("status", "published").order("asset_class");
    if (data.asset_class) q = q.eq("asset_class", data.asset_class);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listAssetClassPresets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator(() => ({}))
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("asset_class_presets").select("*").eq("is_active", true).order("category");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const installReconTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      template_id: z.string().uuid(),
      owner_bu_ids: z.array(z.string().uuid()).min(1).max(50)
        .refine((ids) => new Set(ids).size === ids.length, "Choose each owning business unit once"),
      name_override: z.string().min(2).max(120).optional(),
      bindings: z.array(z.object({
        data_source_id: z.string().uuid(),
        field_map: z.record(z.string(), z.string().min(1)),
      })).min(1).max(3),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: tpl, error: tErr } = await context.supabase
      .from("recon_definition_templates").select("*").eq("id", data.template_id).single();
    if (tErr || !tpl) throw new Error(tErr?.message ?? "Template not found");
    const template = tpl as unknown as StarterTemplate & { title: string };
    const bindings = data.bindings as StarterBinding[];
    if (bindings.length !== template.legs.length) {
      throw new Error("Every template leg must be mapped to one data source");
    }

    const sourceIds = bindings.map((binding) => binding.data_source_id);
    const [{ data: sources, error: sourceError }, { data: uploads, error: uploadError }] =
      await Promise.all([
        context.supabase.from("workspace_data_sources")
          .select("id,inferred_schema,sample_rows")
          .eq("tenant_id", data.tenant_id)
          .in("id", sourceIds),
        context.supabase.from("workspace_data_source_uploads")
          .select("data_source_id,columns,created_at")
          .in("data_source_id", sourceIds)
          .order("created_at", { ascending: false }),
      ]);
    if (sourceError) throw new Error(sourceError.message);
    if (uploadError) throw new Error(uploadError.message);
    if ((sources?.length ?? 0) !== sourceIds.length) {
      throw new Error("Every selected data source must belong to the active tenant");
    }
    const { data: ownerUnits, error: ownerError } = await context.supabase.from("business_units")
      .select("id,is_archived")
      .eq("tenant_id", data.tenant_id)
      .in("id", data.owner_bu_ids)
      .eq("is_archived", false);
    if (ownerError || (ownerUnits?.length ?? 0) !== data.owner_bu_ids.length) {
      throw new Error("Choose active owning business units from the selected tenant");
    }

    const requiredFields = starterTemplateFields(template);
    for (const binding of bindings) {
      const source = sources?.find((candidate) => candidate.id === binding.data_source_id);
      const sourceUploads = uploads?.filter((upload) => upload.data_source_id === binding.data_source_id) ?? [];
      const fields = new Set<string>();
      const schema = source?.inferred_schema;
      if (schema && typeof schema === "object" && !Array.isArray(schema)) {
        Object.keys(schema).forEach((field) => fields.add(field));
      }
      const samples = Array.isArray(source?.sample_rows) ? source.sample_rows : [];
      const sample = samples[0];
      if (sample && typeof sample === "object" && !Array.isArray(sample)) {
        Object.keys(sample).forEach((field) => fields.add(field));
      }
      for (const upload of sourceUploads) {
        if (Array.isArray(upload.columns)) {
          upload.columns.filter((field): field is string => typeof field === "string")
            .forEach((field) => fields.add(field));
        }
      }
      for (const field of requiredFields) {
        const mappedField = binding.field_map[field];
        if (!mappedField || !fields.has(mappedField)) {
          throw new Error(`Mapped field ${field} is unavailable on the selected data source`);
        }
      }
    }

    const compiled = compileReconStarterTemplate(template, bindings);
    const { data: installed, error } = await context.supabase.rpc(
      "install_recon_starter_template_atomic" as never,
      {
        _tenant_id: data.tenant_id,
        _template_id: data.template_id,
        _name: data.name_override ?? template.title,
        _sides: compiled.sides,
        _rules: compiled.rules,
        _owner_bu_ids: data.owner_bu_ids,
      } as never,
    );
    if (error) throw new Error(error.message);
    const row = (installed as unknown as Array<{ recon_definition_id: string; recon_code: string }> | null)?.[0];
    if (!row) throw new Error("Template installation did not return a reconciliation");
    return { id: row.recon_definition_id, recon_code: row.recon_code };
  });

// Collateral schedules
const tid = z.string().uuid();
export const listCollateralSchedules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: tid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("collateral_schedules").select("*")
      .eq("tenant_id", data.tenant_id).order("counterparty");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertCollateralSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      tenant_id: tid,
      counterparty: z.string().min(1).max(120),
      csa_id: z.string().max(80).optional().nullable(),
      schedule_type: z.enum(["VM", "IM", "Triparty"]).default("VM"),
      threshold_amount: z.number().nonnegative().default(0),
      minimum_transfer: z.number().nonnegative().default(0),
      rounding: z.number().nonnegative().default(0),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const payload: any = { ...data, created_by: context.userId };
    if (!data.id) delete payload.id;
    const { data: row, error } = await context.supabase
      .from("collateral_schedules").upsert(payload).select("id").single();
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: data.id ? "collateral.schedule.update" : "collateral.schedule.create",
      resource_type: "collateral_schedules", resource_id: row.id,
      context: { counterparty: data.counterparty, type: data.schedule_type },
    } as any);
    return row;
  });
