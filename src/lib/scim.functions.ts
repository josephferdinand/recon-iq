import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const tid = z.string().uuid();

function randomToken(len = 40): string {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, len);
}
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export const listScimTokens = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: tid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("scim_tokens").select("id, label, token_prefix, is_active, last_used_at, created_at, expires_at")
      .eq("tenant_id", data.tenant_id).order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const createScimToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: tid,
      label: z.string().min(2).max(80),
      expires_at: z.string().datetime().optional().nullable(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const raw = randomToken(40);
    const hash = await sha256Hex(raw);
    const prefix = raw.slice(0, 8);
    const { data: row, error } = await context.supabase.from("scim_tokens").insert({
      tenant_id: data.tenant_id, label: data.label,
      token_hash: hash, token_prefix: prefix,
      created_by: context.userId, expires_at: data.expires_at ?? null,
    } as any).select("id, token_prefix").single();
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: "scim.token.create", resource_type: "scim_tokens",
      resource_id: row.id, context: { label: data.label, prefix },
    } as any);
    return { id: row.id, token: raw, prefix };
  });

export const revokeScimToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ id: z.string().uuid(), tenant_id: tid }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("scim_tokens").update({ is_active: false })
      .eq("id", data.id).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: "scim.token.revoke", resource_type: "scim_tokens",
      resource_id: data.id, context: {},
    } as any);
    return { ok: true };
  });

export const listScimSyncLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: tid, limit: z.number().int().max(500).default(100) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("scim_sync_log").select("*")
      .eq("tenant_id", data.tenant_id).order("occurred_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
