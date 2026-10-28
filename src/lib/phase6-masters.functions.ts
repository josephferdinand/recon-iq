// Phase 6 — Master data (securities, counterparties, accounts) server fns
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const tid = z.string().uuid();

// ---------- Securities ----------
export const listMasterSecurities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: tid,
      q: z.string().max(120).optional(),
      asset_class: z.string().optional(),
      limit: z.number().int().min(1).max(500).default(100),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("master_securities").select("*").eq("tenant_id", data.tenant_id);
    if (data.asset_class) q = q.eq("asset_class", data.asset_class);
    if (data.q) q = q.or(`name.ilike.%${data.q}%,isin.ilike.%${data.q}%,ticker.ilike.%${data.q}%,cusip.ilike.%${data.q}%`);
    const { data: rows, error } = await q.order("name").limit(data.limit);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertMasterSecurity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      tenant_id: tid,
      name: z.string().min(1).max(200),
      isin: z.string().max(20).optional().nullable(),
      cusip: z.string().max(20).optional().nullable(),
      sedol: z.string().max(20).optional().nullable(),
      ticker: z.string().max(20).optional().nullable(),
      figi: z.string().max(20).optional().nullable(),
      asset_class: z.string().default("equity"),
      currency: z.string().max(3).optional().nullable(),
      issuer: z.string().max(200).optional().nullable(),
      attributes: z.record(z.string(), z.unknown()).default({}),
      active: z.boolean().default(true),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const payload: Record<string, unknown> = { ...data, created_by: context.userId };
    if (!data.id) delete payload.id;
    const { data: row, error } = await context.supabase
      .from("master_securities").upsert(payload as never).select("id").single();
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: data.id ? "master.security.update" : "master.security.create",
      resource_type: "master_securities", resource_id: row.id,
      context: { name: data.name, isin: data.isin },
    } as never);
    return row;
  });

// ---------- Counterparties ----------
export const listMasterCounterparties = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: tid,
      q: z.string().max(120).optional(),
      limit: z.number().int().min(1).max(500).default(100),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("master_counterparties").select("*").eq("tenant_id", data.tenant_id);
    if (data.q) q = q.or(`short_name.ilike.%${data.q}%,legal_name.ilike.%${data.q}%,lei.ilike.%${data.q}%,bic.ilike.%${data.q}%`);
    const { data: rows, error } = await q.order("short_name").limit(data.limit);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertMasterCounterparty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      tenant_id: tid,
      short_name: z.string().min(1).max(120),
      legal_name: z.string().max(200).optional().nullable(),
      lei: z.string().length(20).optional().nullable(),
      bic: z.string().max(11).optional().nullable(),
      jurisdiction: z.string().max(3).optional().nullable(),
      cp_type: z.string().default("bank"),
      parent_id: z.string().uuid().optional().nullable(),
      attributes: z.record(z.string(), z.unknown()).default({}),
      active: z.boolean().default(true),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const payload: Record<string, unknown> = { ...data, created_by: context.userId };
    if (!data.id) delete payload.id;
    const { data: row, error } = await context.supabase
      .from("master_counterparties").upsert(payload as never).select("id").single();
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: data.id ? "master.counterparty.update" : "master.counterparty.create",
      resource_type: "master_counterparties", resource_id: row.id,
      context: { short_name: data.short_name, lei: data.lei },
    } as never);
    return row;
  });

// ---------- Accounts ----------
export const listMasterAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: tid,
      q: z.string().max(120).optional(),
      account_type: z.string().optional(),
      limit: z.number().int().min(1).max(500).default(100),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("master_accounts").select("*").eq("tenant_id", data.tenant_id);
    if (data.account_type) q = q.eq("account_type", data.account_type);
    if (data.q) q = q.or(`account_number.ilike.%${data.q}%,account_name.ilike.%${data.q}%`);
    const { data: rows, error } = await q.order("account_number").limit(data.limit);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertMasterAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      tenant_id: tid,
      account_number: z.string().min(1).max(80),
      account_name: z.string().min(1).max(200),
      account_type: z.string().default("nostro"),
      currency: z.string().max(3).optional().nullable(),
      custodian_id: z.string().uuid().optional().nullable(),
      legal_entity: z.string().max(120).optional().nullable(),
      business_unit: z.string().max(120).optional().nullable(),
      attributes: z.record(z.string(), z.unknown()).default({}),
      active: z.boolean().default(true),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const payload: Record<string, unknown> = { ...data, created_by: context.userId };
    if (!data.id) delete payload.id;
    const { data: row, error } = await context.supabase
      .from("master_accounts").upsert(payload as never).select("id").single();
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: data.id ? "master.account.update" : "master.account.create",
      resource_type: "master_accounts", resource_id: row.id,
      context: { account_number: data.account_number, type: data.account_type },
    } as never);
    return row;
  });
