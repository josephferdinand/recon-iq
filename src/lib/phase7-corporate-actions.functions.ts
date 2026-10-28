// Phase 7 — Corporate Actions module
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const CaTypeEnum = z.enum([
  "cash_dividend","stock_dividend","stock_split","reverse_split",
  "rights_issue","bonus_issue","merger","spinoff","redemption","coupon","other",
]);

const CaStatusEnum = z.enum([
  "announced","confirmed","ex","record","pending_pay","paid","cancelled","reconciled","broken",
]);

export const listCorporateActions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      status: CaStatusEnum.optional(),
      limit: z.number().int().min(1).max(500).default(100),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("corporate_actions")
      .select("id,tenant_id,ca_type,isin,ex_date,record_date,pay_date,ratio,gross_amount,net_amount,currency,status,source,created_at")
      .eq("tenant_id", data.tenant_id)
      .order("pay_date", { ascending: false, nullsFirst: false })
      .limit(data.limit);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertCorporateAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      tenant_id: z.string().uuid(),
      ca_type: CaTypeEnum,
      isin: z.string().optional(),
      ex_date: z.string().optional(),
      record_date: z.string().optional(),
      pay_date: z.string().optional(),
      ratio: z.number().optional(),
      gross_amount: z.number().optional(),
      net_amount: z.number().optional(),
      currency: z.string().length(3).optional(),
      status: CaStatusEnum.default("announced"),
      source: z.string().optional(),
      payload: z.record(z.string(), z.unknown()).default({}),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("corporate_actions")
      .upsert(data as never, { onConflict: "id" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    await context.supabase.from("ca_lifecycle_events").insert({
      ca_id: row.id,
      tenant_id: data.tenant_id,
      event: data.id ? "updated" : "created",
      payload: { status: data.status },
    });
    return row;
  });

export const listCaEntitlements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      ca_id: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(500).default(200),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("ca_entitlements")
      .select("*")
      .eq("tenant_id", data.tenant_id)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.ca_id) q = q.eq("ca_id", data.ca_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
