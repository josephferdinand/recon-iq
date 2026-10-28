import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const tenantIdSchema = z.string().uuid();

export const exportReconDefinitions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: tenantIdSchema,
    ids: z.array(z.string().uuid()).max(500).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("recon_definitions")
      .select("recon_code, name, description, recon_type, status, sides, rules")
      .eq("tenant_id", data.tenant_id);
    if (data.ids?.length) q = q.in("id", data.ids);
    const { data: rows, error } = await q;
    if (error) throw new Error("Definitions could not be exported right now.");
    return {
      format: "fvi-recon-defs/v1",
      exported_at: new Date().toISOString(),
      count: rows?.length ?? 0,
      definitions: rows ?? [],
    };
  });

const ImportDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional().nullable(),
  recon_type: z.enum(["one_sided", "two_sided", "three_sided"]),
  // `status` is retained for reading v1 exports, but is never trusted on import.
  status: z.string().optional(),
  sides: z.array(z.record(z.string(), z.unknown())).max(3),
  rules: z.array(z.record(z.string(), z.unknown())).max(100),
});

const ImportSchema = z.object({
  format: z.literal("fvi-recon-defs/v1"),
  definitions: z.array(ImportDefinitionSchema).min(1).max(500),
});

export const importReconDefinitions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    tenant_id: tenantIdSchema,
    payload: ImportSchema,
    owner_bu_ids: z.array(z.string().uuid()).min(1).max(50)
      .refine((ids) => new Set(ids).size === ids.length, "Choose each owning business unit once"),
    mode: z.enum(["skip", "overwrite"]).default("skip"),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const definitions = data.payload.definitions.map(({ name, description, recon_type, sides, rules }) => ({
      name, description: description ?? null, recon_type, sides, rules,
    }));
    const { data: result, error } = await context.supabase.rpc(
      "import_recon_definitions_with_owners" as never,
      {
        _tenant_id: data.tenant_id,
        _definitions: definitions,
        _owner_bu_ids: data.owner_bu_ids,
        _mode: data.mode,
      } as never,
    );
    if (error || !result || typeof result !== "object") {
      throw new Error("The import could not be completed. Check the definitions and owning business units, then try again.");
    }
    const counts = result as { inserted?: unknown; updated?: unknown; skipped?: unknown };
    if (![counts.inserted, counts.updated, counts.skipped].every(Number.isInteger)) {
      throw new Error("The import could not be completed. Check the definitions and owning business units, then try again.");
    }
    return {
      inserted: counts.inserted as number,
      updated: counts.updated as number,
      skipped: counts.skipped as number,
    };
  });
