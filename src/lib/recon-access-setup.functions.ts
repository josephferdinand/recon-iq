import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const uuid = z.string().uuid();
const reason = z.string().trim().min(3).max(500);

export const reconActionSchema = z.enum(["view", "run", "edit", "approve"]);
export type ReconAction = z.infer<typeof reconActionSchema>;

const principalSchema = z.object({
  principal_type: z.enum(["user", "group"]),
  principal_id: uuid,
  label: z.string(),
  bu_ids: z.array(uuid),
});

const setupSchema = z.object({
  recon_id: uuid,
  tenant_id: uuid,
  multi_bu_governed: z.boolean(),
  is_tenant_admin: z.boolean(),
  owners: z.array(z.object({ bu_id: uuid, created_at: z.string() })),
  grants: z.array(z.object({
    grant_id: uuid,
    bu_id: uuid,
    principal_type: z.enum(["user", "group"]),
    principal_id: uuid,
    action: z.enum(["view", "read", "run", "edit", "approve"]).transform((action) => action === "read" ? "view" : action),
    granted_at: z.string(),
  })),
  effective_access: z.object({ view: z.boolean(), run: z.boolean(), edit: z.boolean(), approve: z.boolean() }),
  available_business_units: z.array(z.object({ bu_id: uuid, name: z.string(), code: z.string().nullable().optional(), is_archived: z.boolean().optional() })).optional().default([]),
  available_principals: z.array(principalSchema).optional().default([]),
});

export type ReconAccessSetup = z.infer<typeof setupSchema>;

const legacyCutoverResultSchema = z.object({
  recon_id: uuid,
  access_mode: z.literal("mapped_exact"),
  governance_state: z.literal("legacy_mapped"),
  owner_bu_ids: z.array(uuid),
  audit_receipt_id: uuid,
});
export type LegacyReconCutoverResult = z.infer<typeof legacyCutoverResultSchema>;

type HandlerContext = { supabase: any };

function safeFailure() {
  return new Error("Reconciliation access is temporarily unavailable. Retry the access check.");
}

export async function getReconAccessSetupHandler({ data, context }: { data: { recon_id: string }; context: HandlerContext }) {
  const { data: result, error } = await context.supabase.rpc("get_recon_access_setup", { _recon_id: data.recon_id });
  if (error || !result) throw safeFailure();
  const parsed = setupSchema.safeParse(result);
  if (!parsed.success) throw safeFailure();
  return parsed.data;
}

export async function setReconOwnersHandler({ data, context }: { data: { recon_id: string; bu_ids: string[]; reason: string }; context: HandlerContext }) {
  const parsed = z.object({ recon_id: uuid, bu_ids: z.array(uuid).min(1).max(100), reason }).parse(data);
  const { data: result, error } = await context.supabase.rpc("set_recon_owners", { _recon_id: parsed.recon_id, _bu_ids: [...new Set(parsed.bu_ids)], _reason: parsed.reason });
  if (error || !Array.isArray(result)) throw safeFailure();
  return result;
}

export async function grantReconBuActionHandler({ data, context }: { data: { recon_id: string; bu_id: string; principal_type: "user" | "group"; principal_id: string; action: ReconAction; reason: string }; context: HandlerContext }) {
  const parsed = z.object({ recon_id: uuid, bu_id: uuid, principal_type: z.enum(["user", "group"]), principal_id: uuid, action: reconActionSchema, reason }).parse(data);
  const { data: result, error } = await context.supabase.rpc("grant_recon_bu_action", {
    _recon_id: parsed.recon_id, _bu_id: parsed.bu_id, _principal_type: parsed.principal_type,
    _principal_id: parsed.principal_id, _action: parsed.action, _reason: parsed.reason,
  });
  if (error || typeof result !== "string") throw safeFailure();
  return result;
}

export async function revokeReconBuActionHandler({ data, context }: { data: { grant_id: string; reason: string }; context: HandlerContext }) {
  const parsed = z.object({ grant_id: uuid, reason }).parse(data);
  const { data: result, error } = await context.supabase.rpc("revoke_recon_bu_action", { _grant_id: parsed.grant_id, _reason: parsed.reason });
  if (error || result !== true) throw safeFailure();
  return result;
}

export async function cutoverLegacyReconDefinitionHandler({ data, context }: { data: { tenant_id: string; recon_id: string; owner_bu_ids: string[]; maker_user_id: string; checker_user_id: string; reason: string }; context: HandlerContext }) {
  const parsed = z.object({ tenant_id: uuid, recon_id: uuid, owner_bu_ids: z.array(uuid).min(1).max(100), maker_user_id: uuid, checker_user_id: uuid, reason }).refine((value) => value.maker_user_id !== value.checker_user_id, "Maker and checker must be different users").parse(data);
  const { data: result, error } = await context.supabase.rpc("cutover_legacy_recon_definition_mapping", {
    _tenant_id: parsed.tenant_id,
    _recon_id: parsed.recon_id,
    _owner_bu_ids: [...new Set(parsed.owner_bu_ids)],
    _maker_user_id: parsed.maker_user_id,
    _checker_user_id: parsed.checker_user_id,
    _reason: parsed.reason,
  });
  const validated = legacyCutoverResultSchema.safeParse(result);
  if (error || !validated.success || validated.data.recon_id !== parsed.recon_id) throw safeFailure();
  return validated.data;
}

export const getReconAccessSetup = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((data: unknown) => z.object({ recon_id: uuid }).parse(data))
  .handler(getReconAccessSetupHandler);

export const setReconOwners = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((data: unknown) => z.object({ recon_id: uuid, bu_ids: z.array(uuid).min(1).max(100), reason }).parse(data))
  .handler(setReconOwnersHandler);

export const grantReconBuAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((data: unknown) => z.object({ recon_id: uuid, bu_id: uuid, principal_type: z.enum(["user", "group"]), principal_id: uuid, action: reconActionSchema, reason }).parse(data))
  .handler(grantReconBuActionHandler);

export const revokeReconBuAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((data: unknown) => z.object({ grant_id: uuid, reason }).parse(data))
  .handler(revokeReconBuActionHandler);

export const cutoverLegacyReconDefinition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((data: unknown) => z.object({ tenant_id: uuid, recon_id: uuid, owner_bu_ids: z.array(uuid).min(1).max(100), maker_user_id: uuid, checker_user_id: uuid, reason }).refine((value) => value.maker_user_id !== value.checker_user_id, "Maker and checker must be different users").parse(data))
  .handler(cutoverLegacyReconDefinitionHandler);
