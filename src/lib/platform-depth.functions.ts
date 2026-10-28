import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const tid = z.string().uuid();

// ---------- Streaming topics ----------
export const listStreamingTopics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: tid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("streaming_topics").select("*").eq("tenant_id", data.tenant_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertStreamingTopic = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      tenant_id: tid,
      name: z.string().min(1).max(120),
      source: z.enum(["kafka","kinesis","pubsub","cdc-postgres","cdc-mysql","eventbridge"]),
      bootstrap: z.string().max(500).optional().nullable(),
      topic_path: z.string().max(200).optional().nullable(),
      format: z.enum(["json","avro","protobuf","cloudevents","iso20022-xml"]).default("json"),
      partition_key: z.string().max(80).optional().nullable(),
      expected_tps: z.number().int().nonnegative().optional().nullable(),
      status: z.enum(["configured","active","paused","error"]).default("configured"),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const payload: any = { ...data, created_by: context.userId };
    if (!data.id) delete payload.id;
    const { data: row, error } = await context.supabase
      .from("streaming_topics").upsert(payload).select("id").single();
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: data.id ? "stream.topic.update" : "stream.topic.create",
      resource_type: "streaming_topics", resource_id: row.id,
      context: { source: data.source, format: data.format, status: data.status },
    } as any);
    return row;
  });

// ---------- BYOK keys ----------
export const listByokKeys = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: tid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("byok_keys").select("*").eq("tenant_id", data.tenant_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    // Row-boundary decrypt for byok_keys.key_arn (external KMS resource id).
    const { maybeDecryptField } = await import("./crypto.server");
    const decrypted = await Promise.all(
      (rows ?? []).map(async (r: any) => ({
        ...r,
        key_arn: await maybeDecryptField(r.key_arn),
      })),
    );
    return decrypted;
  });

export const upsertByokKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      id: z.string().uuid().optional(),
      tenant_id: tid,
      alias: z.string().min(1).max(120),
      provider: z.enum(["aws-kms","gcp-kms","azure-kv","hashicorp-vault","thales-hsm"]),
      key_arn: z.string().min(8).max(500),
      mode: z.enum(["BYOK","HYOK"]).default("BYOK"),
      algorithm: z.string().default("AES_256"),
      status: z.enum(["active","rotating","revoked"]).default("active"),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    // Row-boundary encrypt for byok_keys.key_arn.
    const { encryptField } = await import("./crypto.server");
    const encryptedArn = await encryptField(data.key_arn);
    const payload: any = { ...data, key_arn: encryptedArn, created_by: context.userId };
    if (!data.id) delete payload.id;
    const { data: row, error } = await context.supabase
      .from("byok_keys").upsert(payload).select("id").single();
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: data.id ? "byok.key.update" : "byok.key.create",
      resource_type: "byok_keys", resource_id: row.id,
      context: { provider: data.provider, mode: data.mode, status: data.status },
    } as any);
    return row;
  });


export const rotateByokKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid(), tenant_id: tid }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("byok_keys")
      .update({ status: "rotating", last_rotated_at: new Date().toISOString() })
      .eq("id", data.id).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "tenant",
      action: "byok.key.rotate", resource_type: "byok_keys", resource_id: data.id, context: {},
    } as any);
    return { ok: true };
  });

// ---------- DR + residency ----------
export const listDrRegions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator(() => ({}))
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("dr_regions").select("*").eq("is_active", true).order("geography");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const getTenantResidency = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: tid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("tenant_data_residency").select("*").eq("tenant_id", data.tenant_id).maybeSingle();
    return row;
  });

export const setTenantResidency = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: tid,
      primary_region_code: z.string().min(2),
      secondary_region_code: z.string().min(2).optional().nullable(),
      active_active: z.boolean().default(false),
      pinned_pii: z.boolean().default(true),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("tenant_data_residency")
      .upsert({ ...data, updated_by: context.userId } as any);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id, scope: "platform",
      action: "tenant.residency.update", resource_type: "tenant_data_residency",
      resource_id: data.tenant_id, context: data,
    } as any);
    return { ok: true };
  });

// ---------- Benchmarks ----------
export const listBenchmarks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator(() => ({}))
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("platform_benchmarks").select("*").order("metric");
    if (error) throw new Error(error.message);
    return data ?? [];
  });
