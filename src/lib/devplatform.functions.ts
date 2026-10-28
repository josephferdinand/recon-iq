import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// ── Event catalog (read-only for tenants) ────────────────────────────────
export const listEventCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("platform_event_catalog")
      .select("*")
      .order("category")
      .order("event_key");
    if (error) throw error;
    return data ?? [];
  });

// ── API surface registry ─────────────────────────────────────────────────
export const listApiSurfaces = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("platform_api_surfaces")
      .select("*")
      .order("protocol")
      .order("resource")
      .order("operation");
    if (error) throw error;
    return data ?? [];
  });

// ── Plugins ──────────────────────────────────────────────────────────────
const PluginUpsert = z.object({
  id: z.string().uuid().optional(),
  tenant_id: z.string().uuid(),
  name: z.string().min(1).max(120),
  slug: z.string().regex(/^[a-z0-9-]+$/).max(80),
  kind: z.enum(["matcher", "enricher", "panel", "transformer", "validator"]),
  version: z.string().max(40).default("0.1.0"),
  description: z.string().max(2000).optional().nullable(),
  source_code: z.string().max(200_000).default(""),
  entry_point: z.string().max(80).default("default"),
  sandbox_limits: z.record(z.string(), z.any()).optional(),
  config_schema: z.record(z.string(), z.any()).optional(),
  config_values: z.record(z.string(), z.any()).optional(),
  status: z.enum(["draft", "review", "enabled", "disabled"]).default("draft"),
  enabled: z.boolean().default(false),
});

export const listPlugins = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenantId: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("tenant_plugins")
      .select("*")
      .eq("tenant_id", data.tenantId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return rows ?? [];
  });

export const upsertPlugin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => PluginUpsert.parse(d))
  .handler(async ({ data, context }) => {
    const payload = { ...data, created_by: context.userId };
    const { data: row, error } = await context.supabase
      .from("tenant_plugins")
      .upsert(payload, { onConflict: "id" })
      .select("*")
      .single();
    if (error) throw error;
    return row;
  });

export const togglePlugin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string; enabled: boolean }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("tenant_plugins")
      .update({ enabled: data.enabled, status: data.enabled ? "enabled" : "disabled" })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const deletePlugin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("tenant_plugins").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

// Simulate sandbox execution (records audit row; real isolate-vm runs server-side later)
export const simulatePluginExecution = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { pluginId: string; tenantId: string; input: string }) => d)
  .handler(async ({ data, context }) => {
    const startedAt = Date.now();
    let status: "ok" | "error" | "timeout" | "denied" = "ok";
    let errorMessage: string | null = null;
    let outputSize = 0;
    try {
      // Static lint — never run untrusted code here. Real sandbox runs in a worker isolate.
      const banned = [/process\./, /require\(/, /import\s*\(/, /eval\(/, /Function\(/, /fetch\(/, /XMLHttpRequest/];
      const { data: plugin, error: pErr } = await context.supabase
        .from("tenant_plugins")
        .select("source_code, sandbox_limits")
        .eq("id", data.pluginId)
        .single();
      if (pErr) throw pErr;
      for (const re of banned) {
        if (re.test(plugin.source_code ?? "")) {
          status = "denied";
          errorMessage = `Disallowed API: ${re.source}`;
          break;
        }
      }
      outputSize = (plugin.source_code ?? "").length;
    } catch (e) {
      status = "error";
      errorMessage = e instanceof Error ? e.message : "unknown";
    }
    const duration = Date.now() - startedAt;
    await context.supabase.from("tenant_plugin_executions").insert({
      tenant_id: data.tenantId,
      plugin_id: data.pluginId,
      invoked_by: context.userId,
      context_ref: "simulate",
      status,
      duration_ms: duration,
      input_size_bytes: data.input.length,
      output_size_bytes: outputSize,
      error_message: errorMessage,
    });
    return { status, duration_ms: duration, error: errorMessage };
  });

export const listPluginExecutions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { pluginId: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("tenant_plugin_executions")
      .select("*")
      .eq("plugin_id", data.pluginId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return rows ?? [];
  });

// ── Sandbox tenant links ─────────────────────────────────────────────────
export const listSandboxLinks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenantId: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("tenant_sandbox_links")
      .select("*, sandbox_tenant:sandbox_tenant_id(id, name, slug)")
      .eq("prod_tenant_id", data.tenantId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return rows ?? [];
  });

export const createSandboxLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: {
    prodTenantId: string;
    sandboxName: string;
    purpose: "ci-cd" | "uat" | "training" | "perf";
    dataSeed: "empty" | "masked" | "synthetic";
  }) => d)
  .handler(async ({ data, context }) => {
    // Look up prod tenant to derive slug
    const { data: prod, error: pErr } = await context.supabase
      .from("tenants")
      .select("slug, region, residency_locked, family_id")
      .eq("id", data.prodTenantId)
      .single();
    if (pErr) throw pErr;

    const sandboxSlug = `${prod.slug}-${data.purpose}-${Math.random().toString(36).slice(2, 6)}`;
    const { data: sandboxTenant, error: tErr } = await context.supabase
      .from("tenants")
      .insert({
        name: data.sandboxName,
        slug: sandboxSlug,
        region: prod.region,
        residency_locked: prod.residency_locked,
        environment: "uat",
        family_id: prod.family_id,
      })
      .select("id")
      .single();
    if (tErr) throw tErr;

    const { data: link, error: lErr } = await context.supabase
      .from("tenant_sandbox_links")
      .insert({
        prod_tenant_id: data.prodTenantId,
        sandbox_tenant_id: sandboxTenant.id,
        purpose: data.purpose,
        data_seed: data.dataSeed,
        api_base_url: `https://api.fvi.app/t/${sandboxSlug}/v1`,
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (lErr) throw lErr;
    return link;
  });

export const refreshSandbox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { linkId: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("tenant_sandbox_links")
      .update({ last_refreshed_at: new Date().toISOString() })
      .eq("id", data.linkId);
    if (error) throw error;
    return { ok: true };
  });

export const deleteSandboxLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { linkId: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("tenant_sandbox_links")
      .delete()
      .eq("id", data.linkId);
    if (error) throw error;
    return { ok: true };
  });

// ── IaC exports ──────────────────────────────────────────────────────────
async function sha256(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function renderTerraform(tenant: { name: string; slug: string; region: string | null }, rules: Array<{ name: string; slug: string }>): string {
  const lines: string[] = [
    `terraform {`,
    `  required_providers { fvi = { source = "fvi/fvi" version = "~> 1.0" } }`,
    `}`,
    ``,
    `provider "fvi" { api_token = var.fvi_api_token }`,
    ``,
    `resource "fvi_tenant" "this" {`,
    `  name = ${JSON.stringify(tenant.name)}`,
    `  slug = ${JSON.stringify(tenant.slug)}`,
    `  region = ${JSON.stringify(tenant.region ?? "eu-west-1")}`,
    `}`,
    ``,
  ];
  for (const r of rules) {
    lines.push(`resource "fvi_recon_rule" ${JSON.stringify(r.slug)} {`);
    lines.push(`  tenant_id = fvi_tenant.this.id`);
    lines.push(`  name = ${JSON.stringify(r.name)}`);
    lines.push(`  slug = ${JSON.stringify(r.slug)}`);
    lines.push(`}`);
    lines.push(``);
  }
  return lines.join("\n");
}

function renderPulumiTs(tenant: { name: string; slug: string; region: string | null }, rules: Array<{ name: string; slug: string }>): string {
  const lines: string[] = [
    `import * as fvi from "@fvi/pulumi";`,
    ``,
    `const tenant = new fvi.Tenant("this", {`,
    `  name: ${JSON.stringify(tenant.name)},`,
    `  slug: ${JSON.stringify(tenant.slug)},`,
    `  region: ${JSON.stringify(tenant.region ?? "eu-west-1")},`,
    `});`,
    ``,
  ];
  for (const r of rules) {
    lines.push(`new fvi.ReconRule(${JSON.stringify(r.slug)}, {`);
    lines.push(`  tenantId: tenant.id,`);
    lines.push(`  name: ${JSON.stringify(r.name)},`);
    lines.push(`  slug: ${JSON.stringify(r.slug)},`);
    lines.push(`});`);
    lines.push(``);
  }
  return lines.join("\n");
}

function renderPulumiPy(tenant: { name: string; slug: string; region: string | null }, rules: Array<{ name: string; slug: string }>): string {
  const lines: string[] = [
    `import pulumi_fvi as fvi`,
    ``,
    `tenant = fvi.Tenant("this",`,
    `    name=${JSON.stringify(tenant.name)},`,
    `    slug=${JSON.stringify(tenant.slug)},`,
    `    region=${JSON.stringify(tenant.region ?? "eu-west-1")})`,
    ``,
  ];
  for (const r of rules) {
    lines.push(`fvi.ReconRule(${JSON.stringify(r.slug)},`);
    lines.push(`    tenant_id=tenant.id,`);
    lines.push(`    name=${JSON.stringify(r.name)},`);
    lines.push(`    slug=${JSON.stringify(r.slug)})`);
    lines.push(``);
  }
  return lines.join("\n");
}

export const generateIacExport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: {
    tenantId: string;
    kind: "terraform" | "pulumi-ts" | "pulumi-py" | "crossplane";
    scope: "tenant" | "rules" | "users" | "full";
  }) => d)
  .handler(async ({ data, context }) => {
    const { data: tenant, error: tErr } = await context.supabase
      .from("tenants")
      .select("name, slug, region")
      .eq("id", data.tenantId)
      .single();
    if (tErr) throw tErr;

    let rules: Array<{ name: string; slug: string }> = [];
    if (data.scope === "rules" || data.scope === "full") {
      const { data: rs } = await context.supabase
        .from("recon_definitions")
        .select("id, name")
        .eq("tenant_id", data.tenantId)
        .limit(100);
      rules = ((rs ?? []) as Array<{ id: string; name: string }>).map((r) => ({
        name: r.name,
        slug: String(r.id).slice(0, 8),
      }));
    }

    let content = "";
    if (data.kind === "terraform") content = renderTerraform(tenant, rules);
    else if (data.kind === "pulumi-ts") content = renderPulumiTs(tenant, rules);
    else if (data.kind === "pulumi-py") content = renderPulumiPy(tenant, rules);
    else content = `# Crossplane manifest for ${tenant.slug}\napiVersion: fvi.io/v1\nkind: Tenant\nmetadata:\n  name: ${tenant.slug}\nspec:\n  name: ${tenant.name}\n  region: ${tenant.region ?? "eu-west-1"}\n`;

    const hash = await sha256(content);
    const { data: row, error: iErr } = await context.supabase
      .from("tenant_iac_exports")
      .insert({
        tenant_id: data.tenantId,
        kind: data.kind,
        scope: data.scope,
        content,
        resource_count: 1 + rules.length,
        sha256: hash,
        generated_by: context.userId,
      })
      .select("*")
      .single();
    if (iErr) throw iErr;
    return row;
  });

export const listIacExports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { tenantId: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("tenant_iac_exports")
      .select("id, kind, scope, resource_count, sha256, generated_by, generated_at")
      .eq("tenant_id", data.tenantId)
      .order("generated_at", { ascending: false })
      .limit(20);
    if (error) throw error;
    return rows ?? [];
  });

export const getIacExportContent = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth()])
  .validator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("tenant_iac_exports")
      .select("content, kind, sha256")
      .eq("id", data.id)
      .single();
    if (error) throw error;
    return row;
  });
