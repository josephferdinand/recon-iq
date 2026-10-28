import type { SupabaseClient } from "@supabase/supabase-js";
import { CopilotRefusal, type ProviderChoice } from "./contracts";

// Metadata only: no plaintext, fingerprints, private key names or endpoints in the browser catalog.
export async function listConfiguredProviders(sb: SupabaseClient, tenantId: string | null): Promise<ProviderChoice[]> {
  let q = sb.from("llm_providers").select("id,display_name,provider,model,model_catalog_id,provider_instance_id")
    .eq("is_active", true).eq("scope", tenantId ? "tenant" : "platform")
    .order("priority", { ascending: true, nullsFirst: false }).order("id").limit(100);
  q = tenantId ? q.eq("tenant_id", tenantId) : q.is("tenant_id", null);
  const { data, error } = await q;
  if (error) throw new CopilotRefusal(503, "copilot.catalog_unavailable", "Provider choices could not be loaded.");
  const choices: ProviderChoice[] = [];
  for (const row of (data ?? []) as any[]) {
    let reason: string | null = null, maxInputTokens: number | null = null, maxOutputTokens: number | null = null;
    if (!row.model_catalog_id || !row.provider_instance_id) reason = "Approved binding required";
    else {
      const { data: model, error: me } = await sb.from("ai_model_catalog")
        .select("id,provider_instance_id,model_key,approval_status,availability_status,max_input_tokens,max_output_tokens,context_window")
        .eq("id", row.model_catalog_id).maybeSingle();
      const { data: instance, error: ie } = await sb.from("ai_provider_instances")
        .select("id,status,tenant_id,provider_code").eq("id", row.provider_instance_id).maybeSingle();
      const m = model as any, p = instance as any;
      if (me || ie) throw new CopilotRefusal(503, "copilot.catalog_unavailable", "Provider choices could not be loaded.");
      if (!m || !p || m.provider_instance_id !== p.id || m.model_key !== row.model || p.tenant_id !== tenantId)
        reason = "Current binding required";
      else if (m.approval_status !== "approved" || !["available", "limited"].includes(m.availability_status) || p.status !== "active")
        reason = "Model or provider unavailable";
      else if (![m.max_input_tokens, m.max_output_tokens, m.context_window].every(n => Number.isSafeInteger(n) && n > 0) || m.context_window <= m.max_output_tokens)
        reason = "Verified token limits required";
      else {
        maxInputTokens = Math.min(m.max_input_tokens, m.context_window - m.max_output_tokens);
        maxOutputTokens = m.max_output_tokens;
        const now = new Date().toISOString();
        const { data: rates, error: re } = await sb.from("ai_model_pricing")
          .select("input_usd_per_1m,output_usd_per_1m,effective_at,expires_at")
          .eq("provider_code", p.provider_code).eq("model_key", m.model_key).eq("active", true).eq("currency", "USD")
          .lte("effective_at", now).or(`expires_at.is.null,expires_at.gt.${now}`)
          .order("effective_at", { ascending: false }).order("id").limit(1).maybeSingle();
        if (re) throw new CopilotRefusal(503, "copilot.catalog_unavailable", "Provider choices could not be loaded.");
        if (!rates || ![rates.input_usd_per_1m, rates.output_usd_per_1m].every(n => Number.isFinite(Number(n)) && Number(n) > 0))
          reason = "Current verified pricing required";
      }
    }
    choices.push({ id: row.id, label: row.display_name || row.provider, provider: row.provider, model: row.model,
      available: reason === null, reason, maxInputTokens, maxOutputTokens });
  }
  return choices;
}
