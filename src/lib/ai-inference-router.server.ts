// ─────────────────────────────────────────────────────────────────────────────
// AI Inference Router — the metadata-driven routing resolver that turns a
// caller intent (tenant + purpose + optional model hint) into a concrete
// {provider_instance, model_catalog_entry, endpoint, headers, plaintext_secret}
// resolution. This is the "new resolver" the plan called out as ready for
// cutover; the legacy gateway keeps serving traffic while this resolver is
// used by the Inference Simulator and the /api/ai/inference proxy.
//
// Resolution order:
//   1. Load enabled routing policies for scope=tenant (fallback to platform)
//   2. Sort by priority ASC; for each policy, walk chain entries in order
//   3. For each candidate model_catalog_id → load model + provider_instance
//   4. Skip if provider status != "active" or model approval_status != "approved"
//   5. Match request class against policy.conditions (if any)
//   6. Resolve provider_instance.vault_secret_id → plaintext via vault resolver
//   7. Return the first candidate that resolves cleanly
//
// This module is SERVER ONLY.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret, pgByteaToBytes } from "./vault.server";

export interface ResolvedRoute {
  policy_id: string | null;
  policy_name: string | null;
  chain_index: number;
  provider_instance_id: string;
  provider_code: string;
  provider_display: string;
  model_catalog_id: string;
  model_key: string;
  endpoint: string;
  auth_method: string;
  headers: Record<string, string>;
  api_version: string | null;
  vault_secret_id: string | null;
  vault_last4: string | null;
  vault_fingerprint: string | null;
  secret_plaintext?: string; // omitted for dry runs
}

export interface ResolveArgs {
  tenant_id: string | null;
  request_class?: "chat" | "embedding" | "image" | "tool" | "agent" | "other";
  requested_model_key?: string;
  include_secret?: boolean;
}

async function loadPolicies(sb: SupabaseClient, tenant_id: string | null) {
  // Prefer tenant-scoped policies; fall back to platform-scoped.
  let q = sb.from("ai_routing_policies").select("*").eq("enabled", true)
    .order("priority", { ascending: true });
  if (tenant_id) q = q.eq("scope", "tenant").eq("tenant_id", tenant_id);
  else q = q.eq("scope", "platform");
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  if ((data ?? []).length === 0 && tenant_id) {
    // No tenant override → fall back to platform policies
    const { data: pf, error: pe } = await sb.from("ai_routing_policies").select("*")
      .eq("enabled", true).eq("scope", "platform").order("priority", { ascending: true });
    if (pe) throw new Error(pe.message);
    return pf ?? [];
  }
  return data ?? [];
}

function matchesConditions(cond: any, req: ResolveArgs): boolean {
  if (!cond || typeof cond !== "object") return true;
  if (cond.request_class && req.request_class && cond.request_class !== req.request_class) return false;
  if (cond.model_key && req.requested_model_key && cond.model_key !== req.requested_model_key) return false;
  return true;
}

async function resolveSecret(sb: SupabaseClient, secret_id: string) {
  const { data: row } = await sb.from("app_vault_secrets")
    .select("id, ciphertext, iv, auth_tag, wrapped_dek, kek_provider, kek_ref, fingerprint_sha256, last4")
    .eq("id", secret_id).maybeSingle();
  if (!row) return null;
  const r: any = row;
  const pt = await decryptSecret({
    ciphertext: pgByteaToBytes(r.ciphertext),
    iv: pgByteaToBytes(r.iv),
    auth_tag: pgByteaToBytes(r.auth_tag),
    wrapped_dek: pgByteaToBytes(r.wrapped_dek),
    kek_provider: r.kek_provider,
    kek_ref: r.kek_ref,
  });
  return { plaintext: pt, fingerprint: r.fingerprint_sha256 as string, last4: r.last4 as string };
}

function buildHeaders(inst: any, apiKey: string | null): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json", ...(inst.custom_headers ?? {}) };
  if (!apiKey) return h;
  switch (inst.auth_method) {
    case "bearer":         h["authorization"] = `Bearer ${apiKey}`; break;
    case "api_key_header": h["x-api-key"] = apiKey; break;
    case "azure_muse":   h["api-key"] = apiKey; break;
    case "anthropic":      h["x-api-key"] = apiKey; h["anthropic-version"] = inst.api_version ?? "2023-06-01"; break;
    default:               h["authorization"] = `Bearer ${apiKey}`;
  }
  return h;
}

export async function resolveInferenceRoute(sb: SupabaseClient, args: ResolveArgs): Promise<ResolvedRoute> {
  const policies = await loadPolicies(sb, args.tenant_id);
  const errors: string[] = [];

  for (const pol of policies) {
    if (!matchesConditions((pol as any).conditions, args)) continue;
    const chain = ((pol as any).chain ?? []) as Array<{ model_catalog_id: string; weight?: number; condition?: string }>;
    for (let i = 0; i < chain.length; i++) {
      const entry = chain[i];
      if (!entry?.model_catalog_id) continue;
      const { data: model } = await sb.from("ai_model_catalog")
        .select("id, provider_instance_id, model_key, display_name, approval_status, availability_status")
        .eq("id", entry.model_catalog_id).maybeSingle();
      const m: any = model;
      if (!m) { errors.push(`chain[${i}] model missing`); continue; }
      if (args.requested_model_key && m.model_key !== args.requested_model_key) continue;
      if (m.approval_status !== "approved" || m.availability_status === "unavailable" || m.availability_status === "deprecated") {
        errors.push(`chain[${i}] model ${m.model_key} not eligible (${m.approval_status}/${m.availability_status})`);
        continue;
      }
      const { data: inst } = await sb.from("ai_provider_instances")
        .select("id, provider_code, display_name, endpoint, api_version, auth_method, custom_headers, status, health_status, vault_secret_id")
        .eq("id", m.provider_instance_id).maybeSingle();
      const p: any = inst;
      if (!p) { errors.push(`chain[${i}] provider missing`); continue; }
      if (p.status !== "active") { errors.push(`chain[${i}] provider ${p.display_name} not active`); continue; }
      let sec: Awaited<ReturnType<typeof resolveSecret>> | null = null;
      if (p.vault_secret_id) {
        try { sec = await resolveSecret(sb, p.vault_secret_id); }
        catch (e: any) { errors.push(`chain[${i}] secret decrypt failed: ${e?.message ?? e}`); continue; }
        if (!sec) { errors.push(`chain[${i}] secret not visible to caller (RLS)`); continue; }
      }
      const headers = buildHeaders(p, args.include_secret && sec ? sec.plaintext : null);
      const resolved: ResolvedRoute = {
        policy_id: (pol as any).id, policy_name: (pol as any).name, chain_index: i,
        provider_instance_id: p.id, provider_code: p.provider_code, provider_display: p.display_name,
        model_catalog_id: m.id, model_key: m.model_key,
        endpoint: p.endpoint ?? "", auth_method: p.auth_method,
        headers, api_version: p.api_version,
        vault_secret_id: p.vault_secret_id, vault_last4: sec?.last4 ?? null,
        vault_fingerprint: sec?.fingerprint ?? null,
      };
      if (args.include_secret && sec) resolved.secret_plaintext = sec.plaintext;
      return resolved;
    }
  }
  throw new Error(
    `[ai-router] No eligible route found for tenant=${args.tenant_id ?? "platform"} ` +
    `class=${args.request_class ?? "any"} model=${args.requested_model_key ?? "any"}. ` +
    `Attempts: ${errors.slice(0, 6).join("; ") || "no policies matched"}`,
  );
}
