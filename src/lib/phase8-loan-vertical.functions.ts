/**
 * Phase 8 — Loan / collateral / sec-lending vertical server fns.
 *
 * Pure data plane. Reconciliation rules consume these masters via the
 * existing Phase-6 master-data plumbing.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertPhaseCPerm } from "./phase-c-rbac.functions";

const LoanStatus = z.enum(["draft","active","prepaid","matured","defaulted","closed"]);

export const listLoanFacilities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      status: LoanStatus.optional(),
      limit: z.number().int().min(1).max(500).default(100),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertPhaseCPerm(context, data.tenant_id, "loans_view");
    let q = context.supabase
      .from("loan_facilities")
      .select("id,facility_ref,borrower,currency,principal_amount,outstanding_amount,interest_rate_bps,start_date,maturity_date,status")
      .eq("tenant_id", data.tenant_id);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q.order("start_date", { ascending: false }).limit(data.limit);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertLoanFacility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      facility_ref: z.string().min(1).max(120),
      borrower: z.string().min(1).max(200),
      currency: z.string().length(3),
      principal_amount: z.number().nonnegative(),
      outstanding_amount: z.number().nonnegative().default(0),
      interest_rate_bps: z.number().int().min(0).max(50000).optional(),
      start_date: z.string(),
      maturity_date: z.string().optional(),
      status: LoanStatus.default("draft"),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("loan_facilities")
      .upsert(data as never, { onConflict: "tenant_id,facility_ref" })
      .select("id,facility_ref,status")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listCollateralPledges = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      facility_id: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(500).default(100),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertPhaseCPerm(context, data.tenant_id, "loans_view");
    let q = context.supabase
      .from("collateral_pledges")
      .select("id,facility_id,collateral_type,isin,quantity,market_value,currency,haircut_pct,effective_value,as_of")
      .eq("tenant_id", data.tenant_id);
    if (data.facility_id) q = q.eq("facility_id", data.facility_id);
    const { data: rows, error } = await q.order("as_of", { ascending: false }).limit(data.limit);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const recordCollateralPledge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      facility_id: z.string().uuid().optional(),
      collateral_type: z.string().min(1).max(60),
      isin: z.string().length(12).optional(),
      quantity: z.number().nonnegative().optional(),
      market_value: z.number().nonnegative().optional(),
      currency: z.string().length(3).optional(),
      haircut_pct: z.number().min(0).max(100).optional(),
      as_of: z.string(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const effective_value =
      data.market_value != null && data.haircut_pct != null
        ? Number((data.market_value * (1 - data.haircut_pct / 100)).toFixed(2))
        : data.market_value ?? null;
    const payload = { ...data, effective_value };
    const { data: row, error } = await context.supabase
      .from("collateral_pledges")
      .insert(payload as never)
      .select("id,effective_value")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listSecLendingLoans = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      status: z.enum(["open","recalled","closed","failed"]).optional(),
      limit: z.number().int().min(1).max(500).default(100),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertPhaseCPerm(context, data.tenant_id, "loans_view");
    let q = context.supabase
      .from("sec_lending_loans")
      .select("id,trade_ref,isin,quantity,counterparty_lei,loan_value,fee_bps,rebate_bps,open_date,close_date,status")
      .eq("tenant_id", data.tenant_id);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q.order("open_date", { ascending: false }).limit(data.limit);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/** Pure helper exposed for unit tests and the UI. */
export function effectiveCollateralValue(market_value: number, haircut_pct: number): number {
  if (haircut_pct < 0 || haircut_pct > 100) return market_value;
  return Number((market_value * (1 - haircut_pct / 100)).toFixed(2));
}
