import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { requireTenantAdmin, requireTenantMember } from '@/lib/rbac-guards.server';
import { z } from 'zod';

const TenantInput = z.object({ tenantId: z.string().uuid() });

async function resolveWebhookTenant(ctx: any, subscriptionId: string): Promise<string> {
  const { data, error } = await ctx.supabase
    .from('webhook_subscriptions')
    .select('tenant_id')
    .eq('id', subscriptionId)
    .maybeSingle();
  if (error || !data?.tenant_id) throw new Error('Webhook subscription not found');
  return data.tenant_id as string;
}

async function resolveOutboxTenant(ctx: any, outboxId: string): Promise<string> {
  const { data, error } = await ctx.supabase
    .from('webhook_outbox')
    .select('tenant_id')
    .eq('id', outboxId)
    .maybeSingle();
  if (error || !data?.tenant_id) throw new Error('Outbox row not found');
  return data.tenant_id as string;
}

export const listWebhooks = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => TenantInput.parse(d))
  .handler(async ({ data, context }) => {
    await requireTenantMember(context, data.tenantId, { fnName: 'listWebhooks' });
    const { data: rows, error } = await context.supabase
      .from('webhook_subscriptions')
      .select('id,name,url,events,enabled,created_at,updated_at')
      .eq('tenant_id', data.tenantId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return rows ?? [];
  });

const CreateInput = TenantInput.extend({
  name: z.string().min(2).max(120),
  url: z.string().url(),
  events: z.array(z.string().min(1)).min(1),
});

export const createWebhook = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => CreateInput.parse(d))
  .handler(async ({ data, context }) => {
    await requireTenantAdmin(context, data.tenantId, { fnName: 'createWebhook' });
    // Generate signing secret and store hash only
    const secret = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    const enc = new TextEncoder();
    const hashBuf = await crypto.subtle.digest('SHA-256', enc.encode(secret));
    const secret_hash = Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const { data: row, error } = await context.supabase
      .from('webhook_subscriptions')
      .insert({
        tenant_id: data.tenantId,
        name: data.name,
        url: data.url,
        events: data.events,
        secret_hash,
        created_by: context.userId,
      })
      .select('id')
      .single();
    if (error) throw error;
    return { id: row.id, secret };
  });

export const toggleWebhook = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid(), enabled: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const tenantId = await resolveWebhookTenant(context, data.id);
    await requireTenantAdmin(context, tenantId, { fnName: 'toggleWebhook' });
    const { error } = await context.supabase
      .from('webhook_subscriptions')
      .update({ enabled: data.enabled })
      .eq('id', data.id);
    if (error) throw error;
    return { ok: true };
  });

export const deleteWebhook = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const tenantId = await resolveWebhookTenant(context, data.id);
    await requireTenantAdmin(context, tenantId, { fnName: 'deleteWebhook' });
    const { error } = await context.supabase.from('webhook_subscriptions').delete().eq('id', data.id);
    if (error) throw error;
    return { ok: true };
  });

export const listWebhookDeliveries = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ subscriptionId: z.string().uuid(), limit: z.number().int().min(1).max(200).default(50) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const tenantId = await resolveWebhookTenant(context, data.subscriptionId);
    await requireTenantMember(context, tenantId, { fnName: 'listWebhookDeliveries' });
    const { data: rows, error } = await context.supabase
      .from('webhook_deliveries')
      .select('id,event,response_status,attempt,delivered_at,created_at')
      .eq('subscription_id', data.subscriptionId)
      .order('created_at', { ascending: false })
      .limit(data.limit);
    if (error) throw error;
    return rows ?? [];
  });

export const listWebhookOutbox = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z
      .object({
        tenantId: z.string().uuid(),
        status: z.enum(['pending', 'delivered', 'failed', 'dead']).optional(),
        limit: z.number().int().min(1).max(200).default(50),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireTenantMember(context, data.tenantId, { fnName: 'listWebhookOutbox' });
    let q = context.supabase
      .from('webhook_outbox')
      .select('id,event,status,attempts,next_attempt_at,last_error,created_at')
      .eq('tenant_id', data.tenantId)
      .order('created_at', { ascending: false })
      .limit(data.limit);
    if (data.status) q = q.eq('status', data.status);
    const { data: rows, error } = await q;
    if (error) throw error;
    return (rows ?? []).map(({ last_error, ...row }: any) => ({
      ...row, delivery_needs_attention: !!last_error,
    }));
  });


export const replayWebhookOutbox = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ outboxId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const tenantId = await resolveOutboxTenant(context, data.outboxId);
    await requireTenantAdmin(context, tenantId, { fnName: 'replayWebhookOutbox' });
    const { error } = await context.supabase.rpc('webhook_outbox_replay', { p_outbox_id: data.outboxId });
    if (error) throw error;
    return { ok: true };
  });

export const getWebhookHealth = createServerFn({ method: 'POST' })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => TenantInput.parse(d))
  .handler(async ({ data, context }) => {
    await requireTenantMember(context, data.tenantId, { fnName: 'getWebhookHealth' });
    const { data: rows, error } = await context.supabase.rpc('webhook_health_stats', { p_tenant_id: data.tenantId });
    if (error) throw error;
    const r = (Array.isArray(rows) ? rows[0] : rows) as
      | { delivered: number; failed: number; dead: number; pending: number; subscriptions: number }
      | null;
    return r ?? { delivered: 0, failed: 0, dead: 0, pending: 0, subscriptions: 0 };
  });
