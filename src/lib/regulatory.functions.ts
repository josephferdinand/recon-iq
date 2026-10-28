import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const listRegulatoryPacks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator(() => ({}))
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("regulatory_template_packs")
      .select("id, code, title, jurisdiction, regulation, version, summary, tags, status, install_count")
      .eq("status", "published")
      .order("regulation", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listTenantPackInstalls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("regulatory_pack_installs")
      .select(
        "id, pack_id, recon_id, installed_version, installed_at, status, materialization_error, materialized_at, materialized_artifacts, pack:regulatory_template_packs(code,title,regulation)",
      )
      .eq("tenant_id", data.tenant_id)
      .order("installed_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/**
 * Materialize a regulatory pack into runnable artefacts:
 *   - ESMA / regulation field dictionary as a reference_data_table (+rows)
 *   - One data_prep_pipeline per side normalisation
 *   - A recon_definition + v1 version wired with the pack's matching rules
 * Idempotent: re-running an install will skip artefacts that already exist for the tenant by name.
 */
async function materializeInstall(
  supabase: any,
  userId: string,
  installId: string,
  tenantId: string,
  packId: string,
): Promise<{ recon_id: string; reference_table_id: string | null; pipeline_ids: string[] }> {
  await supabase
    .from("regulatory_pack_installs")
    .update({ status: "materializing", materialization_error: null })
    .eq("id", installId);

  try {
    const { data: pack, error: pErr } = await supabase
      .from("regulatory_template_packs")
      .select("code, title, version, definition")
      .eq("id", packId)
      .single();
    if (pErr || !pack) throw new Error(pErr?.message ?? "Pack not found");

    const def = (pack as any).definition ?? {};
    const reconBp = def.recon ?? {};
    const refBp = def.reference_table ?? null;
    const pipelinesBp: any[] = Array.isArray(def.pipelines) ? def.pipelines : [];
    const dictionary: any[] = Array.isArray(def.field_dictionary) ? def.field_dictionary : [];

    // ----- Reference data table (field dictionary) -----
    let referenceTableId: string | null = null;
    if (refBp?.name) {
      const { data: existingRT } = await supabase
        .from("reference_data_tables")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("name", refBp.name)
        .maybeSingle();
      if (existingRT?.id) {
        referenceTableId = existingRT.id;
      } else {
        const { data: rt, error: rtErr } = await supabase
          .from("reference_data_tables")
          .insert({
            tenant_id: tenantId,
            name: refBp.name,
            description: `Auto-generated from regulatory pack ${(pack as any).code} v${(pack as any).version}`,
            key_columns: refBp.key_columns ?? ["field_code"],
            value_columns: refBp.value_columns ?? [],
            created_by: userId,
          })
          .select("id")
          .single();
        if (rtErr) throw new Error(`Reference table: ${rtErr.message}`);
        referenceTableId = rt.id;
        if (dictionary.length) {
          const { error: versionError } = await supabase.rpc("stage_reference_data_version", {
            _tenant_id: tenantId,
            _table_id: referenceTableId,
            _rows: dictionary,
            _effective_from: new Date().toISOString().slice(0, 10),
            _effective_to: null,
            _change_note: `Initial field dictionary from regulatory pack ${pack.code} v${pack.version}`,
          });
          if (versionError) throw new Error(`Reference version: ${versionError.message}`);
        }
      }
    }

    // ----- Data prep pipelines -----
    const pipelineIds: string[] = [];
    for (const pl of pipelinesBp) {
      const { data: existingPL } = await supabase
        .from("data_prep_pipelines")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("name", pl.name)
        .maybeSingle();
      if (existingPL?.id) {
        pipelineIds.push(existingPL.id);
        continue;
      }
      const { data: created, error: plErr } = await supabase
        .from("data_prep_pipelines")
        .insert({
          tenant_id: tenantId,
          name: pl.name,
          description: pl.description ?? null,
          steps: pl.steps ?? [],
          dq_rules: pl.dq_rules ?? [],
          on_failure: pl.on_failure ?? "warn",
          enabled: true,
          created_by: userId,
          status: "draft",
        })
        .select("id")
        .single();
      if (plErr) throw new Error(`Pipeline "${pl.name}": ${plErr.message}`);
      pipelineIds.push(created.id);
    }

    // ----- Recon definition -----
    const reconName = reconBp.name ?? (pack as any).title;
    const { data: existingRecon } = await supabase
      .from("recon_definitions")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("name", reconName)
      .maybeSingle();

    let reconId: string;
    if (existingRecon?.id) {
      reconId = existingRecon.id;
    } else {
      const { data: rd, error: rdErr } = await supabase
        .from("recon_definitions")
        .insert({
          tenant_id: tenantId,
          name: reconName,
          description: `Auto-generated from ${(pack as any).code} v${(pack as any).version}. Edit sides, mappings, and tolerances to fit your data.`,
          recon_type: reconBp.recon_type ?? "two_sided",
          sides: reconBp.sides ?? [],
          rules: reconBp.rules ?? [],
          status: "draft",
          created_by: userId,
          extension: {
            source: "regulatory_pack",
            pack_code: (pack as any).code,
            pack_version: (pack as any).version,
            install_id: installId,
          },
        })
        .select("id")
        .single();
      if (rdErr) throw new Error(`Recon: ${rdErr.message}`);
      reconId = rd.id;

      await supabase.from("recon_definition_versions").insert({
        recon_definition_id: reconId,
        tenant_id: tenantId,
        version: 1,
        snapshot: {
          sides: reconBp.sides ?? [],
          rules: reconBp.rules ?? [],
          recon_type: reconBp.recon_type ?? "two_sided",
        },
        created_by: userId,
        change_note: `Initial version from regulatory pack ${(pack as any).code}`,
      } as any);
    }

    // ----- Finalize install -----
    const artifacts = {
      reference_table_id: referenceTableId,
      pipeline_ids: pipelineIds,
      recon_id: reconId,
      field_count: dictionary.length,
      pipeline_count: pipelinesBp.length,
    };
    await supabase
      .from("regulatory_pack_installs")
      .update({
        status: "ready",
        materialized_at: new Date().toISOString(),
        materialized_artifacts: artifacts,
        recon_id: reconId,
      })
      .eq("id", installId);

    await supabase.from("audit_log").insert({
      actor_user_id: userId,
      tenant_id: tenantId,
      scope: "tenant",
      action: "regulatory.pack.materialize",
      resource_type: "regulatory_pack_installs",
      resource_id: installId,
      context: { pack_code: (pack as any).code, ...artifacts },
    } as any);

    return { recon_id: reconId, reference_table_id: referenceTableId, pipeline_ids: pipelineIds };
  } catch (e: any) {
    await supabase
      .from("regulatory_pack_installs")
      .update({ status: "failed", materialization_error: e.message ?? String(e) })
      .eq("id", installId);
    throw e;
  }
}

export const installRegulatoryPack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ tenant_id: z.string().uuid(), pack_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: pack, error: pErr } = await context.supabase
      .from("regulatory_template_packs")
      .select("version, code, title")
      .eq("id", data.pack_id)
      .single();
    if (pErr || !pack) throw new Error(pErr?.message ?? "Pack not found");

    // Re-use any existing install row (unique on tenant+pack+version) so re-install is idempotent.
    const { data: existing } = await context.supabase
      .from("regulatory_pack_installs")
      .select("id")
      .eq("tenant_id", data.tenant_id)
      .eq("pack_id", data.pack_id)
      .eq("installed_version", (pack as any).version)
      .maybeSingle();

    let installId: string;
    if (existing?.id) {
      installId = existing.id;
    } else {
      const { data: row, error } = await context.supabase
        .from("regulatory_pack_installs")
        .insert({
          tenant_id: data.tenant_id,
          pack_id: data.pack_id,
          installed_by: context.userId,
          installed_version: (pack as any).version,
          status: "pending",
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      installId = row.id;
      await context.supabase.from("audit_log").insert({
        actor_user_id: context.userId,
        tenant_id: data.tenant_id,
        scope: "tenant",
        action: "regulatory.pack.install",
        resource_type: "regulatory_pack_installs",
        resource_id: installId,
        context: { pack_code: (pack as any).code, version: (pack as any).version },
      } as any);
    }

    const result = await materializeInstall(
      context.supabase,
      context.userId,
      installId,
      data.tenant_id,
      data.pack_id,
    );
    return { id: installId, ...result };
  });

export const rematerializeRegulatoryInstall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ install_id: z.string().uuid(), tenant_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("regulatory_pack_installs")
      .select("id, pack_id, tenant_id")
      .eq("id", data.install_id)
      .eq("tenant_id", data.tenant_id)
      .single();
    if (error || !row) throw new Error(error?.message ?? "Install not found");
    return materializeInstall(
      context.supabase,
      context.userId,
      row.id,
      row.tenant_id,
      row.pack_id,
    );
  });
