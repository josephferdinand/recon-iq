/**
 * Template Marketplace server functions.
 *
 * All AI features route through the app-configured LLM abstraction
 * (executeInference → ai_provider_instances / ai_routing_policies).
 * NO Meta AI Gateway usage anywhere.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { executeInference } from "./ai-inference.functions";

// ── audit helper ──────────────────────────────────────────────────────────
async function audit(
  sb: any,
  actor: string,
  args: {
    tenant_id?: string | null;
    workspace_id?: string | null;
    entity_type: string;
    entity_id?: string | null;
    action: string;
    before?: unknown;
    after?: unknown;
    correlation_id?: string | null;
  },
) {
  await sb.from("mkt_audit_log").insert({
    actor_id: actor,
    tenant_id: args.tenant_id ?? null,
    workspace_id: args.workspace_id ?? null,
    entity_type: args.entity_type,
    entity_id: args.entity_id ?? null,
    action: args.action,
    before: args.before ?? null,
    after: args.after ?? null,
    correlation_id: args.correlation_id ?? null,
  });
}

// ── list marketplace (any authenticated user) ─────────────────────────────
export const listMarketplace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z
      .object({
        search: z.string().optional(),
        pack_type: z.string().optional(),
        industry: z.string().optional(),
        region: z.string().optional(),
        standard: z.string().optional(),
        category_slug: z.string().optional(),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("mkt_templates")
      .select(
        "id,slug,title,summary,pack_type,certification,visibility,license,industries,regions,standards,tags,category_id,install_count,avg_rating,current_version_id,updated_at,certification_score,recon_score,ai_score,governance_score,spec_valid,domain_key,install_mode",
      )
      .order("updated_at", { ascending: false })
      .limit(500);
    if (data.search) q = q.ilike("title", `%${data.search}%`);
    if (data.pack_type) q = q.eq("pack_type", data.pack_type as any);
    if (data.industry) q = q.contains("industries", [data.industry]);
    if (data.region) q = q.contains("regions", [data.region]);
    if (data.standard) q = q.contains("standards", [data.standard]);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const { data: cats } = await context.supabase
      .from("mkt_template_categories")
      .select("id,slug,name,kind,sort_order")
      .order("sort_order");
    const filtered = data.category_slug
      ? rows?.filter((r: any) => cats?.find((c: any) => c.id === r.category_id)?.slug === data.category_slug)
      : rows;
    return { templates: filtered ?? [], categories: cats ?? [] };
  });

// ── get template detail ───────────────────────────────────────────────────
export const getTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: template, error } = await context.supabase
      .from("mkt_templates")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!template) throw new Error("Template not found");
    const { data: versions } = await context.supabase
      .from("mkt_template_versions")
      .select("id,semver,status,changelog,published_at,created_at")
      .eq("template_id", data.id)
      .order("created_at", { ascending: false });
    const { data: ratings } = await context.supabase
      .from("mkt_template_ratings")
      .select("stars,review,created_at")
      .eq("template_id", data.id)
      .order("created_at", { ascending: false })
      .limit(20);
    return { template, versions: versions ?? [], ratings: ratings ?? [] };
  });

// ── PLATFORM ADMIN: create / update / publish / retire ────────────────────
export const upsertTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z
      .object({
        id: z.string().uuid().optional(),
        slug: z.string().min(2),
        title: z.string().min(2),
        summary: z.string().optional(),
        description: z.string().optional(),
        pack_type: z.enum(["featured", "regulatory", "industry", "pack", "community", "internal"]),
        certification: z.enum(["draft", "review", "approved", "certified", "deprecated", "archived"]).optional(),
        visibility: z.enum(["public", "restricted", "private"]).optional(),
        license: z.enum(["free", "trial", "paid", "enterprise"]).optional(),
        industries: z.array(z.string()).default([]),
        regions: z.array(z.string()).default([]),
        standards: z.array(z.string()).default([]),
        tags: z.array(z.string()).default([]),
        category_id: z.string().uuid().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("mkt_templates")
      .upsert(
        {
          id: data.id,
          slug: data.slug,
          title: data.title,
          summary: data.summary,
          description: data.description,
          pack_type: data.pack_type,
          certification: data.certification ?? "draft",
          visibility: data.visibility ?? "restricted",
          license: data.license ?? "free",
          industries: data.industries,
          regions: data.regions,
          standards: data.standards,
          tags: data.tags,
          category_id: data.category_id ?? null,
          publisher_user_id: context.userId,
        },
        { onConflict: "slug" },
      )
      .select()
      .single();
    if (error) throw new Error(error.message);
    await audit(context.supabase, context.userId, {
      entity_type: "mkt_template",
      entity_id: row.id,
      action: data.id ? "update" : "create",
      after: row,
    });
    return row;
  });

export const createVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z
      .object({
        template_id: z.string().uuid(),
        semver: z.string().min(3),
        spec: z.record(z.any()).default({}),
        changelog: z.string().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("mkt_template_versions")
      .insert({
        template_id: data.template_id,
        semver: data.semver,
        status: "draft",
        spec: data.spec,
        changelog: data.changelog,
        authored_by: context.userId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    await audit(context.supabase, context.userId, {
      entity_type: "mkt_template_version",
      entity_id: row.id,
      action: "create_version",
      after: { semver: data.semver },
    });
    return row;
  });

export const approveVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ version_id: z.string().uuid(), notes: z.string().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: v } = await context.supabase
      .from("mkt_template_versions")
      .select("id,authored_by,template_id")
      .eq("id", data.version_id)
      .maybeSingle();
    if (!v) throw new Error("Version not found");
    if (v.authored_by === context.userId) {
      throw new Error("Dual-control violated: approver must differ from author");
    }
    const { error } = await context.supabase
      .from("mkt_template_versions")
      .update({ status: "approved", approved_by: context.userId, approved_at: new Date().toISOString() })
      .eq("id", data.version_id);
    if (error) throw new Error(error.message);
    await context.supabase.from("mkt_template_reviews").insert({
      template_id: v.template_id,
      version_id: v.id,
      reviewer_id: context.userId,
      decision: "approve",
      notes: data.notes,
    });
    await audit(context.supabase, context.userId, {
      entity_type: "mkt_template_version",
      entity_id: v.id,
      action: "approve",
    });
    return { ok: true };
  });

export const publishVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ version_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: v } = await context.supabase
      .from("mkt_template_versions")
      .select("id,template_id,status")
      .eq("id", data.version_id)
      .maybeSingle();
    if (!v) throw new Error("Version not found");
    if (v.status !== "approved") throw new Error("Only approved versions can be published");
    const { error } = await context.supabase
      .from("mkt_template_versions")
      .update({ status: "published", published_by: context.userId, published_at: new Date().toISOString() })
      .eq("id", v.id);
    if (error) throw new Error(error.message);
    await context.supabase
      .from("mkt_templates")
      .update({ current_version_id: v.id, certification: "certified" })
      .eq("id", v.template_id);
    await audit(context.supabase, context.userId, {
      entity_type: "mkt_template_version",
      entity_id: v.id,
      action: "publish",
    });
    return { ok: true };
  });

export const retireTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ template_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("mkt_templates")
      .update({ retired_at: new Date().toISOString(), certification: "deprecated" })
      .eq("id", data.template_id);
    if (error) throw new Error(error.message);
    await audit(context.supabase, context.userId, {
      entity_type: "mkt_template",
      entity_id: data.template_id,
      action: "retire",
    });
    return { ok: true };
  });

// ── TENANT ADMIN: install / clone / customize / upgrade / rollback ────────
export const installTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z
      .object({
        tenant_id: z.string().uuid(),
        template_id: z.string().uuid(),
        auto_update: z.boolean().default(false),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: tpl } = await context.supabase
      .from("mkt_templates")
      .select("id,title,current_version_id,certification,retired_at")
      .eq("id", data.template_id)
      .maybeSingle();
    if (!tpl) throw new Error("Template not found");
    if (tpl.retired_at) throw new Error("Template retired");
    if (!["approved", "certified"].includes(tpl.certification))
      throw new Error("Template not approved");

    const { data: install, error } = await context.supabase
      .from("tenant_template_installs")
      .upsert(
        {
          tenant_id: data.tenant_id,
          template_id: data.template_id,
          installed_version_id: tpl.current_version_id,
          state: "installed",
          auto_update: data.auto_update,
          installed_by: context.userId,
        },
        { onConflict: "tenant_id,template_id" },
      )
      .select()
      .single();
    if (error) throw new Error(error.message);

    const { data: ver } = tpl.current_version_id
      ? await context.supabase
          .from("mkt_template_versions")
          .select("spec")
          .eq("id", tpl.current_version_id)
          .maybeSingle()
      : { data: null as { spec: unknown } | null };

    const { error: draftError } = await context.supabase.from("tenant_templates").insert({
      tenant_id: data.tenant_id,
      source_install_id: install.id,
      source_template_id: tpl.id,
      title: tpl.title,
      spec: (ver?.spec ?? {}) as any,
      status: "draft",
      created_by: context.userId,
    });
    if (draftError) throw new Error(draftError.message);

    await context.supabase
      .from("mkt_templates")
      .update({ install_count: ((tpl as any).install_count ?? 0) + 1 })
      .eq("id", tpl.id);

    await audit(context.supabase, context.userId, {
      tenant_id: data.tenant_id,
      entity_type: "tenant_template_install",
      entity_id: install.id,
      action: "install",
      after: { template_id: tpl.id },
    });
    return install;
  });

export const listTenantInstalls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("tenant_template_installs")
      .select("id,template_id,state,auto_update,installed_at,installed_version_id")
      .eq("tenant_id", data.tenant_id)
      .order("installed_at", { ascending: false });
    if (error) throw new Error(error.message);
    if (!rows?.length) return [];
    const ids = rows.map((r: any) => r.template_id);
    const { data: tpls } = await context.supabase
      .from("mkt_templates")
      .select("id,title,pack_type,industries,regions,standards")
      .in("id", ids);
    return rows.map((r: any) => ({ ...r, template: tpls?.find((t: any) => t.id === r.template_id) }));
  });

export const listTenantTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("tenant_templates")
      .select("*")
      .eq("tenant_id", data.tenant_id)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

const TenantTemplatePageInput = z.object({
  tenant_id: z.string().uuid(),
  page: z.number().int().min(1).max(1_000_000).default(1),
  page_size: z.union([z.literal(25), z.literal(50), z.literal(100)]).default(25),
  search: z.string().trim().max(120)
    .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), "Search contains unsupported characters")
    .optional()
    .transform((value) => value || undefined),
  asset_class: z.string().trim().max(80)
    .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value), "Asset class contains unsupported characters")
    .optional()
    .transform((value) => value || undefined),
  status: z.enum(["draft", "review", "approved", "published", "deprecated", "archived"]).optional(),
});

function escapeTemplateSearch(value: string) {
  return value.replace(/\\/gu, "\\\\").replace(/%/gu, "\\%").replace(/_/gu, "\\_").replace(/"/gu, "\\\"");
}

function safeTemplateLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const label = value.replace(/[\x00-\x1f\x7f]/gu, "").trim().slice(0, 120);
  if (!label || label.includes("@") || /^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(label)) return null;
  return label;
}

function projectTenantTemplateListRow(row: Record<string, any>) {
  const spec = row.spec && typeof row.spec === "object" && !Array.isArray(row.spec)
    ? row.spec as Record<string, unknown>
    : {};
  const sides = Array.isArray(spec.sides) ? spec.sides.length : null;
  const rules = Array.isArray(spec.rules) ? spec.rules.length : null;
  return {
    id: row.id as string,
    title: row.title as string,
    description: typeof row.description === "string" ? row.description : null,
    current_semver: typeof row.current_semver === "string" ? row.current_semver : "Version unavailable",
    status: typeof row.status === "string" ? row.status : "Status unavailable",
    created_at: typeof row.created_at === "string" ? row.created_at : null,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
    asset_class: safeTemplateLabel(spec.asset_class),
    sides_count: sides,
    rules_count: rules,
    owner_label: safeTemplateLabel(spec.owner_label),
    submitted_at: typeof row.submitted_at === "string" ? row.submitted_at : null,
    submitted_by_recorded: typeof row.submitted_by === "string" && Boolean(row.submitted_by),
    approved_at: typeof row.approved_at === "string" ? row.approved_at : null,
    approved_by_recorded: typeof row.approved_by === "string" && Boolean(row.approved_by),
  };
}

export const listTenantTemplatesPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => TenantTemplatePageInput.parse(input))
  .handler(async ({ data, context }) => {
    const from = (data.page - 1) * data.page_size;
    const to = from + data.page_size - 1;
    let query = (context.supabase.from("tenant_templates") as any)
      .select("id,tenant_id,title,description,spec,current_semver,status,created_at,updated_at,submitted_by,submitted_at,approved_by,approved_at", { count: "exact" })
      .eq("tenant_id", data.tenant_id);
    if (data.search) {
      const pattern = `"%${escapeTemplateSearch(data.search)}%"`;
      query = query.or(`title.ilike.${pattern},description.ilike.${pattern},current_semver.ilike.${pattern}`);
    }
    if (data.asset_class) query = query.ilike("spec->>asset_class", `%${escapeTemplateSearch(data.asset_class)}%`);
    if (data.status) query = query.eq("status", data.status);
    const { data: rows, count, error } = await query
      .order("updated_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true })
      .range(from, to);
    if (error || !Array.isArray(rows) || typeof count !== "number") {
      throw new Error("My Templates is temporarily unavailable. Please try again.");
    }
    return {
      rows: rows.map((row: Record<string, any>) => projectTenantTemplateListRow(row)),
      total: count,
      page: data.page,
      page_size: data.page_size,
      total_pages: Math.ceil(count / data.page_size),
    };
  });

const TenantTemplateLatestRunInput = z.object({
  tenant_id: z.string().uuid(),
  tenant_template_id: z.string().uuid(),
});

export const getTenantTemplateLatestRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => TenantTemplateLatestRunInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: template, error: templateError } = await context.supabase.from("tenant_templates")
      .select("id").eq("id", data.tenant_template_id).eq("tenant_id", data.tenant_id).maybeSingle();
    if (templateError || !template) throw new Error("Template not found in this tenant.");
    const { data: definitions, error: definitionsError } = await (context.supabase.from("recon_definitions") as any)
      .select("id").eq("tenant_id", data.tenant_id).eq("tenant_template_id", data.tenant_template_id);
    if (definitionsError || !Array.isArray(definitions)) return { state: "unavailable" as const, run: null };
    const definitionIds = definitions.map((definition: { id: string }) => definition.id);
    if (definitionIds.length === 0) return { state: "unavailable" as const, run: null };
    const { data: run, error: runError } = await context.supabase.from("recon_runs")
      .select("run_uid,status,started_at,total_rows,matched_count,exception_count")
      .eq("tenant_id", data.tenant_id)
      .in("definition_id", definitionIds)
      .order("started_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (runError) return { state: "unavailable" as const, run: null };
    if (!run) return { state: "none_visible" as const, run: null };
    return {
      state: "available" as const,
      run: {
        run_uid: typeof run.run_uid === "string" && run.run_uid ? run.run_uid : null,
        status: run.status,
        started_at: run.started_at,
        total_rows: run.total_rows,
        matched_count: run.matched_count,
        exception_count: run.exception_count,
      },
    };
  });

export const saveTenantTemplateFromRecon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => z.object({
    tenant_id: z.string().uuid(),
    recon_definition_id: z.string().uuid(),
    title: z.string().min(2).max(120),
    description: z.string().max(500).optional().nullable(),
    tenant_template_id: z.string().uuid().optional().nullable(),
    semver: z.string().regex(/^\d+\.\d+\.\d+$/u).default("1.0.0"),
    changelog: z.string().max(1000).optional().nullable(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc(
      "save_tenant_template_from_recon_atomic" as never,
      {
        _tenant_id: data.tenant_id,
        _recon_definition_id: data.recon_definition_id,
        _title: data.title,
        _description: data.description ?? null,
        _tenant_template_id: data.tenant_template_id ?? null,
        _semver: data.semver,
        _changelog: data.changelog ?? null,
      } as never,
    );
    if (error) throw new Error(error.message);
    const row = (rows as unknown as Array<{ tenant_template_id: string; version_id: string; saved_semver: string }> | null)?.[0];
    if (!row) throw new Error("Tenant template save returned no result");
    return row;
  });

export const cloneTenantTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => z.object({
    tenant_id: z.string().uuid(), source_template_id: z.string().uuid(), title: z.string().min(2).max(120),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: id, error } = await context.supabase.rpc("clone_tenant_template_atomic" as never, {
      _tenant_id: data.tenant_id, _source_template_id: data.source_template_id, _title: data.title,
    } as never);
    if (error) throw new Error(error.message);
    return { id: id as unknown as string };
  });

export const transitionTenantTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => z.object({
    tenant_id: z.string().uuid(), tenant_template_id: z.string().uuid(),
    action: z.enum(["submit", "approve", "reject", "publish", "unpublish"]),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: status, error } = await context.supabase.rpc("transition_tenant_template_atomic" as never, {
      _tenant_id: data.tenant_id, _tenant_template_id: data.tenant_template_id, _action: data.action,
    } as never);
    if (error) throw new Error(error.message);
    return { status: status as unknown as string };
  });

export const instantiateTenantTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => z.object({
    tenant_id: z.string().uuid(), tenant_template_id: z.string().uuid(), name: z.string().min(2).max(80),
    owner_bu_ids: z.array(z.string().uuid()).min(1).max(50)
      .refine((ids) => new Set(ids).size === ids.length, "Choose each owning business unit once"),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: ownerUnits, error: ownerError } = await context.supabase.from("business_units")
      .select("id,is_archived")
      .eq("tenant_id", data.tenant_id)
      .in("id", data.owner_bu_ids)
      .eq("is_archived", false);
    if (ownerError || (ownerUnits?.length ?? 0) !== data.owner_bu_ids.length) {
      throw new Error("Choose active owning business units from the selected tenant.");
    }
    const { data: rows, error } = await context.supabase.rpc("instantiate_tenant_template_atomic" as never, {
      _tenant_id: data.tenant_id, _tenant_template_id: data.tenant_template_id, _name: data.name,
      _owner_bu_ids: data.owner_bu_ids,
    } as never);
    if (error) throw new Error(error.message);
    const row = (rows as unknown as Array<{ recon_definition_id: string; recon_code: string }> | null)?.[0];
    if (!row) throw new Error("Template instantiation returned no reconciliation");
    return row;
  });

export const uninstallTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ install_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: install } = await context.supabase
      .from("tenant_template_installs")
      .select("id,tenant_id")
      .eq("id", data.install_id)
      .maybeSingle();
    if (!install) throw new Error("Install not found");
    const { error } = await context.supabase
      .from("tenant_template_installs")
      .update({ state: "uninstalled" })
      .eq("id", install.id);
    if (error) throw new Error(error.message);
    await audit(context.supabase, context.userId, {
      tenant_id: install.tenant_id,
      entity_type: "tenant_template_install",
      entity_id: install.id,
      action: "uninstall",
    });
    return { ok: true };
  });

// ── WORKSPACE ADMIN: assign / revoke ──────────────────────────────────────
export const assignToWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z
      .object({
        workspace_id: z.string().uuid(),
        tenant_id: z.string().uuid(),
        tenant_template_id: z.string().uuid(),
        team_ids: z.array(z.string().uuid()).default([]),
        permission: z.enum(["view", "use", "admin"]).default("use"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("workspace_template_assignments")
      .upsert(
        {
          workspace_id: data.workspace_id,
          tenant_id: data.tenant_id,
          tenant_template_id: data.tenant_template_id,
          team_ids: data.team_ids,
          permission: data.permission,
          enabled: true,
          assigned_by: context.userId,
        },
        { onConflict: "workspace_id,tenant_template_id" },
      )
      .select()
      .single();
    if (error) throw new Error(error.message);
    await audit(context.supabase, context.userId, {
      tenant_id: data.tenant_id,
      workspace_id: data.workspace_id,
      entity_type: "workspace_template_assignment",
      entity_id: row.id,
      action: "assign",
      after: row,
    });
    return row;
  });

export const listWorkspaceAssignments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ workspace_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("workspace_template_assignments")
      .select("id,tenant_template_id,team_ids,enabled,permission,assigned_at")
      .eq("workspace_id", data.workspace_id)
      .order("assigned_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const revokeAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ assignment_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("workspace_template_assignments")
      .select("id,workspace_id,tenant_id")
      .eq("id", data.assignment_id)
      .maybeSingle();
    if (!row) throw new Error("Not found");
    await context.supabase.from("workspace_template_assignments").delete().eq("id", row.id);
    await audit(context.supabase, context.userId, {
      tenant_id: row.tenant_id,
      workspace_id: row.workspace_id,
      entity_type: "workspace_template_assignment",
      entity_id: row.id,
      action: "revoke",
    });
    return { ok: true };
  });

// ── AUDIT TRAIL ───────────────────────────────────────────────────────────
export const getAuditTrail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z
      .object({
        tenant_id: z.string().uuid().optional(),
        workspace_id: z.string().uuid().optional(),
        entity_type: z.string().optional(),
        entity_id: z.string().uuid().optional(),
        limit: z.number().min(1).max(500).default(200),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("mkt_audit_log")
      .select("id,actor_id,tenant_id,workspace_id,entity_type,entity_id,action,before,after,created_at,correlation_id")
      .order("created_at", { ascending: false })
      .limit(data.limit);
    if (data.tenant_id) q = q.eq("tenant_id", data.tenant_id);
    if (data.workspace_id) q = q.eq("workspace_id", data.workspace_id);
    if (data.entity_type) q = q.eq("entity_type", data.entity_type);
    if (data.entity_id) q = q.eq("entity_id", data.entity_id);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const getTenantTemplateLifecycle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((input: unknown) => z.object({ tenant_id: z.string().uuid(), tenant_template_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: template, error: templateError } = await context.supabase.from("tenant_templates")
      .select("id").eq("id", data.tenant_template_id).eq("tenant_id", data.tenant_id).maybeSingle();
    if (templateError || !template) throw new Error("Template not found in this tenant.");
    const { data: rows, error } = await context.supabase.from("mkt_audit_log")
      .select("action,created_at,actor_id,before,after")
      .eq("tenant_id", data.tenant_id)
      .eq("entity_type", "tenant_template")
      .eq("entity_id", data.tenant_template_id)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error || !Array.isArray(rows)) throw new Error("Template lifecycle evidence is temporarily unavailable.");
    return rows.map((row, index) => {
      const after = row.after && typeof row.after === "object" && !Array.isArray(row.after) ? row.after as Record<string, unknown> : {};
      const before = row.before && typeof row.before === "object" && !Array.isArray(row.before) ? row.before as Record<string, unknown> : {};
      const version = typeof after.semver === "string" ? after.semver : typeof before.semver === "string" ? before.semver : null;
      const actorRole = ["create", "clone", "version"].includes(row.action) ? "Maker"
        : row.action === "submit" ? "Submitter"
          : row.action === "approve" ? "Checker"
            : row.action === "reject" ? "Reviewer"
              : ["publish", "unpublish"].includes(row.action) ? "Publisher" : "Actor";
      return {
        key: `${row.created_at}:${row.action}:${index}`,
        action: row.action,
        created_at: row.created_at,
        actor_recorded: typeof row.actor_id === "string" && Boolean(row.actor_id),
        actor_role: actorRole,
        version,
      };
    });
  });

// ── AI SUGGESTIONS (via app's own LLM abstraction) ────────────────────────
const aiInvoke = executeInference as unknown as (args: {
  data: {
    tenant_id?: string | null;
    request_class: "chat";
    messages: { role: string; content: string }[];
    max_tokens?: number;
    temperature?: number;
  };
}) => Promise<{ ok: boolean; content?: string; error?: string; status?: number }>;

export const aiRecommendTemplates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z
      .object({
        tenant_id: z.string().uuid(),
        prompt: z.string().min(2),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: catalog } = await context.supabase
      .from("mkt_templates")
      .select("slug,title,summary,industries,regions,standards,pack_type")
      .in("certification", ["approved", "certified"])
      .is("retired_at", null)
      .limit(200);
    const sys = `You recommend reconciliation templates from a catalog. Return a JSON array of up to 6 slug strings, most relevant first. Only output JSON. Catalog:\n${JSON.stringify(catalog ?? []).slice(0, 15000)}`;
    const res = await aiInvoke({
      data: {
        tenant_id: data.tenant_id,
        request_class: "chat",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: data.prompt },
        ],
        max_tokens: 400,
        temperature: 0.2,
      },
    });
    if (!res.ok) throw new Error(res.error ?? "AI call failed");
    let slugs: string[] = [];
    try {
      const match = (res.content ?? "").match(/\[[\s\S]*\]/);
      if (match) slugs = JSON.parse(match[0]).filter((s: unknown) => typeof s === "string");
    } catch {
      slugs = [];
    }
    const { data: recs } = await context.supabase
      .from("mkt_templates")
      .select("id,slug,title,summary,pack_type,standards")
      .in("slug", slugs.length ? slugs : ["__none__"]);
    await context.supabase.from("mkt_template_ai_suggestions").insert({
      tenant_id: data.tenant_id,
      source: "recommend",
      input: { prompt: data.prompt },
      output: { slugs, count: recs?.length ?? 0 },
      created_by: context.userId,
    });
    return { recommendations: recs ?? [] };
  });

export const aiGenerateFromPrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) =>
    z.object({ tenant_id: z.string().uuid(), prompt: z.string().min(10) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const sys =
      "You draft reconciliation template specifications in strict JSON only. Schema: {kind:'reconciliation',matching:{modes:string[]},mapping:object,workflow:{approvals:string[]},controls:string[],reports:string[]}";
    const res = await aiInvoke({
      data: {
        tenant_id: data.tenant_id,
        request_class: "chat",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: data.prompt },
        ],
        max_tokens: 800,
        temperature: 0.3,
      },
    });
    if (!res.ok) throw new Error(res.error ?? "AI call failed");
    let spec: any = {};
    try {
      const match = (res.content ?? "").match(/\{[\s\S]*\}/);
      if (match) spec = JSON.parse(match[0]);
    } catch {
      spec = { kind: "reconciliation", raw: res.content };
    }
    await context.supabase.from("mkt_template_ai_suggestions").insert({
      tenant_id: data.tenant_id,
      source: "nl_prompt",
      input: { prompt: data.prompt } as any,
      output: spec as any,
      created_by: context.userId,
    });
    return { spec: spec as Record<string, any> };
  });
