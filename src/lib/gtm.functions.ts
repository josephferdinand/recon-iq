import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import { newApiTokenScopesSchema } from "@/lib/api-token-scopes";

const tid = z.string().uuid();

// ---------- API tokens ----------
export const listApiTokens = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: tid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("api_tokens")
      .select("id, name, prefix, scopes, expires_at, last_used_at, revoked_at, created_at")
      .eq("tenant_id", data.tenant_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const createApiToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: tid,
      name: z.string().min(1).max(120),
      scopes: newApiTokenScopesSchema,
      expires_in_days: z.number().int().positive().max(730).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const raw = `fvi_${randomBytes(24).toString("hex")}`;
    const prefix = raw.slice(0, 12);
    const token_hash = createHash("sha256").update(raw).digest("hex");
    const expires_at = data.expires_in_days
      ? new Date(Date.now() + data.expires_in_days * 86_400_000).toISOString()
      : null;
    // The authenticated RPC derives the subject from auth.uid(), checks current
    // tenant-admin membership and commits issuance plus audit atomically.
    let result;
    try { result = await context.supabase.rpc("issue_user_delegated_api_token" as never, {
      _tenant_id: data.tenant_id, _name: data.name, _prefix: prefix, _token_hash: token_hash,
      _scopes: data.scopes, _expires_at: expires_at,
    } as never); } catch { throw new Error("API token issuance unavailable."); }
    const row = result?.data, error = result?.error;
    const receipt = z.object({ id: tid, audit_id: z.string().regex(/^[1-9][0-9]{0,18}$/u)
      .refine(value => /^[1-9][0-9]{0,18}$/u.test(value) && BigInt(value) <= 9223372036854775807n) }).safeParse(row);
    if (error || !receipt.success) throw new Error("API token issuance unavailable.");
    return { id: receipt.data.id, token: raw, prefix };
  });

export const revokeApiToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid(), tenant_id: tid }).parse(d))
  .handler(async ({ data, context }) => {
    let result;
    try { result = await context.supabase.rpc("revoke_user_delegated_api_token" as never, {
      _tenant_id: data.tenant_id, _token_id: data.id,
    } as never); } catch { throw new Error("API token revocation unavailable."); }
    const row = result?.data, error = result?.error;
    const receipt = z.object({ id: tid, audit_id: z.string().regex(/^[1-9][0-9]{0,18}$/u)
      .refine(value => /^[1-9][0-9]{0,18}$/u.test(value) && BigInt(value) <= 9223372036854775807n) }).safeParse(row);
    if (error || !receipt.success || receipt.data.id !== data.id) throw new Error("API token revocation unavailable.");
    return { ok: true };
  });

// ---------- Definition versions ----------
export const listDefinitionVersions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ recon_definition_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("recon_definition_versions")
      .select("id, version_number, message, created_at, created_by")
      .eq("recon_definition_id", data.recon_definition_id)
      .order("version_number", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const snapshotDefinition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: tid,
      recon_definition_id: z.string().uuid(),
      message: z.string().max(280).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: def, error: dErr } = await context.supabase
      .from("recon_definitions").select("*").eq("id", data.recon_definition_id).single();
    if (dErr || !def) throw new Error(dErr?.message ?? "Definition not found");
    const { data: last } = await context.supabase
      .from("recon_definition_versions").select("version_number")
      .eq("recon_definition_id", data.recon_definition_id)
      .order("version_number", { ascending: false }).limit(1).maybeSingle();
    const next = (last?.version_number ?? 0) + 1;
    const { data: row, error } = await context.supabase
      .from("recon_definition_versions")
      .insert({
        tenant_id: data.tenant_id,
        recon_definition_id: data.recon_definition_id,
        version_number: next, message: data.message ?? null,
        snapshot: def as any, created_by: context.userId,
      } as any)
      .select("id, version_number").single();
    if (error) throw new Error(error.message);
    return row;
  });

// ---------- Migration imports ----------
export const listMigrationImports = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: tid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("migration_imports").select("*").eq("tenant_id", data.tenant_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const startMigrationImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: tid,
      source_system: z.enum(["duco","tlm","smartstream","frontier","intellimatch","custom"]),
      file_name: z.string().max(200).optional(),
      definitions_found: z.number().int().nonnegative().default(0),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const mapping = {
      mapped_concepts: [
        { source: "match_rule", target: "rule_kind", confidence: 0.92 },
        { source: "tolerance.absolute", target: "tolerances.amount.abs", confidence: 0.99 },
        { source: "tolerance.percentage", target: "tolerances.amount.pct", confidence: 0.97 },
        { source: "key_set", target: "keys[]", confidence: 1.0 },
      ],
      unmapped: data.source_system === "duco"
        ? ["custom_lookups", "natural_language_rules"]
        : ["proprietary_macros"],
      notes: `Static heuristic mapper for ${data.source_system}. Manual review recommended for unmapped items.`,
    };
    const { data: row, error } = await context.supabase
      .from("migration_imports")
      .insert({
        tenant_id: data.tenant_id, source_system: data.source_system,
        file_name: data.file_name ?? null, status: "mapped",
        definitions_found: data.definitions_found,
        mapping_report: mapping, created_by: context.userId,
      } as any)
      .select("id").single();
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: "migration.import.start", resource_type: "migration_imports", resource_id: row.id,
      context: { source: data.source_system },
    } as any);
    return row;
  });

// ---------- Synthetic data ----------
export const listSyntheticJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: tid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("synthetic_data_jobs").select("*").eq("tenant_id", data.tenant_id)
      .order("created_at", { ascending: false }).limit(50);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const createSyntheticJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: tid,
      preset_code: z.string().min(1),
      rows_per_side: z.number().int().positive().max(1_000_000).default(1000),
      break_rate_pct: z.number().min(0).max(50).default(5),
      seed: z.number().int().default(42),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const matched = Math.floor(data.rows_per_side * (1 - data.break_rate_pct / 100));
    const broken = data.rows_per_side - matched;
    const summary = {
      rows_per_side: data.rows_per_side, expected_breaks: broken,
      expected_matches: matched, break_classes: ["amount", "date", "missing", "duplicate"],
    };
    const { data: row, error } = await context.supabase
      .from("synthetic_data_jobs")
      .insert({
        tenant_id: data.tenant_id, preset_code: data.preset_code,
        rows_per_side: data.rows_per_side, break_rate_pct: data.break_rate_pct,
        seed: data.seed, status: "done",
        result_summary: summary, completed_at: new Date().toISOString(),
        created_by: context.userId,
      } as any)
      .select("id").single();
    if (error) throw new Error(error.message);
    return row;
  });

// ---------- Chat ops ----------
export const listChatOps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: tid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("chat_ops_subscriptions").select("*").eq("tenant_id", data.tenant_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertChatOps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      tenant_id: tid,
      platform: z.enum(["teams","slack"]),
      channel: z.string().min(1).max(120),
      webhook_url: z.string().url(),
      events: z.array(z.string()).min(1),
      enabled: z.boolean().default(true),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const payload: any = { ...data, created_by: context.userId };
    if (!data.id) delete payload.id;
    const { data: row, error } = await context.supabase
      .from("chat_ops_subscriptions").upsert(payload).select("id").single();
    if (error) throw new Error(error.message);
    return row;
  });
