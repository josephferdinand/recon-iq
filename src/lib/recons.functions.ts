import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";
import { runRecon, type ReconSpec, type SideData } from "@/lib/recon-engine";

async function assertWriter(ctx: any, tenantId: string) {
  const { data: a } = await ctx.supabase.rpc("has_tenant_role", {
    _user_id: ctx.userId, _tenant_id: tenantId, _role: "tenant_admin",
  });
  const { data: b } = await ctx.supabase.rpc("has_tenant_role", {
    _user_id: ctx.userId, _tenant_id: tenantId, _role: "tenant_analyst",
  });
  if (!a && !b) throw new Error("Forbidden: analyst or admin role required");
}

type ReconActionClient = {
  rpc: (
    name: "recon_authoritative_access_decision",
    args: { _recon: string; _action: "edit" | "run" },
  ) => Promise<{ data: unknown; error: unknown | null }>;
};

export async function assertReconAction(
  supabase: ReconActionClient,
  definitionId: string,
  action: "edit" | "run",
) {
  const { data, error } = await supabase.rpc("recon_authoritative_access_decision", {
    _recon: definitionId,
    _action: action,
  });
  if (error || data !== true) {
    const verb = action === "edit" ? "edit" : "run";
    throw new Error(`You do not have access to ${verb} this reconciliation.`);
  }
}

export const listRecons = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string }) => z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("recon_definitions")
      .select("id, recon_code, name, description, recon_type, status, sides, rules, updated_at")
      .eq("tenant_id", data.tenant_id)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const RECON_LIST_PAGE_FILTERS = {
  status: ["draft", "active", "archived"],
  recon_type: ["one_sided", "two_sided", "three_sided"],
  sort_by: ["updated_at", "name", "recon_code", "status", "recon_type"],
  max_page_size: 100,
} as const;

const UtcDateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, "Use a UTC date in YYYY-MM-DD format")
  .refine((value) => {
    const year = Number(value.slice(0, 4));
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return year >= 1 && year <= 9998 && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Enter a valid UTC calendar date");

function utcDateStart(value: string) {
  return `${value}T00:00:00.000Z`;
}

async function assertActiveTenantAdmin(ctx: any, tenantId: string) {
  const { data, error } = await ctx.supabase.from("tenant_members")
    .select("user_id").eq("tenant_id", tenantId).eq("user_id", ctx.userId)
    .eq("active", true).eq("role", "tenant_admin").maybeSingle();
  if (error || !data) throw new Error("An active tenant administrator is required for this governance step.");
}

function utcDateAfter(value: string) {
  return new Date(new Date(utcDateStart(value)).getTime() + 86_400_000).toISOString();
}

const ListReconsPageInput = z.object({
  tenant_id: z.string().uuid(),
  page: z.number().int().min(1).max(1_000_000).default(1),
  page_size: z.number().int().min(1).max(RECON_LIST_PAGE_FILTERS.max_page_size).default(25),
  search: z.string().trim().max(120)
    .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), "Search contains unsupported characters")
    .optional()
    .transform((value) => value || undefined),
  status: z.enum(RECON_LIST_PAGE_FILTERS.status).optional(),
  recon_type: z.enum(RECON_LIST_PAGE_FILTERS.recon_type).optional(),
  updated_from: UtcDateOnly.optional(),
  updated_through: UtcDateOnly.optional(),
  sort_by: z.enum(RECON_LIST_PAGE_FILTERS.sort_by).default("updated_at"),
  sort_direction: z.enum(["asc", "desc"]).default("desc"),
}).superRefine((input, issueContext) => {
  if (input.updated_from && input.updated_through && input.updated_from > input.updated_through) {
    issueContext.addIssue({ code: "custom", path: ["updated_through"], message: "Updated through must be on or after Updated from" });
  }
});

export type ListReconsPageInput = z.infer<typeof ListReconsPageInput>;
type ReconDefinitionRow = Database["public"]["Tables"]["recon_definitions"]["Row"];
export type ReconListPageRow = Pick<
  ReconDefinitionRow,
  "id" | "recon_code" | "name" | "description" | "recon_type" | "status" | "sides" | "rules" | "updated_at"
> & {
  last_run_at: string | null;
  last_status: string | null;
  /** False means the latest-run lookup failed; null fields must not be read as "Never". */
  last_run_available: boolean;
};

export type ListReconsPageResult = {
  rows: ReconListPageRow[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
};

const RECON_LIST_PAGE_FIELDS =
  "id, recon_code, name, description, recon_type, status, sides, rules, updated_at";
const LATEST_RUN_QUERY_CONCURRENCY = 5;

function escapePostgrestLikeTerm(value: string) {
  return value
    .replace(/\\/gu, "\\\\")
    .replace(/%/gu, "\\%")
    .replace(/_/gu, "\\_")
    .replace(/"/gu, "\\\"");
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= values.length) return;
        results[index] = await mapper(values[index]);
      }
    }),
  );
  return results;
}

async function getLatestRunForDefinition(supabase: any, tenantId: string, definitionId: string) {
  try {
    const { data, error } = await supabase.from("recon_runs")
      .select("status, started_at")
      .eq("tenant_id", tenantId)
      .eq("definition_id", definitionId)
      .order("started_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(1);

    if (error || !Array.isArray(data)) {
      return { last_run_at: null, last_status: null, last_run_available: false };
    }
    const latest = data[0];
    return {
      last_run_at: latest?.started_at ?? null,
      last_status: latest?.status ?? null,
      last_run_available: true,
    };
  } catch {
    return { last_run_at: null, last_status: null, last_run_available: false };
  }
}

export const listReconsPage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => ListReconsPageInput.parse(input))
  .handler(async ({ data, context }): Promise<ListReconsPageResult> => {
    const from = (data.page - 1) * data.page_size;
    const to = from + data.page_size - 1;
    let query = context.supabase.from("recon_definitions")
      .select(RECON_LIST_PAGE_FIELDS, { count: "exact" })
      .eq("tenant_id", data.tenant_id);

    if (data.search) {
      const pattern = `"%${escapePostgrestLikeTerm(data.search)}%"`;
      query = query.or([
        `name.ilike.${pattern}`,
        `recon_code.ilike.${pattern}`,
        `description.ilike.${pattern}`,
      ].join(","));
    }
    if (data.status) query = query.eq("status", data.status);
    if (data.recon_type) query = query.eq("recon_type", data.recon_type);
    if (data.updated_from) query = query.gte("updated_at", utcDateStart(data.updated_from));
    if (data.updated_through) query = query.lt("updated_at", utcDateAfter(data.updated_through));

    if (data.sort_by === "updated_at") {
      query = query.order("updated_at", { ascending: data.sort_direction === "asc", nullsFirst: false })
        .order("id", { ascending: data.sort_direction === "asc" });
    } else {
      query = query.order(data.sort_by, { ascending: data.sort_direction === "asc", nullsFirst: false })
        .order("updated_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false });
    }

    const { data: rows, count, error } = await query.range(from, to);
    if (error || !Array.isArray(rows) || typeof count !== "number") {
      throw new Error("Reconciliation list is temporarily unavailable. Please try again.");
    }

    const definitions = rows;
    const latestRuns = await mapWithConcurrency(
      definitions,
      LATEST_RUN_QUERY_CONCURRENCY,
      (definition) => getLatestRunForDefinition(context.supabase, data.tenant_id, definition.id),
    );

    return {
      rows: definitions.map((row, index) => ({
        id: row.id,
        recon_code: row.recon_code,
        name: row.name,
        description: row.description,
        recon_type: row.recon_type,
        status: row.status,
        sides: row.sides,
        rules: row.rules,
        updated_at: row.updated_at,
        ...latestRuns[index],
      })),
      total: count,
      page: data.page,
      page_size: data.page_size,
      total_pages: Math.ceil(count / data.page_size),
    };
  });

const SideSchema = z.object({
  side_id: z.string().min(1).max(8),
  label: z.string().min(1).max(80),
  data_source_id: z.string().uuid(),
  upload_id: z.string().uuid().optional(),
});
type ReconSideInput = z.infer<typeof SideSchema>;

async function assertReconSourcesBelongToTenant(
  supabase: any,
  tenantId: string,
  sides: readonly ReconSideInput[],
) {
  const sourceIds = [...new Set(sides.map((side) => side.data_source_id))];
  if (sourceIds.length === 0) {
    throw new Error("At least one source must belong to this workspace.");
  }

  const { data: sources, error } = await supabase
    .from("workspace_data_sources")
    .select("id")
    .eq("tenant_id", tenantId)
    .in("id", sourceIds);

  if (error || !Array.isArray(sources) || sources.length !== sourceIds.length) {
    throw new Error("One or more reconciliation sources are unavailable in this workspace.");
  }
}

const RuleSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.string(),
  description: z.string().optional(),
  fields: z.record(z.string(), z.string()),
  params: z.record(z.string(), z.any()).optional(),
  is_key: z.boolean().optional(),
}).superRefine((rule, context) => {
  if (rule.kind !== "reference_lookup") return;
  const params = rule.params ?? {};
  if (!z.string().uuid().safeParse(params.reference_table_id).success) {
    context.addIssue({ code: "custom", path: ["params", "reference_table_id"], message: "A governed reference table is required" });
  }
  if (typeof params.reference_value_column !== "string" || !params.reference_value_column.trim()) {
    context.addIssue({ code: "custom", path: ["params", "reference_value_column"], message: "A reference value column is required" });
  }
  if (params.reference_as_of !== undefined
      && !/^\d{4}-\d{2}-\d{2}$/u.test(String(params.reference_as_of))) {
    context.addIssue({ code: "custom", path: ["params", "reference_as_of"], message: "Reference as-of must be YYYY-MM-DD" });
  }
});

const UpsertRecon = z.object({
  id: z.string().uuid().optional(),
  tenant_id: z.string().uuid(),
  owner_bu_ids: z.array(z.string().uuid()).min(1).max(100).optional(),
  name: z.string().min(2).max(80),
  description: z.string().max(500).optional().nullable(),
  recon_type: z.enum(["one_sided", "two_sided", "three_sided"]),
  sides: z.array(SideSchema).min(1).max(3),
  rules: z.array(RuleSchema).max(50),
  status: z.enum(["draft", "active", "archived"]).optional(),
}).superRefine((data, issueContext) => {
  if (!data.id && (!data.owner_bu_ids || data.owner_bu_ids.length === 0)) {
    issueContext.addIssue({ code: "custom", path: ["owner_bu_ids"], message: "Select at least one owning business unit." });
  }
});

type AtomicReconCreateInput = {
  tenant_id: string;
  name: string;
  description?: string | null;
  recon_type: "one_sided" | "two_sided" | "three_sided";
  sides: unknown[];
  rules: unknown[];
  owner_bu_ids: string[];
};

export async function createReconDefinitionWithOwners(supabase: any, input: AtomicReconCreateInput) {
  const { data, error } = await supabase.rpc("create_recon_definition_with_owners", {
    _tenant_id: input.tenant_id,
    _name: input.name,
    _description: input.description ?? null,
    _recon_type: input.recon_type,
    _sides: input.sides,
    _rules: input.rules,
    _owner_bu_ids: [...new Set(input.owner_bu_ids)],
  });
  const row = Array.isArray(data) && data.length === 1 ? data[0] : null;
  if (error || typeof row?.id !== "string" || typeof row?.recon_code !== "string") {
    if (error?.code === "42501") {
      throw new Error("You do not have access to create a reconciliation for the selected business units or sources.");
    }
    if (error?.code === "22023") {
      throw new Error("Select at least one active owning business unit in this workspace.");
    }
    throw new Error("Reconciliation creation is temporarily unavailable. Check the selected owners and sources, then try again.");
  }
  return { id: row.id, recon_code: row.recon_code };
}

export const upsertRecon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: z.infer<typeof UpsertRecon>) => UpsertRecon.parse(d))
  .handler(async ({ data, context }) => {
    const persistedRules = data.rules.map((rule) => {
      const {
        managed_lookup: _managedLookup,
        reference_key_columns: _referenceKeyColumns,
        reference_version_id: _referenceVersionId,
        reference_content_sha256: _referenceContentSha256,
        ...params
      } = rule.params ?? {};
      return { ...rule, params };
    });
    const payload: any = {
      tenant_id: data.tenant_id,
      name: data.name,
      description: data.description ?? null,
      recon_type: data.recon_type,
      sides: data.sides,
      rules: persistedRules,
    };
    if (data.id) {
      const { data: existing, error: readError } = await (context.supabase as any).from("recon_definitions")
        .select("status, governance_state, access_mode, environment").eq("id", data.id).eq("tenant_id", data.tenant_id).maybeSingle();
      if (readError || !existing) throw new Error("This reconciliation could not be found in your workspace.");
      const governanceState = (existing as any).governance_state as string | undefined;
      const accessMode = (existing as any).access_mode as string | undefined;
      if (accessMode === "legacy_passthrough") {
        await assertWriter(context, data.tenant_id);
      } else {
        await assertReconAction(context.supabase as unknown as ReconActionClient, data.id, "edit");
        if (["approved_locked", "edit_request_pending", "promotion_request_pending", "promoted"].includes(governanceState ?? "")) {
          throw new Error("This reconciliation is locked. Use the maker-checker workflow to request a staging copy.");
        }
        if (governanceState !== "development_draft" && governanceState !== "staging_copy") {
          throw new Error("This reconciliation is not editable in its current governance state.");
        }
      }
      if (data.status && data.status !== existing.status) {
        throw new Error("Reconciliation status changes require the governed approval workflow.");
      }
      await assertReconSourcesBelongToTenant(context.supabase, data.tenant_id, data.sides);
      const { data: updated, error } = await context.supabase
        .from("recon_definitions").update(payload).eq("id", data.id).eq("tenant_id", data.tenant_id)
        .select("id").maybeSingle();
      if (error || !updated) throw new Error("This reconciliation could not be updated with the current access.");
      await context.supabase.from("audit_log").insert({
        actor_user_id: context.userId, tenant_id: data.tenant_id,
        scope: "workspace", action: "recon.update",
        resource_type: "recon_definition", resource_id: data.id, context: { name: data.name },
      } as any);
      return { id: data.id };
    }
    if (data.status && data.status !== "draft") {
      throw new Error("New reconciliations must begin as drafts.");
    }
    await assertWriter(context, data.tenant_id);
    await assertReconSourcesBelongToTenant(context.supabase, data.tenant_id, data.sides);
    return createReconDefinitionWithOwners(context.supabase, {
      tenant_id: data.tenant_id,
      name: data.name,
      description: data.description,
      recon_type: data.recon_type,
      sides: data.sides,
      rules: persistedRules,
      owner_bu_ids: data.owner_bu_ids ?? [],
    });
  });

export const deleteRecon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string; tenant_id: string }) =>
    z.object({ id: z.string().uuid(), tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    const { data: definition, error: lookupError } = await (context.supabase as any)
      .from("recon_definitions").select("status, access_mode").eq("id", data.id).eq("tenant_id", data.tenant_id).maybeSingle();
    if (lookupError || !definition) throw new Error("This reconciliation could not be found in your workspace.");
    if (definition.access_mode !== "legacy_passthrough") {
      throw new Error("This governed draft is retained for audit and cannot be permanently deleted here. Its lifecycle requires a reviewed administrator action.");
    }
    if (definition.status !== "draft") {
      throw new Error("This reconciliation is protected. Request retirement and obtain a different authorized teammate's approval.");
    }
    const { count, error: runsError } = await context.supabase.from("recon_runs")
      .select("id", { count: "exact", head: true }).eq("tenant_id", data.tenant_id).eq("definition_id", data.id);
    if (runsError || count === null) throw new Error("The reconciliation's history could not be checked. Nothing was deleted.");
    if (count > 0) throw new Error("This draft has run history and cannot be directly deleted.");
    const { data: deleted, error } = await context.supabase
      .from("recon_definitions").delete().eq("id", data.id).eq("tenant_id", data.tenant_id)
      .select("id").maybeSingle();
    if (error || !deleted) throw new Error("The draft could not be deleted. Check your access and try again.");
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id,
      scope: "workspace", action: "recon.delete",
      resource_type: "recon_definition", resource_id: data.id, context: {},
    } as any);
    return { ok: true };
  });

export const runReconDefinition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string; tenant_id: string }) =>
    z.object({ id: z.string().uuid(), tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: def, error: defErr } = await context.supabase
      .from("recon_definitions").select("*")
      .eq("id", data.id).eq("tenant_id", data.tenant_id).maybeSingle();
    if (defErr || !def) throw new Error(defErr?.message ?? "Definition not found");
    if (def.status === "archived") throw new Error("Archived reconciliations cannot be run.");
    const governanceState = (def as any).governance_state as string | undefined;
    const accessMode = (def as any).access_mode as string | undefined;
    const environment = (def as any).environment as string | undefined;
    if (accessMode === "legacy_passthrough") {
      await assertWriter(context, data.tenant_id);
    } else if (
      (governanceState === "development_draft" && environment === "development")
      || (governanceState === "staging_copy" && ["development", "staging"].includes(environment ?? ""))
      || (governanceState === "edit_request_pending" && environment === "production")
    ) {
      await assertReconAction(context.supabase as unknown as ReconActionClient, def.id, "run");
    } else if (governanceState === "approved_locked" && environment === "production") {
      // Keep the existing production-only administrator gate until the hosted
      // Access cutover is independently reviewed and accepted.
      await assertActiveTenantAdmin(context, data.tenant_id);
      await assertReconAction(context.supabase as unknown as ReconActionClient, def.id, "run");
    } else if (accessMode !== "legacy_passthrough") {
      throw new Error("This reconciliation is not eligible to run in its current environment and governance state.");
    }
    const { assertTenantIpAllowed } = await import("@/lib/ip-guard.server");
    await assertTenantIpAllowed(context.supabase, data.tenant_id, context.userId);


    // D1: per-tenant per-user rate limit (configurable via tenant_security_settings)
    const { enforceServerFnRateLimit } = await import("@/lib/rate-limit.server");
    const { data: sec } = await context.supabase
      .from("tenant_security_settings").select("max_runs_per_hour")
      .eq("tenant_id", data.tenant_id).maybeSingle();
    await enforceServerFnRateLimit(
      context.supabase,
      `recon.run:${data.tenant_id}:${context.userId}`,
      3600, sec?.max_runs_per_hour ?? 120,
      { tenant_id: data.tenant_id, user_id: context.userId, event_type: "rate_limit.recon_run" },
    );

    const sideParse = z.array(SideSchema).min(1).max(3).safeParse(def.sides);
    if (!sideParse.success) throw new Error("Reconciliation sources are invalid.");
    const sides = sideParse.data;
    await assertReconSourcesBelongToTenant(context.supabase, data.tenant_id, sides);

    // Create run row
    const { data: run, error: runErr } = await context.supabase
      .from("recon_runs").insert({
        tenant_id: data.tenant_id, definition_id: def.id,
        status: "running", run_by: context.userId,
      }).select("id, run_uid").single();
    if (runErr) throw new Error(runErr.message);

    try {
      // Fetch latest upload rows per side
      const sideData: SideData[] = [];
      for (const s of sides) {
        const q = context.supabase
          .from("workspace_data_source_uploads")
          .select("id, rows")
          .eq("data_source_id", s.data_source_id)
          .eq("tenant_id", data.tenant_id)
          .order("created_at", { ascending: false })
          .limit(1);
        const { data: ups, error: upsErr } = await q;
        if (upsErr) throw new Error("Reconciliation input data could not be loaded. Nothing was run.");
        const up = ups?.[0];
        sideData.push({ side_id: s.side_id, rows: (up?.rows as any[]) ?? [] });
      }

      const { hydrateManagedReferenceRules } = await import("@/lib/reference-data-resolver.server");
      const referenceResolution = await hydrateManagedReferenceRules(
        context.supabase,
        data.tenant_id,
        def.rules as unknown as ReconSpec["rules"],
        "authenticated",
      );

      const spec: ReconSpec = {
        recon_type: def.recon_type as any,
        sides: sides as any,
        rules: referenceResolution.rules,
      };
      const result = runRecon(spec, sideData);
      result.stats.reference_versions = referenceResolution.evidence;

      // Persist matches in chunks
      const matchRows = result.matches.map((m) => ({
        run_id: run.id, tenant_id: data.tenant_id,
        rule_id: m.rule_id, cardinality: m.cardinality,
        members: m.members, score: m.score,
      }));
      for (let i = 0; i < matchRows.length; i += 500) {
        const slice = matchRows.slice(i, i + 500);
        if (slice.length) {
          const { error } = await context.supabase.from("recon_matches").insert(slice as any);
          if (error) throw new Error(error.message);
        }
      }
      const excRows = result.exceptions.map((e) => ({
        run_id: run.id, tenant_id: data.tenant_id,
        side: e.side ?? null, reason: e.reason, severity: e.severity,
        status: "open", payload: e.payload,
      }));
      for (let i = 0; i < excRows.length; i += 500) {
        const slice = excRows.slice(i, i + 500);
        if (slice.length) {
          const { error } = await context.supabase.from("recon_exceptions").insert(slice as any);
          if (error) throw new Error(error.message);
        }
      }

      await context.supabase.from("recon_runs").update({
        status: "completed",
        matched_count: result.matches.length,
        exception_count: result.exceptions.length,
        total_rows: result.stats.total_rows,
        stats: result.stats,
        completed_at: new Date().toISOString(),
      } as any).eq("id", run.id);

      await context.supabase.from("audit_log").insert({
        actor_user_id: context.userId, tenant_id: data.tenant_id,
        scope: "workspace", action: "recon.run.complete",
        resource_type: "recon_run", resource_id: run.id,
        context: {
          definition_id: def.id, name: def.name,
          matched: result.matches.length, exceptions: result.exceptions.length,
          total_rows: result.stats.total_rows,
          reference_versions: referenceResolution.evidence,
        },
      } as any);

      const { supabaseAdmin: _admin1 } = await import("@/integrations/supabase/client.server");
      await _admin1.from("notifications").insert({
        user_id: context.userId, tenant_id: data.tenant_id,
        kind: "recon.completed",
        severity: result.exceptions.length > 0 ? "warning" : "success",
        title: `${def.name} — ${result.matches.length} matched, ${result.exceptions.length} exceptions`,
        body: `${result.stats.total_rows.toLocaleString()} rows processed`,
      } as any);

      return { run_id: run.id, run_uid: run.run_uid, ...result.stats };
    } catch (err: any) {
      await context.supabase.from("recon_runs").update({
        status: "failed", error: err.message ?? String(err),
        completed_at: new Date().toISOString(),
      } as any).eq("id", run.id);
      throw err;
    }
  });

export const listRuns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string; definition_id?: string }) =>
    z.object({ tenant_id: z.string().uuid(), definition_id: z.string().uuid().optional() }).parse(d))
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("recon_runs")
      .select("id, run_uid, definition_id, status, matched_count, exception_count, total_rows, started_at, completed_at, error, definition:recon_definitions(name, recon_type)")
      .eq("tenant_id", data.tenant_id)
      .order("started_at", { ascending: false })
      .limit(100);
    if (data.definition_id) q = q.eq("definition_id", data.definition_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listExceptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenant_id: string; status?: string; run_id?: string }) =>
    z.object({
      tenant_id: z.string().uuid(),
      status: z.string().optional(),
      run_id: z.string().uuid().optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("recon_exceptions")
      .select("id, run_id, side, reason, severity, status, payload, resolution_note, created_at, resolved_at, run:recon_runs(definition_id, definition:recon_definitions(name))")
      .eq("tenant_id", data.tenant_id)
      .order("created_at", { ascending: false })
      .limit(500);
    if (data.status) q = q.eq("status", data.status as any);
    if (data.run_id) q = q.eq("run_id", data.run_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const resolveException = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string; tenant_id: string; status: "investigating"|"resolved"|"wont_fix"|"open"; note?: string }) =>
    z.object({
      id: z.string().uuid(),
      tenant_id: z.string().uuid(),
      status: z.enum(["investigating","resolved","wont_fix","open"]),
      note: z.string().max(2000).optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    const patch: any = { status: data.status, resolution_note: data.note ?? null };
    if (data.status === "resolved" || data.status === "wont_fix") {
      patch.resolved_by = context.userId;
      patch.resolved_at = new Date().toISOString();
    }
    const { error } = await context.supabase
      .from("recon_exceptions").update(patch).eq("id", data.id).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id,
      scope: "workspace", action: "exception.update",
      resource_type: "recon_exception", resource_id: data.id,
      context: { status: data.status, note: data.note ?? null },
    } as any);
    return { ok: true };
  });

export const bulkResolveExceptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      ids: z.array(z.string().uuid()).min(1).max(500),
      status: z.enum(["investigating","resolved","wont_fix","open"]),
      note: z.string().max(2000).optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    const patch: any = { status: data.status, resolution_note: data.note ?? null };
    if (data.status === "resolved" || data.status === "wont_fix") {
      patch.resolved_by = context.userId;
      patch.resolved_at = new Date().toISOString();
    }
    const { error } = await context.supabase.from("recon_exceptions")
      .update(patch).in("id", data.ids).eq("tenant_id", data.tenant_id);
    if (error) throw new Error(error.message);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id,
      scope: "workspace", action: "exception.bulk_update",
      resource_type: "recon_exception", resource_id: null,
      context: { count: data.ids.length, status: data.status },
    } as any);
    return { ok: true, count: data.ids.length };
  });

export const escalateExceptionToTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({
      tenant_id: z.string().uuid(),
      exception_id: z.string().uuid(),
      subject: z.string().min(3).max(160),
      body: z.string().max(8000).optional(),
      priority: z.enum(["low","normal","high","urgent"]).default("high"),
    }).parse(d))
  .handler(async ({ data, context }) => {
    await assertWriter(context, data.tenant_id);
    const { data: exc } = await context.supabase.from("recon_exceptions")
      .select("id, reason, severity, payload").eq("id", data.exception_id).single();
    const body = (data.body ?? `Auto-escalated from break ${exc?.id}.\n\nReason: ${exc?.reason ?? "—"}\nSeverity: ${exc?.severity ?? "—"}`).slice(0, 8000);
    const { data: t, error } = await context.supabase.from("support_tickets").insert({
      tenant_id: data.tenant_id, subject: data.subject, body,
      priority: data.priority, created_by: context.userId,
    } as any).select("id, ref").single();
    if (error) throw new Error(error.message);
    await context.supabase.from("recon_exceptions").update({ status: "investigating" })
      .eq("id", data.exception_id).eq("tenant_id", data.tenant_id);
    await context.supabase.from("audit_log").insert({
      actor_user_id: context.userId, tenant_id: data.tenant_id,
      scope: "workspace", action: "exception.escalate",
      resource_type: "support_ticket", resource_id: t.id,
      context: { exception_id: data.exception_id, ref: t.ref },
    } as any);
    const { supabaseAdmin: _admin2 } = await import("@/integrations/supabase/client.server");
    await _admin2.from("notifications").insert({
      user_id: context.userId, tenant_id: data.tenant_id,
      kind: "ticket.created", severity: "warning",
      title: `Escalated to ticket ${t.ref}`,
      body: data.subject,
    } as any);
    return { ticket_id: t.id, ref: t.ref };
  });

const GovernanceReason = z.string().trim().min(1).max(2000);
const RequestReconEditInput = z.object({
  tenant_id: z.string().uuid(),
  recon_id: z.string().uuid(),
  reason: GovernanceReason,
}).strict();
const DecideReconRequestInput = z.object({
  request_id: z.string().uuid(),
  approve: z.boolean(),
  reason: GovernanceReason,
}).strict();
const SubmitReconPromotionInput = z.object({
  tenant_id: z.string().uuid(),
  staging_id: z.string().uuid(),
  reason: GovernanceReason,
}).strict();

async function callReconGovernanceRpc(context: any, name: string, args: Record<string, unknown>, allowNull = false) {
  const { data, error } = await (context.supabase as any).rpc(name, args);
  if (error || data == null && !allowNull) {
    throw new Error("Definition governance is temporarily unavailable. Please try again.");
  }
  return data ?? true;
}

/** Admin-only interim workflow until authoritative multi-BU edit/approve checks are wired. */
export const requestReconEdit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => RequestReconEditInput.parse(input))
  .handler(async ({ data, context }) => callReconGovernanceRpc(context, "request_recon_definition_edit", {
    _tenant_id: data.tenant_id, _recon_id: data.recon_id, _reason: data.reason,
  }));

/** Checker decisions are exact-tenant active tenant-admin only until Access is authoritative. */
export const decideReconEditRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => DecideReconRequestInput.parse(input))
  .handler(async ({ data, context }) => callReconGovernanceRpc(context, "decide_recon_definition_edit", {
    _request_id: data.request_id, _approve: data.approve, _reason: data.reason,
  }, true));

export const submitReconPromotion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => SubmitReconPromotionInput.parse(input))
  .handler(async ({ data, context }) => callReconGovernanceRpc(context, "submit_recon_definition_promotion", {
    _tenant_id: data.tenant_id, _staging_id: data.staging_id, _reason: data.reason,
  }));

export const decideReconPromotion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => DecideReconRequestInput.parse(input))
  .handler(async ({ data, context }) => callReconGovernanceRpc(context, "decide_recon_definition_promotion", {
    _request_id: data.request_id, _approve: data.approve, _reason: data.reason,
  }, true));
