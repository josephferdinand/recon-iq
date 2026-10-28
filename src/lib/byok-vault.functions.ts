// D6 — BYOK Team Key Vault server functions.
// Vaults group BYOK keys for shared team usage with explicit RBAC.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireTenantAdmin } from "@/lib/rbac-guards.server";
import { z } from "zod";

const tenantIdSchema = z.object({ tenant_id: z.string().uuid() });

async function assertTenantAdmin(supabase: any, tenantId: string, userId: string) {
  await requireTenantAdmin({ supabase, userId } as any, tenantId, { fnName: "byok-vault" });
}

export const createVault = createServerFn({ method: "POST" })
  .validator(tenantIdSchema.extend({ name: z.string().min(2).max(80), description: z.string().max(500).optional() }))
  .middleware([requireSupabaseAuth()])
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context.supabase, data.tenant_id, context.userId);
    const { data: row, error } = await context.supabase
      .from("byok_key_vaults")
      .insert({ tenant_id: data.tenant_id, name: data.name, description: data.description ?? null, created_by: context.userId } as any)
      .select("id, name, description, created_at")
      .single();
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      tenant_id: data.tenant_id, actor_user_id: context.userId,
      scope: "tenant", action: "byok.vault.created",
      resource_type: "byok_key_vault", resource_id: (row as any).id,
      context: { name: data.name } as any,
    } as any);
    return { ok: true, vault: row };
  });

export const listVaults = createServerFn({ method: "GET" })
  .validator(tenantIdSchema)
  .middleware([requireSupabaseAuth()])
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("byok_key_vaults")
      .select("id, name, description, created_at, created_by")
      .eq("tenant_id", data.tenant_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { ok: true, vaults: rows ?? [] };
  });

export const shareVault = createServerFn({ method: "POST" })
  .validator(z.object({
    tenant_id: z.string().uuid(),
    vault_id: z.string().uuid(),
    user_id: z.string().uuid(),
    permission: z.enum(["read", "use", "admin"]).default("read"),
  }))
  .middleware([requireSupabaseAuth()])
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context.supabase, data.tenant_id, context.userId);
    // Verify the vault belongs to the tenant before sharing (defense in depth vs RLS).
    const { data: vault } = await context.supabase
      .from("byok_key_vaults").select("id, tenant_id").eq("id", data.vault_id).maybeSingle();
    if (!vault || (vault as any).tenant_id !== data.tenant_id) {
      throw new Error("BYOK_VAULT_FORBIDDEN: vault does not belong to tenant");
    }
    const { data: row, error } = await context.supabase
      .from("byok_key_vault_shares")
      .upsert({
        vault_id: data.vault_id, shared_with_user_id: data.user_id,
        permission: data.permission, granted_by: context.userId, revoked_at: null,
      } as any, { onConflict: "vault_id,shared_with_user_id" })
      .select("id, vault_id, shared_with_user_id, permission")
      .single();
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      tenant_id: data.tenant_id, actor_user_id: context.userId,
      scope: "tenant", action: "byok.vault.shared",
      resource_type: "byok_key_vault_share", resource_id: (row as any).id,
      context: { user_id: data.user_id, permission: data.permission } as any,
    } as any);
    return { ok: true, share: row };
  });

export const revokeVaultShare = createServerFn({ method: "POST" })
  .validator(z.object({
    tenant_id: z.string().uuid(),
    vault_id: z.string().uuid(),
    user_id: z.string().uuid(),
  }))
  .middleware([requireSupabaseAuth()])
  .handler(async ({ data, context }) => {
    await assertTenantAdmin(context.supabase, data.tenant_id, context.userId);
    const { error } = await context.supabase
      .from("byok_key_vault_shares")
      .update({ revoked_at: new Date().toISOString() } as any)
      .eq("vault_id", data.vault_id)
      .eq("shared_with_user_id", data.user_id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      tenant_id: data.tenant_id, actor_user_id: context.userId,
      scope: "tenant", action: "byok.vault.share_revoked",
      resource_type: "byok_key_vault", resource_id: data.vault_id,
      context: { user_id: data.user_id } as any,
    } as any);
    return { ok: true };
  });
