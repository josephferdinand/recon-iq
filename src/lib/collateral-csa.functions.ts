import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { USER_FACING_ERRORS, userFacingErrorKind } from "@/lib/user-facing-errors";
import type { Json } from "@/integrations/supabase/types";
import { z } from "zod";

const uuid = z.string().uuid();
// The governed tables use numeric(20,4): accept at most 16 integer and 4 fractional digits.
const amount = z.string().regex(/^-?(?:0|[1-9]\d{0,15})(?:\.\d{1,4})?$/);
const positiveAmount = z.string().regex(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,4})?$/);
const idempotencyKey = z.string().min(1).max(120);

type DbError = { message: string; code?: string; status?: number };
type CsaRow = Record<string, Json>;
type DbResult<T> = { data: T | null; error: DbError | null };
type DbQuery = PromiseLike<DbResult<CsaRow[]>> & {
  eq(column: string, value: string): DbQuery;
  order(column: string, options: { ascending: boolean }): DbQuery;
};
type CsaDatabase = {
  from(table: string): { select(columns: string): DbQuery };
  rpc(name: string, args: Record<string, unknown>): PromiseLike<DbResult<Json>>;
};

function fail(error: { message: string; code?: string; status?: number } | null): void {
  if (!error) return;
  const inferredStatus =
    error.status ??
    (error.code === "42501"
      ? 403
      : error.code === "22023"
        ? 400
        : error.code === "PGRST002" || error.code === "PGRST003"
          ? 503
          : 500);
  const kind = userFacingErrorKind({ code: error.code, status: inferredStatus });
  const copy = USER_FACING_ERRORS[kind];
  const status = inferredStatus;
  throw Object.assign(new Error(`${copy.title} ${copy.action}`), { status });
}

export const listCollateralCsaLifecycle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => z.object({ tenant_id: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    const db = context.supabase as unknown as CsaDatabase;
    const [agreements, versions, calls, disputes, settlements] = await Promise.all([
      db
        .from("collateral_csa_agreements")
        .select(
          "id,tenant_id,agreement_key,own_legal_entity,counterparty,currency,created_by,created_at",
        )
        .eq("tenant_id", data.tenant_id)
        .order("created_at", { ascending: false }),
      db
        .from("collateral_csa_versions")
        .select(
          "id,tenant_id,agreement_id,version_no,status,threshold_amount,minimum_transfer,rounding_increment,effective_from,effective_to,terms_snapshot,created_by,created_at,submitted_by,submitted_at,approved_by,approved_at",
        )
        .eq("tenant_id", data.tenant_id)
        .order("created_at", { ascending: false }),
      db
        .from("collateral_csa_calls")
        .select(
          "id,tenant_id,agreement_id,version_id,valuation_date,calculated_at,calculated_by,gross_exposure,eligible_collateral_held,net_exposure,threshold_snapshot,minimum_transfer_snapshot,rounding_increment_snapshot,call_amount,direction,status,approved_by,approved_at,settled_amount",
        )
        .eq("tenant_id", data.tenant_id)
        .order("calculated_at", { ascending: false }),
      db
        .from("collateral_csa_call_disputes")
        .select(
          "id,tenant_id,call_id,disputed_amount,reason,raised_by,raised_at,resolved_by,resolved_at,resolution",
        )
        .eq("tenant_id", data.tenant_id)
        .order("raised_at", { ascending: false }),
      db
        .from("collateral_csa_settlements")
        .select("id,tenant_id,call_id,amount,settled_at,settlement_reference,recorded_by")
        .eq("tenant_id", data.tenant_id)
        .order("settled_at", { ascending: false }),
    ]);
    for (const result of [agreements, versions, calls, disputes, settlements]) fail(result.error);
    return {
      agreements: agreements.data ?? [],
      versions: versions.data ?? [],
      calls: calls.data ?? [],
      disputes: disputes.data ?? [],
      settlements: settlements.data ?? [],
      current_user_id: context.userId,
    };
  });

const draftSchema = z.object({
  tenant_id: uuid,
  agreement_id: uuid.nullable().optional(),
  agreement_key: z.string().trim().min(1).max(120),
  own_legal_entity: z.string().trim().min(1).max(160),
  counterparty: z.string().trim().min(1).max(160),
  currency: z.string().regex(/^[A-Z]{3}$/),
  threshold_amount: positiveAmount,
  minimum_transfer: positiveAmount,
  rounding_increment: positiveAmount,
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effective_to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  idempotency_key: idempotencyKey,
});

export const createCollateralCsaDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => draftSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: result, error } = await (context.supabase as unknown as CsaDatabase).rpc(
      "create_collateral_csa_draft",
      {
        _tenant_id: data.tenant_id,
        _agreement_id: data.agreement_id ?? null,
        _agreement_key: data.agreement_key,
        _own_legal_entity: data.own_legal_entity,
        _counterparty: data.counterparty,
        _currency: data.currency,
        _threshold_amount: data.threshold_amount,
        _minimum_transfer: data.minimum_transfer,
        _rounding_increment: data.rounding_increment,
        _effective_from: data.effective_from,
        _effective_to: data.effective_to,
        _terms_snapshot: { scope: "bilateral_vm_manual_values_only" },
        _idempotency_key: data.idempotency_key,
      },
    );
    fail(error);
    return Array.isArray(result) ? (result[0] ?? null) : result;
  });

const lifecycleAction = <T extends z.ZodTypeAny>(
  name: string,
  validator: T,
  rpc: (data: z.output<T>) => Record<string, unknown>,
) =>
  createServerFn({ method: "POST" })
    .middleware([requireSupabaseAuth()])
    .validator((input: unknown) => validator.parse(input))
    .handler(async ({ data, context }) => {
      const { data: result, error } = await (context.supabase as unknown as CsaDatabase).rpc(
        name,
        rpc(data),
      );
      fail(error);
      return result;
    });

export const submitCollateralCsaVersion = lifecycleAction(
  "submit_collateral_csa_version",
  z.object({ tenant_id: uuid, version_id: uuid }),
  (d) => ({ _tenant_id: d.tenant_id, _version_id: d.version_id }),
);
export const decideCollateralCsaVersion = lifecycleAction(
  "decide_collateral_csa_version",
  z.object({
    tenant_id: uuid,
    version_id: uuid,
    approve: z.boolean(),
    reason: z.string().max(1000).default(""),
  }),
  (d) => ({
    _tenant_id: d.tenant_id,
    _version_id: d.version_id,
    _approve: d.approve,
    _reason: d.reason,
  }),
);
export const calculateCollateralVmCall = lifecycleAction(
  "calculate_collateral_vm_call",
  z.object({
    tenant_id: uuid,
    version_id: uuid,
    valuation_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    gross_exposure: amount,
    eligible_collateral_held: positiveAmount,
    idempotency_key: idempotencyKey,
  }),
  (d) => ({
    _tenant_id: d.tenant_id,
    _version_id: d.version_id,
    _valuation_date: d.valuation_date,
    _gross_exposure: d.gross_exposure,
    _eligible_collateral_held: d.eligible_collateral_held,
    _idempotency_key: d.idempotency_key,
  }),
);
export const approveCollateralVmCall = lifecycleAction(
  "approve_collateral_vm_call",
  z.object({ tenant_id: uuid, call_id: uuid }),
  (d) => ({ _tenant_id: d.tenant_id, _call_id: d.call_id }),
);
export const disputeCollateralVmCall = lifecycleAction(
  "dispute_collateral_vm_call",
  z.object({
    tenant_id: uuid,
    call_id: uuid,
    amount: positiveAmount,
    reason: z.string().trim().min(1).max(1000),
    idempotency_key: idempotencyKey,
  }),
  (d) => ({
    _tenant_id: d.tenant_id,
    _call_id: d.call_id,
    _amount: d.amount,
    _reason: d.reason,
    _idempotency_key: d.idempotency_key,
  }),
);
export const resolveCollateralVmDispute = lifecycleAction(
  "resolve_collateral_vm_dispute",
  z.object({ tenant_id: uuid, dispute_id: uuid, resolution: z.string().trim().min(1).max(1000) }),
  (d) => ({ _tenant_id: d.tenant_id, _dispute_id: d.dispute_id, _resolution: d.resolution }),
);
export const recordCollateralVmSettlement = lifecycleAction(
  "record_collateral_vm_settlement",
  z.object({
    tenant_id: uuid,
    call_id: uuid,
    amount: positiveAmount,
    reference: z.string().trim().min(1).max(160),
    idempotency_key: idempotencyKey,
  }),
  (d) => ({
    _tenant_id: d.tenant_id,
    _call_id: d.call_id,
    _amount: d.amount,
    _reference: d.reference,
    _idempotency_key: d.idempotency_key,
  }),
);

const collateralCsaAccessSchema = z.object({
  tenant_id: uuid,
  agreement_id: uuid,
  owner_bu_ids: z.array(uuid).min(1).max(100).transform((ids) => [...new Set(ids)]),
  group_ids: z.array(uuid).max(100).transform((ids) => [...new Set(ids)]),
  reason: z.string().trim().min(3).max(1000),
});

export async function saveCollateralCsaAccessHandler({
  data,
  context,
}: {
  data: unknown;
  context: { supabase: CsaDatabase };
}) {
  const input = collateralCsaAccessSchema.parse(data);
  const { data: result, error } = await context.supabase.rpc("save_collateral_csa_access", {
    _tenant_id: input.tenant_id,
    _agreement_id: input.agreement_id,
    _owner_bu_ids: input.owner_bu_ids,
    _group_ids: input.group_ids,
    _reason: input.reason,
  });
  fail(error);
  if (result == null) fail({ message: "CSA access mapping returned no receipt", status: 503 });
  return result;
}

export const saveCollateralCsaAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => collateralCsaAccessSchema.parse(input))
  .handler(({ data, context }) => saveCollateralCsaAccessHandler({
    data,
    context: { supabase: context.supabase as unknown as CsaDatabase },
  }));

