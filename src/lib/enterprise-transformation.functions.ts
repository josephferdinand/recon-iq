/**
 * Enterprise Transformation server functions
 * — persona journeys, evidence packs, tenant IdP.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listPersonaJourneys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("platform_persona_journeys")
      .select("*")
      .order("surface", { ascending: true })
      .order("priority", { ascending: true });
    if (error) throw new Error(error.message);
    return { rows: data ?? [] };
  });

export const listEvidencePacks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenantId?: string; framework?: string }) => d)
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    let q = supabase.from("platform_evidence_packs").select("*").order("created_at", { ascending: false }).limit(200);
    if (data.tenantId) q = q.eq("tenant_id", data.tenantId);
    if (data.framework) q = q.eq("framework", data.framework);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [] };
  });

const upsertEvidenceSchema = z.object({
  tenantId: z.string().uuid().nullable().optional(),
  framework: z.string().min(2),
  controlRef: z.string().min(1),
  periodStart: z.string(),
  periodEnd: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

export const registerEvidencePack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d) => upsertEvidenceSchema.parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("platform_evidence_packs")
      .insert({
        tenant_id: data.tenantId ?? null,
        framework: data.framework,
        control_ref: data.controlRef,
        period_start: data.periodStart,
        period_end: data.periodEnd,
        status: "ready",
        metadata: (data.metadata ?? {}) as never,
        generated_by: userId,
        generated_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listTenantIdps = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenantId: string }) => d)
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("tenant_idp_configs")
      .select("*")
      .eq("tenant_id", data.tenantId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { rows: rows ?? [] };
  });

export const upsertTenantIdp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: {
    id?: string;
    tenantId: string;
    providerKind: string;
    displayName: string;
    metadataUrl?: string | null;
    issuer?: string | null;
    clientId?: string | null;
    domains?: string[];
    enabled?: boolean;
    scimEnabled?: boolean;
    stepUpRequired?: boolean;
  }) => d)
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const payload = {
      tenant_id: data.tenantId,
      provider_kind: data.providerKind,
      display_name: data.displayName,
      metadata_url: data.metadataUrl ?? null,
      issuer: data.issuer ?? null,
      client_id: data.clientId ?? null,
      domains: data.domains ?? [],
      enabled: data.enabled ?? false,
      scim_enabled: data.scimEnabled ?? false,
      step_up_required: data.stepUpRequired ?? false,
    };
    if (data.id) {
      const { data: row, error } = await supabase
        .from("tenant_idp_configs")
        .update(payload)
        .eq("id", data.id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return row;
    }
    const { data: row, error } = await supabase
      .from("tenant_idp_configs")
      .insert(payload)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });
