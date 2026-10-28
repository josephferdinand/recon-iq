import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  hasAnyMktRole,
  hasMktPiiReadAccess,
  MKT_ANALYTICS_ROLES,
  MKT_PII_READ_ROLES,
  MKT_PII_WRITE_ROLES,
} from "@/lib/mkt-admin-roles";

const migrationPath = "supabase/migrations/20260927160000_mkt_lead_pii_role_boundary.sql";

describe("marketing PII role boundary", () => {
  it("separates human PII roles, write roles, and AI aggregate-only access", () => {
    expect(MKT_PII_READ_ROLES).toEqual(["super_admin", "sales_admin", "marketing_admin"]);
    for (const role of MKT_PII_READ_ROLES) expect(hasMktPiiReadAccess([role])).toBe(true);
    expect(hasMktPiiReadAccess(["ai_admin"])).toBe(false);
    expect(hasMktPiiReadAccess(["brand_reviewer"])).toBe(false);

    expect(MKT_PII_WRITE_ROLES).toEqual(["super_admin", "sales_admin"]);
    expect(hasAnyMktRole(["marketing_admin"], MKT_PII_WRITE_ROLES)).toBe(false);
    expect(hasAnyMktRole(["ai_admin"], MKT_PII_WRITE_ROLES)).toBe(false);
    expect(hasAnyMktRole(["ai_admin"], MKT_ANALYTICS_ROLES)).toBe(true);
  });

  it("gates all lead PII server reads and writes and uses count-only lead KPIs", async () => {
    const source = await readFile("src/lib/mkt-leads.functions.ts", "utf8");
    const guarded = [
      ["listLeads", "MKT_PII_READ_ROLES"],
      ["getLead", "MKT_PII_READ_ROLES"],
      ["updateLeadStage", "MKT_PII_WRITE_ROLES"],
      ["addLeadNote", "MKT_PII_WRITE_ROLES"],
      ["assignLead", "MKT_PII_WRITE_ROLES"],
      ["leadKpis", "MKT_ANALYTICS_ROLES"],
    ] as const;
    for (const [name, roles] of guarded) {
      const start = source.indexOf(`export const ${name} =`);
      expect(start, `${name} exists`).toBeGreaterThanOrEqual(0);
      const end = source.indexOf("\nexport const ", start + 1);
      const block = source.slice(start, end < 0 ? undefined : end);
      expect(block).toContain(`assertMktLeadRole(context, ${roles})`);
    }
    const leadKpis = source.slice(source.indexOf("export const leadKpis ="));
    expect(leadKpis).toContain('rpc("mkt_lead_kpis")');
    expect(leadKpis).not.toContain('.from("mkt_leads")');
  });

  it("removes broad raw PII policies and preserves aggregate-only AI paths", async () => {
    const migration = await readFile(migrationPath, "utf8");
    const adminFunctions = await readFile("src/lib/mkt-admin.functions.ts", "utf8");
    const llmFunctions = await readFile("src/lib/mkt-llm-ops.functions.ts", "utf8");
    const appointmentFunctions = await readFile("src/lib/mkt-appointments.functions.ts", "utf8");
    const ctaRoute = await readFile("src/routes/mkt-admin/cta-analytics.tsx", "utf8");
    const publicLeadRoute = await readFile("src/routes/api/public/mkt-leads.ts", "utf8");

    for (const policy of [
      "mkt_leads_admin_read",
      "mkt_lead_files_admin",
      "mkt_lead_notes_admin",
      "mkt_lead_tasks_admin",
      "mkt_lead_activity_read",
      "mkt_lead_activity_insert",
      "mkt_appointments_admin",
      "mkt_chat_sessions_admin",
      "mkt_chat_messages_admin_read",
      "mkt_kb_queries_admin_read",
      "mkt_llm_usage_admin_read",
      "mkt_cta_events_admin_read",
      "mkt_cta_events_admin_write",
    ]) expect(migration).toContain(`DROP POLICY IF EXISTS ${policy}`);

    for (const aggregate of ["mkt_lead_kpis", "mkt_chat_kpis", "mkt_cta_analytics", "mkt_llm_usage_stats"]) {
      expect(migration).toContain(`FUNCTION public.${aggregate}`);
    }
    expect(migration).toContain("total >= 5");
    expect(adminFunctions).toContain("export async function assertMktRoleAssignment");
    expect(adminFunctions).toContain('rpc("mkt_chat_kpis")');
    expect(adminFunctions).toContain('rpc("mkt_cta_analytics"');
    expect(adminFunctions).toContain("assertMktRoleAssignment(context, MKT_ANALYTICS_ROLES)");
    expect(adminFunctions).not.toContain('.from("mkt_chat_messages")');
    expect(llmFunctions).toContain('rpc("mkt_llm_usage_stats"');
    expect(llmFunctions).toContain("assertMktRoleAssignment(context, MKT_TAB_ROLES.chatbot)");
    expect(llmFunctions).not.toContain('.from("mkt_llm_usage")');
    expect(appointmentFunctions).toContain("assertMktRoleAssignment(context, MKT_PII_READ_ROLES)");
    expect(ctaRoute).toContain("getMktCtaAnalytics");
    expect(ctaRoute).not.toContain('.from("mkt_cta_events")');
    expect(publicLeadRoute).toContain('supabaseAdmin.from("mkt_leads").insert');
    expect(publicLeadRoute).toContain('supabaseAdmin.from("mkt_lead_activity").insert');
    expect(migration).not.toMatch(/DROP\s+TABLE|DELETE\s+FROM\s+public\.mkt_/iu);
  });
});
