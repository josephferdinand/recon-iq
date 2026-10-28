import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { z } from 'zod';

const Provider = z.enum(['aws_kms', 'gcp_kms', 'azure_kv', 'hashicorp_vault']);

export const listCmekKeys = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenantId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from('cmek_keys')
      .select('id,provider,key_uri,alias,status,last_rotated_at,created_at')
      .eq('tenant_id', data.tenantId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return rows ?? [];
  });

export const registerCmekKey = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z
      .object({
        tenantId: z.string().uuid(),
        provider: Provider,
        keyUri: z.string().min(8).max(512),
        alias: z.string().max(120).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    // KMS URI format guard per provider — reject obvious garbage.
    const patterns: Record<string, RegExp> = {
      aws_kms: /^arn:aws[a-z-]*:kms:[a-z0-9-]+:\d{12}:key\/[a-f0-9-]{36}$/i,
      gcp_kms: /^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+$/,
      azure_kv: /^https:\/\/[a-z0-9-]+\.vault\.azure\.net\/keys\/[^/]+(\/[^/]+)?$/i,
      hashicorp_vault: /^https?:\/\/.+/i,
    };
    const re = patterns[data.provider];
    if (re && !re.test(data.keyUri)) throw new Error(`Invalid ${data.provider} key URI format`);
    const { data: row, error } = await context.supabase
      .from('cmek_keys')
      .insert({
        tenant_id: data.tenantId,
        provider: data.provider,
        key_uri: data.keyUri,
        alias: data.alias ?? null,
        created_by: context.userId,
      })
      .select('id')
      .single();
    if (error) throw error;
    await context.supabase.from('audit_log').insert({
      actor_user_id: context.userId, tenant_id: data.tenantId, scope: 'tenant',
      action: 'cmek.key.registered', resource_type: 'cmek_keys', resource_id: (row as any).id,
      context: { provider: data.provider, alias: data.alias ?? null },
    } as any);
    return { id: row.id };
  });

export const setCmekStatus = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        tenantId: z.string().uuid(),
        status: z.enum(['pending', 'active', 'rotating', 'disabled']),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    // Verify the key belongs to the caller's tenant before mutating.
    const { data: existing } = await context.supabase
      .from('cmek_keys').select('id, tenant_id, status').eq('id', data.id).maybeSingle();
    if (!existing || (existing as any).tenant_id !== data.tenantId) {
      throw new Error('CMEK key not found for this tenant');
    }
    const patch = {
      status: data.status,
      ...(data.status === 'active' ? { last_rotated_at: new Date().toISOString() } : {}),
    };
    const { error } = await context.supabase
      .from('cmek_keys').update(patch)
      .eq('id', data.id).eq('tenant_id', data.tenantId);
    if (error) throw error;
    await context.supabase.from('audit_log').insert({
      actor_user_id: context.userId, tenant_id: data.tenantId, scope: 'tenant',
      action: 'cmek.key.status_changed', resource_type: 'cmek_keys', resource_id: data.id,
      context: { from: (existing as any).status, to: data.status },
    } as any);
    return { ok: true };
  });
