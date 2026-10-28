/**
 * Phase 1 Quick Win — Unified template facet counts for the tenant
 * "Browse Templates" entry point.
 *
 * Counts across every template surface a tenant can install/consume.
 * All queries run under the caller's Supabase client with RLS applied,
 * so counts respect tenant isolation.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const getTemplateFacets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth()])
  .validator((d: unknown) => z.object({ tenant_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const tid = data.tenant_id;

    const countRows = async (table: string, col = "tenant_id"): Promise<number> => {
      const { count, error } = await supabase
        .from(table as never)
        .select("id", { count: "exact", head: true })
        .eq(col, tid);
      if (error) return 0;
      return count ?? 0;
    };

    const [tenant_templates, email_templates, report_definitions, aidp_templates, copilot_personas] =
      await Promise.all([
        countRows("tenant_templates"),
        countRows("tenant_email_templates"),
        countRows("tenant_report_definitions"),
        countRows("aidp_templates"),
        countRows("copilot_personas"),
      ]);

    return {
      tenant_templates,
      email_templates,
      report_definitions,
      aidp_templates,
      copilot_personas,
    };
  });
