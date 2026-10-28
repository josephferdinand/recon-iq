import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync("src/routes/_authenticated/$slug/workspace.tsx", "utf8");
const pages = readFileSync("src/lib/page-permissions.ts", "utf8");
const server = readFileSync("src/lib/my-audit.functions.ts", "utf8");
const screen = readFileSync("src/components/my-audit-trail.tsx", "utf8");
const rls = readFileSync("supabase/migrations/20260927104500_scope_workspace_audit_reads.sql", "utf8");

describe("personal Workspace audit and Overview retirement", () => {
  it("removes the duplicate Overview but preserves its unique getting-started checklist", () => {
    expect(pages).not.toMatch(/key:\s*"overview"/u);
    expect(route).not.toContain('page === "overview"');
    expect(route).toContain('pages: ["dashboard"]');
    expect(route).toContain("<OnboardingChecklist tenantId={tenant.id}");
  });

  it("shows a dedicated left-rail Audit Trail without a tenant-wide audit permission gate", () => {
    expect(pages).toMatch(/key:\s*"audit",\s*label:\s*"Audit Trail",\s*permission:\s*null/u);
    expect(route).toContain('label: "Audit Trail", icon: ShieldCheck, pages: ["audit"]');
    expect(route).toContain("<MyAuditTrail tenantId={tenant.id} />");
    expect(route).not.toContain("<AuditTab tenantId={tenant.id} />");
  });

  it("binds every personal audit page to the authenticated actor and tenant, without raw context", () => {
    expect(server).toContain(".middleware([requireSupabaseAuth()])");
    expect(server).toContain('.eq("tenant_id", data.tenant_id)');
    expect(server).toContain('.eq("actor_user_id", context.userId)');
    expect(server).toContain('select("id,occurred_at,scope,action,resource_type,resource_id,row_hash,prev_hash")');
    expect(server).not.toContain("supabaseAdmin");
    expect(screen).toContain("q.data?.actor_id === actorId");
    expect(screen).not.toContain("row.context");
  });

  it("narrows ordinary tenant audit RLS while retaining governed administrator access", () => {
    expect(rls).toContain("DROP POLICY IF EXISTS audit_tenant_read ON public.audit_log");
    expect(rls).toContain("actor_user_id = (SELECT auth.uid())");
    expect(rls).toContain("member.active = true");
    expect(rls).toContain("'audit.log.read'");
    expect(rls).not.toContain("DROP POLICY IF EXISTS audit_platform_read");
  });
});
