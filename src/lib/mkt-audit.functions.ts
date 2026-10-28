import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** Full set of actions we now persist in mkt_content_audit_log. */
export const mktAuditActionEnum = z.enum([
  "create","update","delete","reset",
  "activate","schedule","rollback","archive",
  "stepup_success","stepup_failed",
  "bootstrap_success","bootstrap_denied",
  "request","approve","reject","cancel",
]);
export type MktAuditActionName = z.infer<typeof mktAuditActionEnum>;

export type MktAuditRow = {
  id: string;
  entity_type: string;
  entity_key: string | null;
  action: MktAuditActionName;
  actor_id: string | null;
  actor_email: string | null;
  actor_context: string | null;
  before: string | null;
  after: string | null;
  summary: string | null;
  created_at: string;
};

function serializeRows(rows: unknown[]): MktAuditRow[] {
  return rows.map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: String(row.id),
      entity_type: String(row.entity_type ?? ""),
      entity_key: (row.entity_key as string | null) ?? null,
      action: row.action as MktAuditActionName,
      actor_id: (row.actor_id as string | null) ?? null,
      actor_email: (row.actor_email as string | null) ?? null,
      actor_context: row.actor_context == null ? null : JSON.stringify(row.actor_context),
      before: row.before == null ? null : JSON.stringify(row.before),
      after: row.after == null ? null : JSON.stringify(row.after),
      summary: (row.summary as string | null) ?? null,
      created_at: String(row.created_at),
    };
  });
}

const listInput = z.object({
  entity_type: z.string().optional(),
  entity_key: z.string().optional(),
  action: mktAuditActionEnum.optional(),
  actor_id: z.string().uuid().optional(),
  actor_email: z.string().optional(),
  q: z.string().optional(),
  start_at: z.string().datetime().optional(),
  end_at: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(1000).default(100),
  offset: z.number().int().min(0).default(0),
});

export const listMktAuditLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => listInput.parse(d ?? {}))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("mkt_content_audit_log" as any)
      .select(
        "id,entity_type,entity_key,action,actor_id,actor_email,actor_context,before,after,summary,created_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);

    if (data.entity_type) q = q.eq("entity_type", data.entity_type);
    if (data.entity_key) q = q.eq("entity_key", data.entity_key);
    if (data.action) q = q.eq("action", data.action);
    if (data.actor_id) q = q.eq("actor_id", data.actor_id);
    if (data.actor_email) q = q.ilike("actor_email", `%${data.actor_email}%`);
    if (data.start_at) q = q.gte("created_at", data.start_at);
    if (data.end_at) q = q.lte("created_at", data.end_at);
    if (data.q && data.q.trim()) {
      const term = `%${data.q.trim()}%`;
      q = q.or(
        `summary.ilike.${term},entity_key.ilike.${term},actor_email.ilike.${term}`,
      );
    }

    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);
    return {
      rows: serializeRows((rows ?? []) as unknown[]),
      total: count ?? 0,
      offset: data.offset,
      limit: data.limit,
    };
  });

export const listMktEntityVersions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z
      .object({
        entity_type: z.string().min(1),
        entity_key: z.string().min(1),
        limit: z.number().int().min(1).max(200).default(50),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("mkt_content_audit_log" as any)
      .select("*")
      .eq("entity_type", data.entity_type)
      .eq("entity_key", data.entity_key)
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (error) throw new Error(error.message);
    return serializeRows((rows ?? []) as unknown[]);
  });

export const listMktAuditEntities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data: rows, error } = await context.supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("mkt_content_audit_log" as any)
      .select("entity_type")
      .limit(1000);
    if (error) throw new Error(error.message);
    const set = new Set<string>();
    for (const r of (rows ?? []) as unknown as { entity_type: string }[]) set.add(r.entity_type);
    return Array.from(set).sort();
  });

/** Fetch audit rows scoped to admin_role changes, used by the "Role changes"
 * highlight tab. */
export const listMktRoleChanges = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({
    start_at: z.string().datetime().optional(),
    end_at: z.string().datetime().optional(),
    limit: z.number().int().min(1).max(500).default(200),
  }).parse(d ?? {}))
  .handler(async ({ data, context }) => {
    let q = context.supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from("mkt_content_audit_log" as any)
      .select("id,entity_type,entity_key,action,actor_id,actor_email,actor_context,before,after,summary,created_at")
      .eq("entity_type", "admin_role")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.start_at) q = q.gte("created_at", data.start_at);
    if (data.end_at) q = q.lte("created_at", data.end_at);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return serializeRows((rows ?? []) as unknown[]);
  });
