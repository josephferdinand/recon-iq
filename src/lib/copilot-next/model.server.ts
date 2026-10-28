import { createMuseCompatible } from "@/lib/ai/muse-provider.server";
import { createAnthropic } from "@/lib/ai/muse-provider.server";
import { createMuse } from "@/lib/ai/muse-provider.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveVaultSecret } from "@/lib/vault-resolver.server";
import { CopilotRefusal } from "./contracts";
import type { DispatchBinding } from "./dispatch.server";

// Adapted from canonical model-factory.server.ts; exact source preimage is in the packet.
// All paths use the per-step reserved fetch, explicit configured URLs and scoped in-app Vault.
export async function loadBoundProvider(sb: SupabaseClient, tenantId: string | null, providerId: string, maxOutputTokens: number) {
  let q = sb.from("llm_providers").select("id,scope,tenant_id,provider,model,base_url,key_secret_name")
    .eq("id", providerId).eq("is_active", true).eq("scope", tenantId ? "tenant" : "platform");
  q = tenantId ? q.eq("tenant_id", tenantId) : q.is("tenant_id", null);
  const { data, error } = await q.maybeSingle();
  const row = data as any;
  if (error || !row?.base_url) throw new CopilotRefusal(424, "copilot.provider_missing", "The selected provider is unavailable.");
  let url: URL;
  try { url = new URL(row.base_url); } catch { throw new CopilotRefusal(424, "copilot.endpoint_invalid", "A valid provider URL is required."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new CopilotRefusal(424, "copilot.endpoint_invalid", "A secure provider URL is required.");
  const keyName = (row.key_secret_name || row.provider).toUpperCase();
  let secret;
  try { secret = await resolveVaultSecret(sb, { scope: tenantId ? "tenant" : "platform", tenant_id: tenantId, secret_class: "llm_api_key", name: keyName }); }
  catch { throw new CopilotRefusal(424, "copilot.key_missing", "The configured provider credential is unavailable."); }
  if (!secret?.plaintext) throw new CopilotRefusal(424, "copilot.key_missing", "The configured provider credential is unavailable.");
  const binding: DispatchBinding = { id: row.id, provider: row.provider, model: row.model,
    baseUrl: row.base_url.replace(/\/+$/, ""), keyName, maxOutputTokens };
  return { binding, apiKey: secret.plaintext };
}

export function buildGovernedModel(binding: DispatchBinding, apiKey: string, reservedFetch: typeof fetch) {
  const baseURL = binding.baseUrl;
  const host = new URL(baseURL).hostname;
  const provider = binding.provider.toLowerCase();
  if (provider === "anthropic" && host === "api.anthropic.com")
    return createAnthropic({ apiKey, baseURL, fetch: reservedFetch })(binding.model);
  if (provider === "muse" && host === "api.meta.ai")
    return createMuse({ apiKey, baseURL, fetch: reservedFetch }).chat(binding.model);
  // Supplied gateway aliases retain their exact configured model IDs and URLs.
  return createMuseCompatible({ name: provider, baseURL, headers: { Authorization: `Bearer ${apiKey}` }, fetch: reservedFetch })(binding.model);
}
